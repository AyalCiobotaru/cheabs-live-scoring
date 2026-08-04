import { Injectable, NgZone, signal } from '@angular/core';
import {
  DivisionPoolGroup,
  CategoryPoolGroup,
  CsvImportResponse,
  CsvImportRow,
  EventState,
  GameScore,
  Match,
  PoolCard,
  PoolTimerUpdate,
  PoolState,
  ScanSummary,
  TeamStanding
} from '../models';
import {
  DIVISION_OPTIONS,
  POOL_CATEGORY_OPTIONS
} from '../util/division-rules';
import { TEAM_COUNT_OPTIONS } from '../util/pool-setup-rules';
import { SCHEDULE_PRESETS } from '../util/schedule-presets';
import type { SchedulePreset } from '../util/schedule-presets';
import {
  capGameScore,
  normalizeEventCode,
  normalizeEventState
} from '../util/scoring-event-normalizers';
import { mergeEvents } from '../util/scoring-event-merge';
import { eventWithoutImages } from '../util/scoring-event-projection';
import { buildPoolCard, buildStandings } from '../util/standings-rules';
import { clonePool, createNewPoolDraft, createSeededDivisionDraft } from '../util/pool-draft-rules';
import {
  canScorePool,
  canViewPool,
  categoryGroupsForCards,
  divisionFilterOptionsFor,
  poolCardsForEvent,
  poolCountForDivision,
  visibleCategoryPoolGroupsFor,
  visiblePoolCardsFor
} from '../util/event-view-selectors';
import {
  favoritePoolCount,
  favoritePoolIdList,
  pruneFavoritePools,
  removeFavoritePool,
  toggleFavoritePool
} from '../util/pool-favorite-rules';
import {
  addMatchToPool,
  applyGameFormatToPool,
  applySchedulePresetToPool,
  applyTeamCountToPool,
  moveMatchInPool,
  removeMatchFromPool
} from '../util/pool-edit-rules';
import {
  clearPoolTimer,
  hasStartedScoring,
  shouldStartPoolTimer,
  startPoolTimer,
  touchMatch,
  touchPool
} from '../util/pool-runtime-rules';
import {
  existingPoolForDraft,
  hiddenPoolsForCategoryDivision,
  normalizePoolSetupSelection,
  poolsForCategoryDivision,
  publishPool,
  upsertPool
} from '../util/pool-setup-workflow-rules';
import { divisionFilterFromRoute, normalizeDivisionFilter } from '../util/event-filter-rules';
import {
  applyRemoteMatchToEvent,
  applyRemotePoolDeletedToEvent,
  applyRemotePoolSetupToEvent,
  applyRemotePoolTimerToEvent
} from '../util/remote-event-apply-rules';
import { sideSwitchToastForScore } from '../util/side-switch-rules';
import { PoolSheetWorkflowService } from './pool-sheet-workflow.service';
import { ScoringAdminSessionService } from './scoring-admin-session.service';
import { ScoringEventApiService } from './scoring-event-api.service';
import { ScoringEventNavigationService } from './scoring-event-navigation.service';
import { ScoringEventRealtimeCoordinatorService } from './scoring-event-realtime-coordinator.service';
import { ScoringEventStorageService } from './scoring-event-storage.service';

interface SideSwitchToast {
  message: string;
  detail: string;
}

@Injectable({ providedIn: 'root' })
export class ScoringEventStateService {
  private applyingRemoteState = false;
  private initialized = false;
  private sideSwitchToastTimeout: number | null = null;
  private lastSideSwitchKey: string | null = null;
  private pendingAdminRoute: string | null = null;

  readonly version = signal(0);
  readonly teamCountOptions = TEAM_COUNT_OPTIONS;
  readonly categoryOptions = [...POOL_CATEGORY_OPTIONS];
  readonly divisionOptions = DIVISION_OPTIONS;
  readonly schedulePresets = SCHEDULE_PRESETS;
  readonly realtimeStatus$ = this.realtime.status$;

