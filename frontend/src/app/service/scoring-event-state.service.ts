import { Injectable, NgZone, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  DivisionPoolGroup,
  CsvImportResponse,
  CsvImportRow,
  EventState,
  GameScore,
  Match,
  PoolCard,
  PoolTimerUpdate,
  PoolState,
  ScanSummary,
  SeededPoolsResponse,
  SheetScanResult,
  TeamStanding
} from '../models';
import { DIVISION_OPTIONS, divisionSortIndex, normalizeDivision } from '../util/division-rules';
import {
  createDefaultPool,
  createGames,
  createPresetMatches,
  createTemplateMatches,
  defaultTargetScore,
  defaultCap,
  TEAM_COUNT_OPTIONS
} from '../util/pool-setup-rules';
import { SCHEDULE_PRESETS } from '../util/schedule-presets';
import type { SchedulePreset } from '../util/schedule-presets';
import { clampWholeNumber, createId, resizeGamesForCount, seedOrNull, wholeNumber } from '../util/scoring-helpers';
import { buildPoolCard, buildStandings, teamName } from '../util/standings-rules';
import { applySheetScanToPool, buildScanSummary } from './sheet-scan-mapper';
import { SheetScannerService } from './sheet-scanner.service';
import { ScoringRealtimeService } from './scoring-realtime.service';

const CURRENT_EVENT_KEY = 'cheabs.liveScoring.currentEvent.v1';
const ADMIN_PASSWORD_KEY = 'cheabs.liveScoring.adminPassword.v1';
const POOL_FAVORITES_KEY_PREFIX = 'cheabs.liveScoring.poolFavorites.v1.';

interface SideSwitchToast {
  message: string;
  detail: string;
}

@Injectable({ providedIn: 'root' })
export class ScoringEventStateService {
  private remoteSubscription?: Subscription;
  private remotePoolSetupSubscription?: Subscription;
  private remotePoolDeletedSubscription?: Subscription;
  private remoteMatchSubscription?: Subscription;
  private remotePoolTimerSubscription?: Subscription;
  private snapshotRequestSubscription?: Subscription;
  private applyingRemoteState = false;
  private initialized = false;
  private sideSwitchToastTimeout: number | null = null;
  private lastSideSwitchKey: string | null = null;
  private pendingAdminRoute: string | null = null;

  readonly version = signal(0);
  readonly teamCountOptions = TEAM_COUNT_OPTIONS;
  readonly divisionOptions = DIVISION_OPTIONS;
  readonly schedulePresets = SCHEDULE_PRESETS;
  readonly realtimeStatus$ = this.realtime.status$;

  adminPassword = sessionStorage.getItem(ADMIN_PASSWORD_KEY) ?? '';
  isAdmin = Boolean(this.adminPassword);
  event: EventState | null = null;
  eventCode = localStorage.getItem(CURRENT_EVENT_KEY) ?? '';
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
  selectedDivision: string | null = null;
  showingFavoritePools = false;
  favoritePoolIds = new Set<string>();

  constructor(
    private readonly zone: NgZone,
    private readonly realtime: ScoringRealtimeService,
    private readonly scanner: SheetScannerService,
    private readonly router: Router
  ) {}

  init(): void {
    if (this.initialized) {
      return;
    }

    this.initialized = true;
    this.remoteSubscription = this.realtime.remoteEvent$.subscribe((event) => {
      this.zone.run(() => this.applyRemoteEvent(event));
    });
    this.remotePoolSetupSubscription = this.realtime.remotePoolSetup$.subscribe((pool) => {
      this.zone.run(() => this.applyRemotePoolSetup(pool));
    });
    this.remotePoolDeletedSubscription = this.realtime.remotePoolDeleted$.subscribe((poolId) => {
      this.zone.run(() => this.applyRemotePoolDeleted(poolId));
    });
    this.remoteMatchSubscription = this.realtime.remoteMatch$.subscribe(({ poolId, match }) => {
      this.zone.run(() => this.applyRemoteMatch(poolId, match));
    });
    this.remotePoolTimerSubscription = this.realtime.remotePoolTimer$.subscribe(({ poolId, timer }) => {
      this.zone.run(() => this.applyRemotePoolTimer(poolId, timer));
    });
    this.snapshotRequestSubscription = this.realtime.snapshotRequest$.subscribe(() => {
      if (this.event) {
        this.realtime.publishSnapshot(this.eventWithoutImages(this.event));
      }
    });
  }

  destroy(): void {
    this.remoteSubscription?.unsubscribe();
    this.remotePoolSetupSubscription?.unsubscribe();
    this.remotePoolDeletedSubscription?.unsubscribe();
    this.remoteMatchSubscription?.unsubscribe();
    this.remotePoolTimerSubscription?.unsubscribe();
    this.snapshotRequestSubscription?.unsubscribe();
    this.remoteSubscription = undefined;
    this.remotePoolSetupSubscription = undefined;
    this.remotePoolDeletedSubscription = undefined;
    this.remoteMatchSubscription = undefined;
    this.remotePoolTimerSubscription = undefined;
    this.snapshotRequestSubscription = undefined;
    this.initialized = false;
    this.realtime.close();
    this.clearSideSwitchToastTimeout();
  }