  adminPassword = this.adminSession.currentPassword();
  isAdmin = false;
  event: EventState | null = null;
  eventCode = this.storage.currentEventCode();
  eventName = '';
  landingMode: 'join' | 'create' = 'join';
  showingAdminSignIn = false;
  loadingEvent = false;
  eventError = '';
  draftPool: PoolState | null = null;
  activePoolId: string | null = null;
  expandedMatchId: string | null = null;
  scanError = '';
  scanProgress = '';
  scanSummary: ScanSummary | null = null;
  scanStatus: 'idle' | 'scanning' | 'success' | 'failed' = 'idle';
  sideSwitchToast: SideSwitchToast | null = null;
  selectedCategory: string | null = null;
  selectedDivision: string | null = null;
  showingFavoritePools = false;
  favoritePoolIds = new Set<string>();

  constructor(
    private readonly zone: NgZone,
    private readonly api: ScoringEventApiService,
    private readonly adminSession: ScoringAdminSessionService,
    private readonly navigation: ScoringEventNavigationService,
    private readonly storage: ScoringEventStorageService,
    private readonly realtime: ScoringEventRealtimeCoordinatorService,
    private readonly poolSheetWorkflow: PoolSheetWorkflowService
  ) {}

  init(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.realtime.start({
      event: (event) => this.applyRemoteEvent(event),
      poolSetup: (pool) => this.applyRemotePoolSetup(pool),
      poolDeleted: (poolId) => this.applyRemotePoolDeleted(poolId),
      match: (poolId, match) => this.applyRemoteMatch(poolId, match),
      poolTimer: (poolId, timer) => this.applyRemotePoolTimer(poolId, timer),
      snapshotRequest: () => {
        if (this.event) {
          this.realtime.publishSnapshot(eventWithoutImages(this.event, this.isAdmin));
        }
      }
    });
  }

  destroy(): void {
    this.initialized = false;
    this.realtime.close();
    this.clearSideSwitchToastTimeout();
  }

  get activePool(): PoolState | null {
    if (this.draftPool) {
      return this.draftPool;
    }

    return this.event?.pools.find((pool) => pool.id === this.activePoolId && canViewPool(pool, this.isAdmin)) ?? null;
  }

  get poolCards(): PoolCard[] {
    return poolCardsForEvent(this.event, this.isAdmin);
  }

  get allCategoryPoolGroups(): CategoryPoolGroup[] {
    return categoryGroupsForCards(this.poolCards);
  }

  get categoryPoolGroups(): CategoryPoolGroup[] {
    return categoryGroupsForCards(this.visiblePoolCards);
  }

  get visibleCategoryPoolGroups(): CategoryPoolGroup[] {
    return visibleCategoryPoolGroupsFor(
      this.categoryPoolGroups,
      this.showingFavoritePools,
      this.selectedCategory,
      this.selectedDivision
    );
  }

  get allDivisionPoolGroups(): DivisionPoolGroup[] {
    return this.allCategoryPoolGroups.flatMap((group) => group.divisions);
  }

  get divisionPoolGroups(): DivisionPoolGroup[] {
    return this.categoryPoolGroups.flatMap((group) => group.divisions);
  }

  get visibleDivisionPoolGroups(): DivisionPoolGroup[] {
    return this.visibleCategoryPoolGroups.flatMap((group) => group.divisions);
  }

  get visiblePoolCards(): PoolCard[] {
    return visiblePoolCardsFor(this.poolCards, this.showingFavoritePools, this.favoritePoolIds);
  }

  get favoritePoolCount(): number {
    return favoritePoolCount(this.poolCards, this.favoritePoolIds);
  }

  get favoritePoolIdList(): string[] {
    return favoritePoolIdList(this.favoritePoolIds);
  }

  poolCountForDivision(category: string, division: string): number {
    return poolCountForDivision(this.event, category, division);
  }

  get divisionFilterOptions(): {
    category: string;
    cards: PoolCard[];
    divisions: { category: string; division: string; count: number }[];
  }[] {
    return divisionFilterOptionsFor(this.allCategoryPoolGroups);
  }

  get standings(): TeamStanding[] {
    const pool = this.activePool;
    return pool ? buildStandings(pool) : [];
  }

  get activePoolCard(): PoolCard | null {
    const pool = this.activePool;
    return pool ? buildPoolCard(pool) : null;
  }

  get hasPool(): boolean {
    return Boolean(this.activePool?.matches.length);
  }

  get canDeleteActivePool(): boolean {
    return Boolean(this.draftPool && this.event?.pools.some((pool) => pool.id === this.draftPool?.id));
  }

  async loadEvent(eventCode: string): Promise<void> {
    const code = normalizeEventCode(eventCode);

    if (this.event?.code === code) {
      return;
    }

    this.loadingEvent = true;
    this.eventError = '';
    this.bump();

    try {
      this.event = normalizeEventState(
        await this.api.loadEvent(code, this.isAdmin ? this.adminPassword : ''),
        this.isAdmin
      );
      this.eventCode = this.event.code;
      this.eventName = this.event.name;
      this.activePoolId = this.event.activePoolId;
      this.draftPool = null;
      this.loadPoolFavorites();
      this.persistLocal();
      await this.realtime.connect(this.event.code);
    } catch {
      this.event = null;
      this.eventError = `Event ${code} doesn't exist.`;
      void this.navigation.home();
    } finally {
      this.loadingEvent = false;
      this.bump();
    }
  }

  async createEvent(): Promise<void> {
    await this.loadOrCreateEvent(true);
  }

  async joinEvent(): Promise<void> {
    await this.loadOrCreateEvent(false);
  }

  async importEvent(fileName: string, rows: CsvImportRow[]): Promise<CsvImportResponse> {
    this.eventError = '';

    try {
      const body = await this.api.importEvent(fileName, rows, this.adminPassword);

      if (!body.event) {
        return body;
      }

      this.event = normalizeEventState(body.event, this.isAdmin);
      this.eventCode = this.event.code;
      this.eventName = this.event.name;
      this.activePoolId = this.event.activePoolId;
      this.draftPool = null;
      this.loadPoolFavorites();
      this.persistLocal();
      await this.navigation.event(this.event.code);
      this.bump();
      void this.realtime.connect(this.event.code);

      return body;
    } catch (error) {
      return {
        errors: [
          {
            lineNumber: null,
            message: error instanceof Error ? error.message : 'Unable to reach the import endpoint.'
          }
        ],
        warnings: []
      };
    }
  }

  async adminSignIn(): Promise<void> {
    this.eventError = '';

    try {
      await this.adminSession.signIn(this.adminPassword);

      this.isAdmin = true;
      this.showingAdminSignIn = false;

      if (this.event) {
        const code = this.event.code;
        this.event = null;
        await this.loadEvent(code);
      }

      if (this.pendingAdminRoute) {
        const route = this.pendingAdminRoute;
        this.pendingAdminRoute = null;
        await this.navigation.url(route);
      }
    } catch (error) {
      this.eventError = error instanceof Error ? error.message : 'Unable to sign in as admin.';
    } finally {
      this.bump();
    }
  }

  adminSignOut(): void {
    this.isAdmin = false;
    this.showingAdminSignIn = false;
    this.adminPassword = '';
    this.adminSession.signOut();
    if (this.event) {
      this.event = normalizeEventState(this.event, this.isAdmin);
      this.activePoolId = this.event.activePoolId;
      this.persistLocal();
    }
    this.bump();
  }

  chooseEvent(): void {
    this.realtime.close();
    this.event = null;
    this.eventName = '';
    this.draftPool = null;
    this.activePoolId = null;
    this.expandedMatchId = null;
    this.selectedCategory = null;
    this.selectedDivision = null;
    this.showingFavoritePools = false;
    this.favoritePoolIds = new Set<string>();
    this.dismissSideSwitchToast();
    this.storage.clearCurrentEventCode();
    void this.navigation.home();
    this.bump();
  }

  openDashboard(): void {
    if (!this.event) {
      return;
    }

    this.draftPool = null;
    this.expandedMatchId = null;
    this.showingFavoritePools = false;
    this.selectedCategory = null;
    this.selectedDivision = null;
    void this.navigation.event(this.event.code);
    this.bump();
  }

  openPool(poolId: string): void {
    if (!this.event) {
      return;
    }

    this.activePoolId = poolId;
    this.event.activePoolId = poolId;
    this.draftPool = null;
    this.expandedMatchId = null;
    this.persistLocal();
    void this.navigation.pool(this.event.code, poolId);
    this.bump();
  }