  get activePool(): PoolState | null {
    if (this.draftPool) {
      return this.draftPool;
    }

    return this.event?.pools.find((pool) => pool.id === this.activePoolId) ?? null;
  }

  get poolCards(): PoolCard[] {
    return this.event?.pools.map((pool) => buildPoolCard(pool)) ?? [];
  }

  get allDivisionPoolGroups(): DivisionPoolGroup[] {
    const groups = new Map<string, PoolCard[]>();

    for (const card of this.poolCards) {
      const division = normalizeDivision(card.pool.division);
      groups.set(division, [...(groups.get(division) ?? []), card]);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => divisionSortIndex(left) - divisionSortIndex(right) || left.localeCompare(right))
      .map(([division, cards]) => ({ division, cards }));
  }

  get divisionPoolGroups(): DivisionPoolGroup[] {
    const groups = new Map<string, PoolCard[]>();

    for (const card of this.visiblePoolCards) {
      const division = normalizeDivision(card.pool.division);
      groups.set(division, [...(groups.get(division) ?? []), card]);
    }

    return [...groups.entries()]
      .sort(([left], [right]) => divisionSortIndex(left) - divisionSortIndex(right) || left.localeCompare(right))
      .map(([division, cards]) => ({ division, cards }));
  }

  get visibleDivisionPoolGroups(): DivisionPoolGroup[] {
    if (this.showingFavoritePools || !this.selectedDivision) {
      return this.divisionPoolGroups;
    }

    return this.divisionPoolGroups.filter((group) => group.division === this.selectedDivision);
  }

  get visiblePoolCards(): PoolCard[] {
    return this.showingFavoritePools
      ? this.poolCards.filter((card) => this.favoritePoolIds.has(card.pool.id))
      : this.poolCards;
  }

  get favoritePoolCount(): number {
    return this.poolCards.filter((card) => this.favoritePoolIds.has(card.pool.id)).length;
  }

  get favoritePoolIdList(): string[] {
    return [...this.favoritePoolIds];
  }

  poolCountForDivision(division: string): number {
    return this.event?.pools.filter((pool) => pool.division === division).length ?? 0;
  }