  selectDivision(selection: { category: string; division: string | null } | null): void {
    const filter = normalizeDivisionFilter(selection);
    this.selectedCategory = filter.category;
    this.selectedDivision = filter.division;
    this.showingFavoritePools = false;
    this.draftPool = null;
    this.expandedMatchId = null;

    if (this.event) {
      void this.navigation.eventWithFilters(this.event.code, {
        category: this.selectedCategory,
        division: this.selectedDivision
      });
    }

    this.bump();
  }

  setSelectedDivisionFromRoute(category: string | null, division: string | null): void {
    const filter = divisionFilterFromRoute(category, division);
    this.selectedCategory = filter.category;
    this.selectedDivision = filter.division;
    this.bump();
  }

  openFavoritePools(): void {
    if (!this.event) {
      return;
    }

    this.showingFavoritePools = true;
    this.selectedCategory = null;
    this.selectedDivision = null;
    this.draftPool = null;
    this.expandedMatchId = null;
    void this.navigation.favoritePools(this.event.code);
    this.bump();
  }

  setFavoritePoolsFromRoute(showingFavorites: boolean): void {
    this.showingFavoritePools = showingFavorites;

    if (showingFavorites) {
      this.selectedCategory = null;
      this.selectedDivision = null;
    }

    this.bump();
  }

  togglePoolFavorite(poolId: string): void {
    const next = toggleFavoritePool(this.event, this.favoritePoolIds, poolId);

    if (!next) {
      return;
    }

    this.favoritePoolIds = next;
    this.persistPoolFavorites();
    this.bump();
  }

  setActivePool(poolId: string | null): boolean {
    this.activePoolId = poolId;

    if (!this.event || !poolId) {
      this.bump();
      return false;
    }

    const exists = this.event.pools.some((pool) => pool.id === poolId && canViewPool(pool, this.isAdmin));

    if (exists) {
      this.event.activePoolId = poolId;
      this.persistLocal();
    }

    this.bump();
    return exists;
  }

  redirectInvalidPool(poolId: string | null): void {
    if (
      !this.event ||
      !poolId ||
      this.event.pools.some((pool) => pool.id === poolId && canViewPool(pool, this.isAdmin))
    ) {
      return;
    }

    void this.navigation.event(this.event.code);
  }

  editPoolSetup(): void {
    const pool = this.event?.pools.find((candidate) => candidate.id === this.activePoolId);

    if (!pool || !this.isAdmin || !this.event) {
      return;
    }

    this.draftPool = clonePool(pool);
    this.resetScanState();
    void this.navigation.poolSetup(this.event.code, pool.id);
    this.bump();
  }

  startAddPool(): void {
    if (!this.event || !this.isAdmin) {
      return;
    }

    this.draftPool = createNewPoolDraft(this.event.pools);
    this.activePoolId = null;
    this.resetScanState();
    void this.navigation.newPool(this.event.code);
    this.bump();
  }

  editSeededDivision(selection: { category: string; division: string }): void {
    if (!this.event || !this.isAdmin) {
      return;
    }

    const draft = createSeededDivisionDraft(this.event.pools, selection);

    if (!draft) {
      this.eventError = 'No seeded source list is available for that category and division.';
      this.bump();
      return;
    }

    this.draftPool = draft;
    this.activePoolId = null;
    this.resetScanState();
    void this.navigation.newPool(this.event.code);
    this.bump();
  }

  startNewPoolDraft(): void {
    if (!this.event || !this.isAdmin) {
      return;
    }

    if (
      this.activePoolId === null &&
      this.draftPool &&
      !this.event.pools.some((pool) => pool.id === this.draftPool?.id)
    ) {
      return;
    }

    this.draftPool = createNewPoolDraft(this.event.pools);
    this.activePoolId = null;
    this.resetScanState();
    this.bump();
  }

  startEditPoolDraft(poolId: string): void {
    const pool = this.event?.pools.find((candidate) => candidate.id === poolId);

    if (!pool || !this.isAdmin) {
      return;
    }

    if (this.draftPool?.id === pool.id && this.activePoolId === poolId) {
      return;
    }

    this.draftPool = clonePool(pool);
    this.activePoolId = poolId;
    this.resetScanState();
    this.bump();
  }

  cancelSetup(): void {
    const poolId = this.draftPool?.id;
    this.draftPool = null;
    this.resetScanState();

    if (this.event) {
      const routePoolId = poolId && this.event.pools.some((pool) => pool.id === poolId) ? poolId : null;
      void this.navigation.poolOrEvent(this.event.code, routePoolId);
    }

    this.bump();
  }

  async savePoolSetup(): Promise<void> {
    const pool = this.draftPool;

    if (!this.event || !pool || !this.isAdmin) {
      return;
    }

    const existingPool = existingPoolForDraft(this.event.pools, pool);

    if (
      existingPool &&
      hasStartedScoring(existingPool) &&
      !confirm(
        'This pool already has scores. Saving setup changes may change standings or invalidate existing scores. Continue?'
      )
    ) {
      return;
    }

    pool.updatedAt = new Date().toISOString();
    this.event.pools = upsertPool(this.event.pools, pool);

    this.event.activePoolId = pool.id;
    this.activePoolId = pool.id;
    await this.persistPoolSetup(pool);
    this.draftPool = null;
    void this.navigation.pool(this.event.code, pool.id);
    this.bump();
  }

  async createSeededPools(payload: {
    pools: PoolState[];
    category: string;
    division: string;
    replaceDivisionPools: boolean;
  }): Promise<void> {
    if (!this.event || !this.isAdmin) {
      return;
    }

    const selection = normalizePoolSetupSelection(payload);
    const selectedDivisionPools = poolsForCategoryDivision(this.event.pools, selection);
    const overwritesScoredPools =
      payload.replaceDivisionPools && selectedDivisionPools.some((pool) => hasStartedScoring(pool));
    const confirmOverwriteScored =
      !overwritesScoredPools || confirm('This will replace pools in this division that already have scores. Continue?');

    if (!confirmOverwriteScored) {
      return;
    }

    const body = await this.api.replaceSeededPools(
      this.event.code,
      {
        division: selection.division,
        category: selection.category,
        replaceDivisionPools: payload.replaceDivisionPools,
        confirmOverwriteScored,
        pools: payload.pools
      },
      this.adminPassword
    );

    if (!body.event) {
      this.eventError =
        body.errors?.map((error) => error.message).join(' ') || body.message || body.error || 'Unable to create pools.';
      this.bump();
      return;
    }

    this.event = normalizeEventState(body.event, this.isAdmin);
    this.activePoolId = this.event.activePoolId;
    this.persistPoolFavorites();
    this.draftPool = null;
    this.expandedMatchId = null;
    this.persistLocal();
    await this.navigation.event(this.event.code);
    this.bump();
  }

  async publishDivision(selection: { category: string; division: string }): Promise<void> {
    if (!this.event || !this.isAdmin) {
      return;
    }

    const poolsToPublish = hiddenPoolsForCategoryDivision(this.event.pools, selection);

    if (poolsToPublish.length === 0) {
      return;
    }

    for (const pool of poolsToPublish) {
      publishPool(pool);
      await this.persistPoolSetup(pool);
    }

    this.persistLocal();
    this.bump();
  }

  openPoolTimer(poolId: string): void {
    if (!this.event) {
      return;
    }

    this.activePoolId = poolId;
    this.event.activePoolId = poolId;
    this.draftPool = null;
    this.expandedMatchId = null;
    this.persistLocal();
    void this.navigation.poolTimer(this.event.code, poolId);
    this.bump();
  }

  async deletePoolSetup(): Promise<void> {
    const pool = this.draftPool;

    if (!this.event || !pool || !this.isAdmin || !this.canDeleteActivePool) {
      return;
    }

    await this.deletePool(pool);
  }

  async deleteActivePool(): Promise<void> {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    await this.deletePool(pool);
  }

  async deletePoolById(poolId: string): Promise<void> {
    const pool = this.event?.pools.find((candidate) => candidate.id === poolId);

    if (!pool || !this.isAdmin) {
      return;
    }

    await this.deletePool(pool);
  }