  get divisionFilterOptions(): { division: string; count: number }[] {
    return this.allDivisionPoolGroups.map((group) => ({
      division: group.division,
      count: group.cards.length
    }));
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
    const code = this.normalizeEventCode(eventCode);

    if (this.event?.code === code) {
      return;
    }

    this.loadingEvent = true;
    this.eventError = '';
    this.bump();

    try {
      const response = await fetch(`/api/scoring/events/${code}`);

      if (!response.ok) {
        throw new Error(await this.errorMessage(response));
      }

      const body = (await response.json()) as { event: EventState };
      this.event = this.normalizeEvent(body.event);
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
      void this.router.navigate(['/']);
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
      const response = await fetch('/api/scoring/events/import', {
        method: 'POST',
        headers: this.adminHeaders(),
        body: JSON.stringify({ fileName, rows })
      });
      const body = (await response.json().catch(() => ({}))) as CsvImportResponse;

      if (!response.ok || !body.event) {
        return {
          errors: body.errors ?? [{ lineNumber: null, message: body.message || body.error || 'Import failed.' }],
          warnings: body.warnings ?? []
        };
      }

      this.event = this.normalizeEvent(body.event);
      this.eventCode = this.event.code;
      this.eventName = this.event.name;
      this.activePoolId = this.event.activePoolId;
      this.draftPool = null;
      this.loadPoolFavorites();
      this.persistLocal();
      await this.router.navigate(['/events', this.event.code]);
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
      const response = await fetch('/api/scoring/admin-login', {
        method: 'POST',
        headers: this.adminHeaders()
      });

      if (!response.ok) {
        throw new Error(await this.errorMessage(response));
      }

      this.isAdmin = true;
      this.showingAdminSignIn = false;
      sessionStorage.setItem(ADMIN_PASSWORD_KEY, this.adminPassword);

      if (this.pendingAdminRoute) {
        const route = this.pendingAdminRoute;
        this.pendingAdminRoute = null;
        await this.router.navigateByUrl(route);
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
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
    this.bump();
  }

  chooseEvent(): void {
    this.realtime.close();
    this.event = null;
    this.eventName = '';
    this.draftPool = null;
    this.activePoolId = null;
    this.expandedMatchId = null;
    this.selectedDivision = null;
    this.showingFavoritePools = false;
    this.favoritePoolIds = new Set<string>();
    this.dismissSideSwitchToast();
    localStorage.removeItem(CURRENT_EVENT_KEY);
    void this.router.navigate(['/']);
    this.bump();
  }

  openDashboard(): void {
    if (!this.event) {
      return;
    }

    this.draftPool = null;
    this.expandedMatchId = null;
    this.showingFavoritePools = false;
    void this.router.navigate(['/events', this.event.code], {
      queryParams: this.selectedDivision ? { division: this.selectedDivision } : undefined
    });
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
    void this.router.navigate(['/events', this.event.code, 'pools', poolId]);
    this.bump();
  }

  selectDivision(division: string | null): void {
    this.selectedDivision = division;
    this.showingFavoritePools = false;
    this.draftPool = null;
    this.expandedMatchId = null;

    if (this.event) {
      void this.router.navigate(['/events', this.event.code], {
        queryParams: division ? { division } : {}
      });
    }

    this.bump();
  }

  setSelectedDivisionFromRoute(division: string | null): void {
    const normalized = division ? normalizeDivision(division) : null;
    this.selectedDivision = normalized && normalized === division ? normalized : null;
    this.bump();
  }

  openFavoritePools(): void {
    if (!this.event) {
      return;
    }

    this.showingFavoritePools = true;
    this.selectedDivision = null;
    this.draftPool = null;
    this.expandedMatchId = null;
    void this.router.navigate(['/events', this.event.code], {
      queryParams: { favorites: '1' }
    });
    this.bump();
  }

  setFavoritePoolsFromRoute(showingFavorites: boolean): void {
    this.showingFavoritePools = showingFavorites;

    if (showingFavorites) {
      this.selectedDivision = null;
    }

    this.bump();
  }

  togglePoolFavorite(poolId: string): void {
    if (!this.event?.pools.some((pool) => pool.id === poolId)) {
      return;
    }

    const next = new Set(this.favoritePoolIds);

    if (next.has(poolId)) {
      next.delete(poolId);
    } else {
      next.add(poolId);
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

    const exists = this.event.pools.some((pool) => pool.id === poolId);

    if (exists) {
      this.event.activePoolId = poolId;
      this.persistLocal();
    }

    this.bump();
    return exists;
  }

  redirectInvalidPool(poolId: string | null): void {
    if (!this.event || !poolId || this.event.pools.some((pool) => pool.id === poolId)) {
      return;
    }

    void this.router.navigate(['/events', this.event.code]);
  }

  editPoolSetup(): void {
    const pool = this.event?.pools.find((candidate) => candidate.id === this.activePoolId);

    if (!pool || !this.isAdmin || !this.event) {
      return;
    }

    this.draftPool = this.clonePool(pool);
    this.resetScanState();
    void this.router.navigate(['/events', this.event.code, 'pools', pool.id, 'setup']);
    this.bump();
  }

  startAddPool(): void {
    if (!this.event || !this.isAdmin) {
      return;
    }

    this.draftPool = createDefaultPool(this.nextPoolTitle());
    this.activePoolId = null;
    this.resetScanState();
    void this.router.navigate(['/events', this.event.code, 'new-pool']);
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

    this.draftPool = createDefaultPool(this.nextPoolTitle());
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

    this.draftPool = this.clonePool(pool);
    this.activePoolId = poolId;
    this.resetScanState();
    this.bump();
  }

  cancelSetup(): void {
    const poolId = this.draftPool?.id;
    this.draftPool = null;
    this.resetScanState();

    if (this.event) {
      void this.router.navigate(
        poolId && this.event.pools.some((pool) => pool.id === poolId)
          ? ['/events', this.event.code, 'pools', poolId]
          : ['/events', this.event.code]
      );
    }

    this.bump();
  }

  async savePoolSetup(): Promise<void> {
    const pool = this.draftPool;

    if (!this.event || !pool || !this.isAdmin) {
      return;
    }

    const existingPool = this.event.pools.find((candidate) => candidate.id === pool.id);

    if (
      existingPool &&
      this.hasStartedScoring(existingPool) &&
      !confirm(
        'This pool already has scores. Saving setup changes may change standings or invalidate existing scores. Continue?'
      )
    ) {
      return;
    }

    pool.updatedAt = new Date().toISOString();
    const existingIndex = this.event.pools.findIndex((candidate) => candidate.id === pool.id);

    if (existingIndex >= 0) {
      this.event.pools = this.event.pools.map((candidate) => (candidate.id === pool.id ? pool : candidate));
    } else {
      this.event.pools = [...this.event.pools, pool];
    }

    this.event.activePoolId = pool.id;
    this.activePoolId = pool.id;
    await this.persistPoolSetup(pool);
    this.draftPool = null;
    void this.router.navigate(['/events', this.event.code, 'pools', pool.id]);
    this.bump();
  }

  async createSeededPools(payload: {
    pools: PoolState[];
    division: string;
    replaceDivisionPools: boolean;
  }): Promise<void> {
    if (!this.event || !this.isAdmin) {
      return;
    }

    const selectedDivisionPools = this.event.pools.filter((pool) => pool.division === payload.division);
    const overwritesScoredPools =
      payload.replaceDivisionPools && selectedDivisionPools.some((pool) => this.hasStartedScoring(pool));
    const confirmOverwriteScored =
      !overwritesScoredPools ||
      confirm('This will replace pools in this division that already have scores. Continue?');

    if (!confirmOverwriteScored) {
      return;
    }

    const response = await fetch(`/api/scoring/events/${this.event.code}/pools/bulk`, {
      method: 'PUT',
      headers: this.adminHeaders(),
      body: JSON.stringify({
        division: payload.division,
        replaceDivisionPools: payload.replaceDivisionPools,
        confirmOverwriteScored,
        pools: payload.pools.map((pool) => this.poolWithoutImage(pool))
      })
    });
    const body = (await response.json().catch(() => ({}))) as SeededPoolsResponse;

    if (!response.ok || !body.event) {
      this.eventError =
        body.errors?.map((error) => error.message).join(' ') || body.message || body.error || 'Unable to create pools.';
      this.bump();
      return;
    }

    this.event = this.normalizeEvent(body.event);
    this.activePoolId = this.event.activePoolId;
    this.persistPoolFavorites();
    this.draftPool = null;
    this.expandedMatchId = null;
    this.persistLocal();
    await this.router.navigate(['/events', this.event.code]);
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
    void this.router.navigate(['/events', this.event.code, 'pools', poolId, 'timer']);
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

    const response = await fetch(`/api/scoring/events/${this.event.code}/pools/${pool.id}`, {
      method: 'DELETE',
      headers: this.adminHeaders()
    });

    if (!response.ok) {
      this.eventError = await this.errorMessage(response);
      this.bump();
      return;
    }

    const body = (await response.json()) as { event: EventState };
    this.event = this.normalizeEvent(body.event);
    this.activePoolId = this.event.activePoolId;
    this.removePoolFavorite(pool.id);
    this.draftPool = null;
    this.expandedMatchId = null;
    this.resetScanState();
    this.persistLocal();
    await this.router.navigate(['/events', this.event.code]);
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
      pool.imagePreview = await this.readPoolSheetImage(file);
      this.touchPool(pool);
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
      const body = await this.scanner.scan(
        pool.imagePreview,
        (progress) => {
          this.zone.run(() => {
            this.scanProgress = this.formatScanProgress(progress.status, progress.progress);
            this.bump();
          });
        },
        this.adminPassword
      );

      this.zone.run(() => {
        this.applySheetScan(pool, body);
        this.scanSummary = buildScanSummary(pool, body);
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

    const count = clampWholeNumber(value, 3, 7);
    const hasExistingMatches = pool.matches.length > 0;

    if (hasExistingMatches && !confirm('Changing team count will replace the current schedule and scores. Continue?')) {
      return;
    }

    pool.teamCount = count;
    pool.teams = Array.from({ length: count }, (_, index) => {
      const seed = index + 1;
      return pool.teams.find((team) => team.seed === seed) ?? { seed, name: `Team ${seed}` };
    });
    pool.matches = createTemplateMatches(count, pool.gamesPerMatch);
    pool.targetScore = defaultTargetScore(count);
    pool.pointCap = defaultCap(count);
    this.expandedMatchId = null;
    this.touchPool(pool);
    this.bump();
  }

  applyGameFormat(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    pool.gamesPerMatch = clampWholeNumber(pool.gamesPerMatch, 1, 5);
    pool.targetScore = clampWholeNumber(pool.targetScore, 1, 99);
    pool.pointCap = pool.pointCap == null ? null : Math.max(pool.targetScore, clampWholeNumber(pool.pointCap, 1, 99));
    pool.matches = pool.matches.map((match) => ({
      ...match,
      games: resizeGamesForCount(match.games, pool.gamesPerMatch).map((game) => this.capGameScore(game, pool.pointCap))
    }));
    this.touchPool(pool);
    this.bump();
  }

  addMatch(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    const match: Match = {
      id: createId(),
      refSeed: pool.teams[2]?.seed ?? null,
      teamASeed: pool.teams[0]?.seed ?? null,
      teamBSeed: pool.teams[1]?.seed ?? null,
      games: createGames(pool.gamesPerMatch),
      final: false,
      updatedAt: new Date().toISOString()
    };
    pool.matches.push(match);
    this.touchPool(pool);
    this.bump();
  }

  applySchedulePreset(presetId: string): void {
    const pool = this.activePool;
    const preset = this.schedulePresets.find((candidate) => candidate.id === presetId);

    if (!pool || !preset || !this.isAdmin || preset.teamCount !== pool.teamCount) {
      return;
    }

    if (this.hasStartedScoring(pool) && !confirm('Changing schedule will replace current matches and scores. Continue?')) {
      return;
    }

    pool.matches = createPresetMatches(preset.id, pool.gamesPerMatch);
    this.expandedMatchId = null;
    this.touchPool(pool);
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

    pool.matches = pool.matches.filter((match) => match.id !== matchId);
    if (this.expandedMatchId === matchId) {
      this.expandedMatchId = null;
    }
    this.touchPool(pool);
    this.bump();
  }

  handleScoreChanged(match: Match, game: GameScore): void {
    const pool = this.activePool;

    if (!pool) {
      return;
    }

    this.capGameScore(game, pool.pointCap);
    this.showSideSwitchToastIfNeeded(pool, match, game);
    this.touchMatch(pool, match);
    this.persistLocal();
    this.realtime.publishMatch(pool, match);
    this.bump();
  }

  async handleFinalChanged(match: Match): Promise<void> {
    const pool = this.activePool;

    if (!pool) {
      return;
    }

    let timerAction: 'start' | 'clear' | undefined;

    if (match.final && this.shouldStartPoolTimer(pool, match)) {
      this.startPoolTimer(pool, match);
      timerAction = 'start';
    } else if (!match.final && pool.nextMatchStartSourceMatchId === match.id && this.clearPoolTimer(pool)) {
      timerAction = 'clear';
    }

    this.touchMatch(pool, match);
    this.persistLocal();
    this.realtime.publishMatch(pool, match);
    if (timerAction) {
      this.realtime.publishPoolTimer(pool);
    }

    await this.persistMatch(pool, match, timerAction);

    this.bump();
  }

  setExpanded(matchId: string, expanded: boolean): void {
    const pool = this.activePool;
    const match = pool?.matches.find((candidate) => candidate.id === matchId);

    this.expandedMatchId = expanded ? matchId : null;

    if (expanded && pool && match && this.clearPoolTimer(pool)) {
      this.touchPool(pool);
      this.persistLocal();
      this.realtime.publishPoolTimer(pool);
      void this.persistMatch(pool, match, 'clear');
    }

    this.bump();
  }

  moveMatch(matchId: string, direction: -1 | 1): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    const index = pool.matches.findIndex((match) => match.id === matchId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= pool.matches.length) {
      return;
    }

    const matches = [...pool.matches];
    const [match] = matches.splice(index, 1);
    matches.splice(nextIndex, 0, match);
    pool.matches = matches;
    this.touchPool(pool);
    this.bump();
  }

  save(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    this.touchPool(pool);
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
      const code = this.normalizeEventCode(this.eventCode);
      const response = await fetch(create ? '/api/scoring/events' : `/api/scoring/events/${code}`, {
        method: create ? 'POST' : 'GET',
        headers: create ? this.adminHeaders() : undefined,
        body: create ? JSON.stringify({ code, name: this.eventName.trim() || code }) : undefined
      });

      if (!response.ok) {
        throw new Error(await this.errorMessage(response));
      }

      const body = (await response.json()) as { event: EventState };
      this.event = this.normalizeEvent(body.event);
      this.eventCode = this.event.code;
      this.eventName = this.event.name;
      this.activePoolId = this.event.activePoolId;
      this.loadPoolFavorites();
      this.persistLocal();
      await this.realtime.connect(this.event.code);
      await this.router.navigate(['/events', this.event.code]);
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

    const response = await fetch(`/api/scoring/events/${this.event.code}/pools/${pool.id}`, {
      method: 'PUT',
      headers: this.adminHeaders(),
      body: JSON.stringify({
        eventName: this.event.name,
        activePoolId: pool.id,
        pool: this.poolWithoutImage(pool)
      })
    });

    if (!response.ok) {
      this.eventError = await this.errorMessage(response);
    }
  }

  private async persistMatch(pool: PoolState, match: Match, timerAction?: 'start' | 'clear'): Promise<void> {
    if (!this.event || this.applyingRemoteState) {
      return;
    }

    this.event.updatedAt = new Date().toISOString();
    this.persistLocal();

    const response = await fetch(`/api/scoring/events/${this.event.code}/pools/${pool.id}/matches/${match.id}`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ match, timerAction })
    });

    if (!response.ok) {
      this.eventError = await this.errorMessage(response);
    }
  }

  private applyRemoteEvent(remote: EventState): void {
    if (!this.event || remote.code !== this.event.code) {
      return;
    }

    this.applyingRemoteState = true;
    this.event = this.mergeEvents(this.event, this.normalizeEvent(remote));
    this.persistLocal();
    this.applyingRemoteState = false;
    this.bump();
  }

  private applyRemotePoolSetup(remote: PoolState): void {
    if (!this.event) {
      return;
    }

    const pool = this.normalizePool(remote);
    const existingIndex = this.event.pools.findIndex((candidate) => candidate.id === pool.id);
    this.applyingRemoteState = true;

    if (existingIndex >= 0) {
      this.event.pools = this.event.pools.map((candidate) => (candidate.id === pool.id ? pool : candidate));
    } else {
      this.event.pools = [...this.event.pools, pool];
    }

    this.persistLocal();
    this.applyingRemoteState = false;
    this.bump();
  }

  private applyRemotePoolDeleted(poolId: string): void {
    if (!this.event || !this.event.pools.some((pool) => pool.id === poolId)) {
      return;
    }

    const deletedActivePool = this.activePoolId === poolId;
    this.event.pools = this.event.pools.filter((pool) => pool.id !== poolId);
    this.event.activePoolId =
      this.event.activePoolId === poolId ? (this.event.pools[0]?.id ?? null) : this.event.activePoolId;

    if (deletedActivePool) {
      this.activePoolId = this.event.activePoolId;
    }

    if (this.draftPool?.id === poolId || deletedActivePool) {
      this.draftPool = null;
      this.expandedMatchId = null;
      void this.router.navigate(['/events', this.event.code]);
    }

    this.removePoolFavorite(poolId);
    this.persistLocal();
    this.bump();
  }

  private applyRemoteMatch(poolId: string, remote: Match): void {
    if (!this.event) {
      return;
    }

    const pool = this.event.pools.find((candidate) => candidate.id === poolId);

    if (!pool) {
      return;
    }

    const match = this.normalizeMatch(remote, pool.gamesPerMatch, pool.pointCap, pool.teamCount);
    const existingIndex = pool.matches.findIndex((candidate) => candidate.id === match.id);

    if (existingIndex < 0 || this.isNewer(match.updatedAt, pool.matches[existingIndex].updatedAt)) {
      this.applyingRemoteState = true;
      if (existingIndex >= 0) {
        pool.matches = pool.matches.map((candidate) => (candidate.id === match.id ? match : candidate));
      } else {
        pool.matches = [...pool.matches, match];
      }
      pool.updatedAt = match.updatedAt;
      this.persistLocal();
      this.applyingRemoteState = false;
      this.bump();
    }
  }

  private applyRemotePoolTimer(poolId: string, timer: PoolTimerUpdate): void {
    if (!this.event) {
      return;
    }

    const pool = this.event.pools.find((candidate) => candidate.id === poolId);

    if (!pool) {
      return;
    }

    this.applyingRemoteState = true;
    pool.nextMatchStartAt = typeof timer.nextMatchStartAt === 'string' ? timer.nextMatchStartAt : null;
    pool.nextMatchStartSourceMatchId =
      pool.nextMatchStartAt && typeof timer.nextMatchStartSourceMatchId === 'string'
        ? timer.nextMatchStartSourceMatchId
        : null;
    this.touchPool(pool);
    this.persistLocal();
    this.applyingRemoteState = false;
    this.bump();
  }

  private mergeEvents(local: EventState, remote: EventState): EventState {
    const pools = new Map<string, PoolState>();

    for (const pool of local.pools) {
      pools.set(pool.id, pool);
    }

    for (const remotePool of remote.pools) {
      const localPool = pools.get(remotePool.id);

      if (!localPool) {
        pools.set(remotePool.id, remotePool);
      } else if (this.isNewer(remotePool.updatedAt, localPool.updatedAt)) {
        pools.set(remotePool.id, this.mergePoolMatches(localPool, remotePool));
      }
    }

    return {
      ...local,
      name: remote.name || local.name,
      pools: [...pools.values()],
      activePoolId: local.activePoolId ?? remote.activePoolId,
      updatedAt: this.isNewer(remote.updatedAt, local.updatedAt) ? remote.updatedAt : local.updatedAt
    };
  }

  private mergePoolMatches(local: PoolState, remote: PoolState): PoolState {
    const matches = new Map<string, Match>();

    for (const match of local.matches) {
      matches.set(match.id, match);
    }

    for (const remoteMatch of remote.matches) {
      const localMatch = matches.get(remoteMatch.id);

      if (!localMatch || this.isNewer(remoteMatch.updatedAt, localMatch.updatedAt)) {
        matches.set(remoteMatch.id, remoteMatch);
      }
    }

    return {
      ...remote,
      matches: remote.matches.map((match) => matches.get(match.id) ?? match)
    };
  }

  private normalizeEvent(event: EventState): EventState {
    const pools = Array.isArray(event.pools) ? event.pools.map((pool) => this.normalizePool(pool)) : [];
    const activePoolId =
      typeof event.activePoolId === 'string' && pools.some((pool) => pool.id === event.activePoolId)
        ? event.activePoolId
        : (pools[0]?.id ?? null);

    return {
      code: this.normalizeEventCode(event.code),
      name: typeof event.name === 'string' && event.name.trim() ? event.name.trim() : event.code,
      pools,
      activePoolId,
      updatedAt: typeof event.updatedAt === 'string' ? event.updatedAt : null
    };
  }

  private normalizePool(pool: PoolState): PoolState {
    const baseline = createDefaultPool();
    const teamCount = clampWholeNumber(pool.teamCount, 3, 7);
    const gamesPerMatch = clampWholeNumber(pool.gamesPerMatch, 1, 5);
    const targetScore = pool.targetScore == null ? defaultTargetScore(teamCount) : clampWholeNumber(pool.targetScore, 1, 99);
    const pointCap = pool.pointCap == null ? null : Math.max(targetScore, clampWholeNumber(pool.pointCap, 1, 99));
    const matchStartTimerMinutes = clampWholeNumber(pool.matchStartTimerMinutes ?? 10, 0, 99);
    const nextMatchStartAt =
      matchStartTimerMinutes > 0 && typeof pool.nextMatchStartAt === 'string' ? pool.nextMatchStartAt : null;
    const nextMatchStartSourceMatchId =
      nextMatchStartAt && typeof pool.nextMatchStartSourceMatchId === 'string'
        ? pool.nextMatchStartSourceMatchId
        : null;
    const sourceTeams = Array.isArray(pool.teams) ? pool.teams : [];
    const teams = Array.from({ length: teamCount }, (_, index) => {
      const seed = index + 1;
      return sourceTeams.find((team) => team.seed === seed) ?? { seed, name: `Team ${seed}` };
    });

    return {
      id: typeof pool.id === 'string' && pool.id.trim() ? pool.id : baseline.id,
      title: typeof pool.title === 'string' && pool.title.trim() ? pool.title : baseline.title,
      division: normalizeDivision(pool.division),
      teamCount,
      gamesPerMatch,
      targetScore,
      pointCap,
      matchStartTimerMinutes,
      nextMatchStartAt,
      nextMatchStartSourceMatchId,
      teams,
      matches: Array.isArray(pool.matches)
        ? pool.matches.map((match) => this.normalizeMatch(match, gamesPerMatch, pointCap, teamCount))
        : [],
      imagePreview: typeof pool.imagePreview === 'string' ? pool.imagePreview : null,
      updatedAt: typeof pool.updatedAt === 'string' ? pool.updatedAt : null
    };
  }

  private persistLocal(): void {
    if (!this.event) {
      return;
    }

    localStorage.setItem(CURRENT_EVENT_KEY, this.event.code);
    localStorage.setItem(this.localEventKey(this.event.code), JSON.stringify(this.eventWithoutImages(this.event)));
  }

  private loadPoolFavorites(): void {
    if (!this.event) {
      this.favoritePoolIds = new Set<string>();
      return;
    }

    const raw = localStorage.getItem(this.poolFavoritesKey(this.event.code));
    const ids = parseStoredStringArray(raw);
    const eventPoolIds = new Set(this.event.pools.map((pool) => pool.id));
    this.favoritePoolIds = new Set(ids.filter((id) => eventPoolIds.has(id)));
    this.persistPoolFavorites();
  }

  private persistPoolFavorites(): void {
    if (!this.event) {
      return;
    }

    const eventPoolIds = new Set(this.event.pools.map((pool) => pool.id));
    const ids = [...this.favoritePoolIds].filter((id) => eventPoolIds.has(id));
    this.favoritePoolIds = new Set(ids);
    localStorage.setItem(this.poolFavoritesKey(this.event.code), JSON.stringify(ids));
  }

  private removePoolFavorite(poolId: string): void {
    if (!this.favoritePoolIds.has(poolId)) {
      return;
    }

    const next = new Set(this.favoritePoolIds);
    next.delete(poolId);
    this.favoritePoolIds = next;
    this.persistPoolFavorites();
  }

  private touchPool(pool: PoolState): void {
    pool.matchStartTimerMinutes = clampWholeNumber(pool.matchStartTimerMinutes, 0, 99);
    if (pool.matchStartTimerMinutes === 0) {
      this.clearPoolTimer(pool);
    }
    pool.updatedAt = new Date().toISOString();
  }

  private startPoolTimer(pool: PoolState, match: Match): void {
    pool.nextMatchStartAt = new Date(Date.now() + pool.matchStartTimerMinutes * 60_000).toISOString();
    pool.nextMatchStartSourceMatchId = match.id;
  }

  private clearPoolTimer(pool: PoolState): boolean {
    if (!pool.nextMatchStartAt && !pool.nextMatchStartSourceMatchId) {
      return false;
    }

    pool.nextMatchStartAt = null;
    pool.nextMatchStartSourceMatchId = null;
    return true;
  }

  private shouldStartPoolTimer(pool: PoolState, match: Match): boolean {
    return (
      pool.matchStartTimerMinutes > 0 &&
      pool.matches.findIndex((candidate) => candidate.id === match.id) >= 0 &&
      pool.matches.findIndex((candidate) => candidate.id === match.id) < pool.matches.length - 1
    );
  }

  private normalizeMatch(match: Match, gamesPerMatch: number, pointCap: number | null = 99, teamCount = 7): Match {
    return {
      ...match,
      id: typeof match.id === 'string' && match.id.trim() ? match.id : createId(),
      refSeed: seedOrNull(match.refSeed, teamCount),
      teamASeed: seedOrNull(match.teamASeed, teamCount),
      teamBSeed: seedOrNull(match.teamBSeed, teamCount),
      games: resizeGamesForCount(match.games ?? [], gamesPerMatch).map((game) => this.capGameScore(game, pointCap)),
      final: Boolean(match.final),
      updatedAt: typeof match.updatedAt === 'string' ? match.updatedAt : null
    };
  }

  private capGameScore(game: GameScore, pointCap: number | null): GameScore {
    const cap = pointCap == null ? 99 : clampWholeNumber(pointCap, 1, 99);
    game.scoreA = clampWholeNumber(game.scoreA, 0, cap);
    game.scoreB = clampWholeNumber(game.scoreB, 0, cap);
    game.final = Boolean(game.final);
    return game;
  }

  private touchMatch(pool: PoolState, match: Match): void {
    const now = new Date().toISOString();
    match.updatedAt = now;
    pool.updatedAt = now;
  }

  private applySheetScan(pool: PoolState, scan: SheetScanResult): void {
    Object.assign(
      pool,
      applySheetScanToPool(pool, scan, this.uniquePoolTitle(scan.title?.trim() || pool.title, pool.id))
    );
    this.expandedMatchId = null;
    this.touchPool(pool);
  }

  private showSideSwitchToastIfNeeded(pool: PoolState, match: Match, game: GameScore): void {
    const interval = this.sideSwitchInterval(pool.targetScore);
    const total = wholeNumber(game.scoreA) + wholeNumber(game.scoreB);
    const gameIndex = match.games.indexOf(game);
    const keyPrefix = `${pool.id}:${match.id}:${gameIndex}`;

    if (!interval || total <= 0 || total % interval !== 0) {
      if (this.lastSideSwitchKey?.startsWith(`${keyPrefix}:`)) {
        this.lastSideSwitchKey = null;
      }
      return;
    }

    const key = `${keyPrefix}:${total}`;

    if (key === this.lastSideSwitchKey) {
      return;
    }

    this.lastSideSwitchKey = key;
    this.sideSwitchToast = {
      message: 'Switch sides',
      detail: `${teamName(pool, match.teamASeed)} and ${teamName(pool, match.teamBSeed)} should switch sides.`
    };
    this.clearSideSwitchToastTimeout();
    this.sideSwitchToastTimeout = window.setTimeout(() => {
      this.zone.run(() => {
        this.sideSwitchToast = null;
        this.sideSwitchToastTimeout = null;
        this.bump();
      });
    }, 10000);
  }

  private sideSwitchInterval(targetScore: number): number | null {
    if (targetScore === 11) {
      return 4;
    }

    if (targetScore === 15) {
      return 5;
    }

    return null;
  }

  private clearSideSwitchToastTimeout(): void {
    if (this.sideSwitchToastTimeout == null) {
      return;
    }

    window.clearTimeout(this.sideSwitchToastTimeout);
    this.sideSwitchToastTimeout = null;
  }

  private async errorMessage(response: Response): Promise<string> {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    return body.message || body.error || 'Request failed.';
  }

  private adminHeaders(): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-admin-password': this.adminPassword
    };
  }

  private eventWithoutImages(event: EventState): EventState {
    return {
      ...event,
      pools: event.pools.map((pool) => ({
        ...pool,
        imagePreview: null
      }))
    };
  }

  private poolWithoutImage(pool: PoolState): PoolState {
    return {
      ...pool,
      imagePreview: null
    };
  }

  private clonePool(pool: PoolState): PoolState {
    return JSON.parse(JSON.stringify(pool)) as PoolState;
  }

  private hasStartedScoring(pool: PoolState): boolean {
    return pool.matches.some(
      (match) => match.final || match.games.some((game) => wholeNumber(game.scoreA) > 0 || wholeNumber(game.scoreB) > 0)
    );
  }

  private resetScanState(): void {
    this.scanError = '';
    this.scanProgress = '';
    this.scanSummary = null;
    this.scanStatus = 'idle';
  }

  private nextPoolTitle(): string {
    return this.uniquePoolTitle(`Pool ${(this.event?.pools.length ?? 0) + 1}`);
  }

  private uniquePoolTitle(title: string, currentPoolId: string | null = null): string {
    const pools = this.event?.pools.filter((pool) => pool.id !== currentPoolId) ?? [];

    if (!pools.some((pool) => pool.title.toLowerCase() === title.toLowerCase())) {
      return title;
    }

    for (let index = 2; index < 100; index += 1) {
      const candidate = `${title} ${index}`;

      if (!pools.some((pool) => pool.title.toLowerCase() === candidate.toLowerCase())) {
        return candidate;
      }
    }

    return `${title} ${Date.now().toString(36)}`;
  }

  private readPoolSheetImage(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const image = new Image();
      const objectUrl = URL.createObjectURL(file);

      image.onload = () => {
        URL.revokeObjectURL(objectUrl);
        const maxSide = 1800;
        const scale = Math.min(1, maxSide / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext('2d');
        context?.drawImage(image, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', 0.86));
      };
      image.onerror = () => {
        URL.revokeObjectURL(objectUrl);
        this.readFileAsDataUrl(file).then(resolve).catch(reject);
      };
      image.src = objectUrl;
    });
  }

  private readFileAsDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () =>
        typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid file result.'));
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
      reader.readAsDataURL(file);
    });
  }

  private formatScanProgress(status: string, progress: number): string {
    const label = status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
    const percent = Math.round(progress * 100);

    return percent > 0 && percent < 100 ? `${label} ${percent}%` : label;
  }

  private normalizeEventCode(value: string): string {
    return String(value ?? '')
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 32);
  }

  private isNewer(left: string | null, right: string | null): boolean {
    return Date.parse(left ?? '') > Date.parse(right ?? '');
  }

  private localEventKey(code: string): string {
    return `cheabs.liveScoring.event.${code}.v1`;
  }

  private poolFavoritesKey(code: string): string {
    return `${POOL_FAVORITES_KEY_PREFIX}${code}`;
  }

  private bump(): void {
    this.version.update((value) => value + 1);
  }
}

const parseStoredStringArray = (raw: string | null): string[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};