  private async deletePool(pool: PoolState): Promise<void> {
    if (!this.event || !this.event.pools.some((candidate) => candidate.id === pool.id)) {
      return;
    }

    if (!confirm(`Delete ${pool.title}? This permanently removes the pool and its scores from the event.`)) {
      return;
    }

    try {
      this.event = normalizeEventState(await this.api.deletePool(this.event.code, pool.id, this.adminPassword), this.isAdmin);
    } catch (error) {
      this.eventError = error instanceof Error ? error.message : 'Unable to save event.';
      this.bump();
      return;
    }

    this.activePoolId = this.event.activePoolId;
    this.removePoolFavorite(pool.id);
    this.draftPool = null;
    this.expandedMatchId = null;
    this.resetScanState();
    this.persistLocal();
    await this.navigation.event(this.event.code);
    this.bump();
  }

  requestAdminRoute(targetUrl: string): void {
    this.pendingAdminRoute = targetUrl;
    this.showingAdminSignIn = true;
    this.bump();
  }

  async captureSheet(event: Event): Promise<void> {
    const pool = this.activePool;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!pool || !file) {
      return;
    }

    this.resetScanState();
    this.bump();

    try {
      pool.imagePreview = await this.poolSheetWorkflow.imagePreview(file);
      touchPool(pool);
    } catch {
      this.scanStatus = 'failed';
      this.scanError = 'Unable to load that Pool Sheet photo.';
    } finally {
      input.value = '';
      this.bump();
    }
  }

  async scanPoolSheet(): Promise<void> {
    const pool = this.activePool;

    if (!pool?.imagePreview || this.scanStatus === 'scanning') {
      return;
    }

    this.scanStatus = 'scanning';
    this.scanError = '';
    this.scanProgress = 'Preparing OCR...';
    this.bump();

    try {
      const body = await this.poolSheetWorkflow.scan(
        pool.imagePreview,
        this.adminPassword,
        (progress) => {
          this.zone.run(() => {
            this.scanProgress = progress;
            this.bump();
          });
        }
      );

      this.zone.run(() => {
        this.scanSummary = this.poolSheetWorkflow.applyScan(pool, body, this.event?.pools ?? []);
        this.expandedMatchId = null;
        this.scanStatus = 'success';
        this.scanProgress = '';
        this.bump();
      });
    } catch (error) {
      this.zone.run(() => {
        this.scanStatus = 'failed';
        this.scanProgress = '';
        this.scanError = error instanceof Error ? error.message : 'Unable to read the Pool Sheet photo.';
        this.bump();
      });
    }
  }

  changeTeamCount(value: number): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    const hasExistingMatches = pool.matches.length > 0;

    if (hasExistingMatches && !confirm('Changing team count will replace the current schedule and scores. Continue?')) {
      return;
    }

    applyTeamCountToPool(pool, value);
    this.expandedMatchId = null;
    touchPool(pool);
    this.bump();
  }

  applyGameFormat(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    applyGameFormatToPool(pool);
    touchPool(pool);
    this.bump();
  }

  addMatch(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    addMatchToPool(pool);
    touchPool(pool);
    this.bump();
  }

  applySchedulePreset(presetId: string): void {
    const pool = this.activePool;
    const preset = this.schedulePresets.find((candidate) => candidate.id === presetId);

    if (!pool || !preset || !this.isAdmin || preset.teamCount !== pool.teamCount) {
      return;
    }

    if (
      hasStartedScoring(pool) &&
      !confirm('Changing schedule will replace current matches and scores. Continue?')
    ) {
      return;
    }

    applySchedulePresetToPool(pool, preset.id);
    this.expandedMatchId = null;
    touchPool(pool);
    this.bump();
  }

  schedulePresetsFor(teamCount: number): SchedulePreset[] {
    return this.schedulePresets.filter((preset) => preset.teamCount === teamCount);
  }

  removeMatch(matchId: string): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    removeMatchFromPool(pool, matchId);
    if (this.expandedMatchId === matchId) {
      this.expandedMatchId = null;
    }
    touchPool(pool);
    this.bump();
  }

  async handleScoreChanged(match: Match, game: GameScore): Promise<void> {
    const pool = this.activePool;

    if (!pool || !canScorePool(pool, this.isAdmin)) {
      return;
    }

    capGameScore(game, pool.pointCap);
    this.showSideSwitchToastIfNeeded(pool, match, game);
    touchMatch(pool, match);
    this.persistLocal();
    const persisted = await this.persistMatch(pool, match);

    if (!persisted) {
      this.bump();
      return;
    }

    if (!pool.hidden) {
      this.realtime.publishMatch(pool, match);
    }
    this.bump();
  }

  async handleFinalChanged(match: Match): Promise<void> {
    const pool = this.activePool;

    if (!pool || !canScorePool(pool, this.isAdmin)) {
      return;
    }

    let timerAction: 'start' | 'clear' | undefined;

    if (match.final && shouldStartPoolTimer(pool, match)) {
      startPoolTimer(pool, match);
      timerAction = 'start';
    } else if (!match.final && pool.nextMatchStartSourceMatchId === match.id && clearPoolTimer(pool)) {
      timerAction = 'clear';
    }

    touchMatch(pool, match);
    this.persistLocal();
    const persisted = await this.persistMatch(pool, match, timerAction);

    if (persisted) {
      if (!pool.hidden) {
        this.realtime.publishMatch(pool, match);
      }
      if (timerAction && !pool.hidden) {
        this.realtime.publishPoolTimer(pool);
      }
    }

    this.bump();
  }

  async setExpanded(matchId: string, expanded: boolean): Promise<void> {
    const pool = this.activePool;
    const match = pool?.matches.find((candidate) => candidate.id === matchId);

    if (expanded && pool && !canScorePool(pool, this.isAdmin)) {
      this.expandedMatchId = null;
      this.bump();
      return;
    }

    this.expandedMatchId = expanded ? matchId : null;

    if (expanded && pool && match && clearPoolTimer(pool)) {
      touchPool(pool);
      this.persistLocal();
      const persisted = await this.persistMatch(pool, match, 'clear');

      if (persisted && !pool.hidden) {
        this.realtime.publishPoolTimer(pool);
      }
    }

    this.bump();
  }

  moveMatch(matchId: string, direction: -1 | 1): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    if (!moveMatchInPool(pool, matchId, direction)) {
      return;
    }

    touchPool(pool);
    this.bump();
  }

  save(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    touchPool(pool);
    this.bump();
  }

  dismissSideSwitchToast(): void {
    this.sideSwitchToast = null;
    this.clearSideSwitchToastTimeout();
    this.bump();
  }

  private async loadOrCreateEvent(create: boolean): Promise<void> {
    this.loadingEvent = true;
    this.eventError = '';
    this.bump();

    try {
      const code = normalizeEventCode(this.eventCode);
      const event = create
        ? await this.api.createEvent(code, this.eventName.trim() || code, this.adminPassword)
        : await this.api.loadEvent(code);
      this.event = normalizeEventState(event, this.isAdmin);
      this.eventCode = this.event.code;
      this.eventName = this.event.name;
      this.activePoolId = this.event.activePoolId;
      this.loadPoolFavorites();
      this.persistLocal();
      await this.realtime.connect(this.event.code);
      await this.navigation.event(this.event.code);
    } catch (error) {
      this.eventError = error instanceof Error ? error.message : 'Unable to open event.';
    } finally {
      this.loadingEvent = false;
      this.bump();
    }
  }

  private async persistPoolSetup(pool: PoolState): Promise<void> {
    if (!this.event || this.applyingRemoteState) {
      return;
    }

    this.event.updatedAt = new Date().toISOString();
    this.persistLocal();

    try {
      await this.api.savePoolSetup(this.event, pool, this.adminPassword);
    } catch (error) {
      this.eventError = error instanceof Error ? error.message : 'Unable to save event.';
    }
  }

  private async persistMatch(pool: PoolState, match: Match, timerAction?: 'start' | 'clear'): Promise<boolean> {
    if (!this.event || this.applyingRemoteState) {
      return false;
    }

    this.event.updatedAt = new Date().toISOString();
    this.persistLocal();

    try {
      await this.api.saveMatch(
        this.event.code,
        pool,
        match,
        timerAction,
        this.adminPassword,
        this.isAdmin && (pool.hidden || !pool.editable)
      );
    } catch (error) {
      this.eventError = error instanceof Error ? error.message : 'Unable to save event.';
      return false;
    }

    return true;
  }

  private applyRemoteEvent(remote: EventState): void {
    if (!this.event || remote.code !== this.event.code) {
      return;
    }

    this.applyingRemoteState = true;
    this.event = mergeEvents(this.event, normalizeEventState(remote, this.isAdmin), this.isAdmin);
    this.persistLocal();
    this.applyingRemoteState = false;
    this.bump();
  }

  private applyRemotePoolSetup(remote: PoolState): void {
    if (!this.event) {
      return;
    }

    this.applyingRemoteState = true;
    const changed = applyRemotePoolSetupToEvent(this.event, remote, this.isAdmin);
    if (changed) {
      this.persistLocal();
    }
    this.applyingRemoteState = false;
    this.bump();
  }

  private applyRemotePoolDeleted(poolId: string): void {
    if (!this.event) {
      return;
    }

    const result = applyRemotePoolDeletedToEvent(this.event, poolId, this.activePoolId);

    if (!result.changed) {
      return;
    }

    if (result.deletedActivePool) {
      this.activePoolId = this.event.activePoolId;
    }

    if (this.draftPool?.id === poolId || result.deletedActivePool) {
      this.draftPool = null;
      this.expandedMatchId = null;
      void this.navigation.event(this.event.code);
    }

    this.removePoolFavorite(poolId);
    this.persistLocal();
    this.bump();
  }

  private applyRemoteMatch(poolId: string, remote: Match): void {
    if (!this.event) {
      return;
    }

    this.applyingRemoteState = true;
    const changed = applyRemoteMatchToEvent(this.event, poolId, remote);
    if (!changed) {
      this.applyingRemoteState = false;
      return;
    }

    this.persistLocal();
    this.applyingRemoteState = false;
    this.bump();
  }

  private applyRemotePoolTimer(poolId: string, timer: PoolTimerUpdate): void {
    if (!this.event) {
      return;
    }

    this.applyingRemoteState = true;
    const changed = applyRemotePoolTimerToEvent(this.event, poolId, timer);
    if (!changed) {
      this.applyingRemoteState = false;
      return;
    }

    this.persistLocal();
    this.applyingRemoteState = false;
    this.bump();
  }

  private persistLocal(): void {
    if (!this.event) {
      return;
    }

    this.storage.saveEvent(this.event, this.isAdmin);
  }

  private loadPoolFavorites(): void {
    if (!this.event) {
      this.favoritePoolIds = new Set<string>();
      return;
    }

    this.favoritePoolIds = this.storage.loadFavoritePoolIds(this.event);
    this.persistPoolFavorites();
  }

  private persistPoolFavorites(): void {
    if (!this.event) {
      return;
    }

    this.favoritePoolIds = pruneFavoritePools(this.event, this.favoritePoolIds);
    this.storage.saveFavoritePoolIds(this.event, this.favoritePoolIds);
  }

  private removePoolFavorite(poolId: string): void {
    const next = removeFavoritePool(this.favoritePoolIds, poolId);

    if (!next) {
      return;
    }

    this.favoritePoolIds = next;
    this.persistPoolFavorites();
  }

  private showSideSwitchToastIfNeeded(pool: PoolState, match: Match, game: GameScore): void {
    const result = sideSwitchToastForScore(pool, match, game, this.lastSideSwitchKey);
    this.lastSideSwitchKey = result.lastKey;

    if (!result.toast) {
      return;
    }

    this.sideSwitchToast = result.toast;
    this.clearSideSwitchToastTimeout();
    this.sideSwitchToastTimeout = window.setTimeout(() => {
      this.zone.run(() => {
        this.sideSwitchToast = null;
        this.sideSwitchToastTimeout = null;
        this.bump();
      });
    }, 10000);
  }

  private clearSideSwitchToastTimeout(): void {
    if (this.sideSwitchToastTimeout == null) {
      return;
    }

    window.clearTimeout(this.sideSwitchToastTimeout);
    this.sideSwitchToastTimeout = null;
  }

  private resetScanState(): void {
    this.scanError = '';
    this.scanProgress = '';
    this.scanSummary = null;
    this.scanStatus = 'idle';
  }

  private bump(): void {
    this.version.update((value) => value + 1);
  }
}
