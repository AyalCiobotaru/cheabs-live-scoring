import { AsyncPipe } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  EventState,
  GameScore,
  Match,
  PoolState,
  SheetScanResult,
  TeamStanding
} from './scoring.models';
import { MatchRowComponent } from './util/match-row/match-row.component';
import { PoolSummaryComponent } from './util/pool-summary/pool-summary.component';
import { ScoringRealtimeService } from './scoring-realtime.service';
import { SheetScannerService } from './service/sheet-scanner.service';

const CURRENT_EVENT_KEY = 'cheabs.liveScoring.currentEvent.v1';
const ADMIN_PASSWORD_KEY = 'cheabs.liveScoring.adminPassword.v1';
const TEAM_COUNT_OPTIONS = [3, 4, 5, 6, 7];

interface ScheduleTemplateRow {
  teamASeed: number;
  teamBSeed: number;
  refSeed: number;
}

interface PoolCard {
  pool: PoolState;
  standings: TeamStanding[];
  completedMatches: number;
  totalMatches: number;
  matchSummary: string;
}

type ViewMode = 'event' | 'pool' | 'setup';

interface SideSwitchToast {
  message: string;
  detail: string;
}

const DEFAULT_SCHEDULES: Record<number, ScheduleTemplateRow[]> = {
  4: [
    { teamASeed: 2, teamBSeed: 4, refSeed: 1 },
    { teamASeed: 1, teamBSeed: 3, refSeed: 2 },
    { teamASeed: 1, teamBSeed: 4, refSeed: 3 },
    { teamASeed: 2, teamBSeed: 3, refSeed: 1 },
    { teamASeed: 3, teamBSeed: 4, refSeed: 2 },
    { teamASeed: 1, teamBSeed: 2, refSeed: 4 }
  ],
  5: [
    { teamASeed: 2, teamBSeed: 5, refSeed: 3 },
    { teamASeed: 1, teamBSeed: 4, refSeed: 2 },
    { teamASeed: 3, teamBSeed: 5, refSeed: 1 },
    { teamASeed: 2, teamBSeed: 4, refSeed: 5 },
    { teamASeed: 1, teamBSeed: 3, refSeed: 4 },
    { teamASeed: 4, teamBSeed: 5, refSeed: 1 },
    { teamASeed: 2, teamBSeed: 3, refSeed: 4 },
    { teamASeed: 1, teamBSeed: 5, refSeed: 2 },
    { teamASeed: 3, teamBSeed: 4, refSeed: 5 },
    { teamASeed: 1, teamBSeed: 2, refSeed: 3 }
  ]
};

@Component({
  selector: 'app-scoring-page',
  standalone: true,
  imports: [AsyncPipe, FormsModule, MatchRowComponent, PoolSummaryComponent],
  templateUrl: './scoring-page.component.html',
  styleUrl: './scoring-page.component.scss'
})
export class ScoringPageComponent implements OnInit, OnDestroy {
  private remoteSubscription?: Subscription;
  private remotePoolSetupSubscription?: Subscription;
  private remoteMatchSubscription?: Subscription;
  private snapshotRequestSubscription?: Subscription;
  private applyingRemoteState = false;

  adminPassword = sessionStorage.getItem(ADMIN_PASSWORD_KEY) ?? '';
  isAdmin = Boolean(this.adminPassword);
  event: EventState | null = null;
  eventCode = localStorage.getItem(CURRENT_EVENT_KEY) ?? '';
  eventName = '';
  landingMode: 'join' | 'create' = 'join';
  showingAdminSignIn = false;
  loadingEvent = false;
  eventError = '';
  viewMode: ViewMode = 'event';
  draftPool: PoolState | null = null;
  expandedMatchId: string | null = null;
  scanError = '';
  scanProgress = '';
  scanSummary: { read: string[]; assumed: string[]; manual: string[] } | null = null;
  scanStatus: 'idle' | 'scanning' | 'success' | 'failed' = 'idle';
  sideSwitchToast: SideSwitchToast | null = null;
  readonly teamCountOptions = TEAM_COUNT_OPTIONS;
  readonly realtimeStatus$ = this.realtime.status$;
  private sideSwitchToastTimeout: number | null = null;
  private lastSideSwitchKey: string | null = null;

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly zone: NgZone,
    private readonly realtime: ScoringRealtimeService,
    private readonly scanner: SheetScannerService
  ) {}

  ngOnInit(): void {
    this.remoteSubscription = this.realtime.remoteEvent$.subscribe((event) => {
      this.zone.run(() => this.applyRemoteEvent(event));
    });
    this.remotePoolSetupSubscription = this.realtime.remotePoolSetup$.subscribe((pool) => {
      this.zone.run(() => this.applyRemotePoolSetup(pool));
    });
    this.remoteMatchSubscription = this.realtime.remoteMatch$.subscribe(({ poolId, match }) => {
      this.zone.run(() => this.applyRemoteMatch(poolId, match));
    });
    this.snapshotRequestSubscription = this.realtime.snapshotRequest$.subscribe(() => {
      if (this.event) {
        this.realtime.publishSnapshot(this.eventWithoutImages(this.event));
      }
    });
  }

  ngOnDestroy(): void {
    this.remoteSubscription?.unsubscribe();
    this.remotePoolSetupSubscription?.unsubscribe();
    this.remoteMatchSubscription?.unsubscribe();
    this.snapshotRequestSubscription?.unsubscribe();
    this.realtime.close();
    this.clearSideSwitchToastTimeout();
  }

  get activePool(): PoolState | null {
    if (this.viewMode === 'setup' && this.draftPool) {
      return this.draftPool;
    }

    if (this.viewMode === 'pool') {
      return this.event?.pools.find((pool) => pool.id === this.event?.activePoolId) ?? null;
    }

    return null;
  }

  get poolCards(): PoolCard[] {
    if (!this.event) {
      return [];
    }

    return this.event.pools.map((pool) => this.poolCard(pool));
  }

  get standings(): TeamStanding[] {
    const pool = this.activePool;
    return pool ? this.buildStandings(pool) : [];
  }

  get activePoolCard(): PoolCard | null {
    const pool = this.activePool;

    if (!pool) {
      return null;
    }

    return this.poolCard(pool);
  }

  get hasPool(): boolean {
    return Boolean(this.activePool?.matches.length);
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
    } catch (error) {
      this.eventError = error instanceof Error ? error.message : 'Unable to sign in as admin.';
    } finally {
      this.scheduleRender();
    }
  }

  adminSignOut(): void {
    this.isAdmin = false;
    this.showingAdminSignIn = false;
    this.adminPassword = '';
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
  }

  async createEvent(): Promise<void> {
    await this.loadOrCreateEvent(true);
  }

  async joinEvent(): Promise<void> {
    await this.loadOrCreateEvent(false);
  }

  openDashboard(): void {
    this.draftPool = null;
    this.viewMode = 'event';
    this.expandedMatchId = null;
  }

  chooseEvent(): void {
    this.realtime.close();
    this.event = null;
    this.eventName = '';
    this.viewMode = 'event';
    this.draftPool = null;
    this.expandedMatchId = null;
    this.dismissSideSwitchToast();
    localStorage.removeItem(CURRENT_EVENT_KEY);
  }

  openPool(poolId: string): void {
    if (!this.event) {
      return;
    }

    this.event.activePoolId = poolId;
    this.draftPool = null;
    this.viewMode = 'pool';
    this.expandedMatchId = null;
    this.persistLocal();
  }

  editPoolSetup(): void {
    const pool = this.event?.pools.find((candidate) => candidate.id === this.event?.activePoolId);

    if (!pool || !this.isAdmin) {
      return;
    }

    this.draftPool = this.clonePool(pool);
    this.viewMode = 'setup';
    this.resetScanState();
  }

  startAddPool(): void {
    if (!this.event || !this.isAdmin) {
      return;
    }

    this.draftPool = this.createDefaultPool(this.nextPoolTitle());
    this.viewMode = 'setup';
    this.resetScanState();
  }

  cancelSetup(): void {
    this.draftPool = null;
    this.viewMode = 'event';
    this.resetScanState();
  }

  async savePoolSetup(): Promise<void> {
    const pool = this.draftPool;

    if (!this.event || !pool || !this.isAdmin) {
      return;
    }

    const existingPool = this.event.pools.find((candidate) => candidate.id === pool.id);

    if (existingPool && this.hasStartedScoring(existingPool) && !confirm('This pool already has scores. Saving setup changes may change standings or invalidate existing scores. Continue?')) {
      return;
    }

    pool.updatedAt = new Date().toISOString();
    const existingIndex = this.event.pools.findIndex((candidate) => candidate.id === pool.id);

    if (existingIndex >= 0) {
      this.event.pools = this.event.pools.map((candidate) => candidate.id === pool.id ? pool : candidate);
    } else {
      this.event.pools = [...this.event.pools, pool];
    }

    this.event.activePoolId = pool.id;
    this.viewMode = 'event';
    await this.persistPoolSetup(pool);
    this.draftPool = null;
  }

  async captureSheet(event: Event): Promise<void> {
    const pool = this.activePool;
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!pool || !file) {
      return;
    }

    this.resetScanState();
    this.scheduleRender();

    try {
      pool.imagePreview = await this.readPoolSheetImage(file);
      this.touchPool(pool);
      this.scheduleRender();
    } catch {
      this.scanStatus = 'failed';
      this.scanError = 'Unable to load that Pool Sheet photo.';
      this.scheduleRender();
    } finally {
      input.value = '';
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
    this.scheduleRender();

    try {
      const body = await this.scanner.scan(pool.imagePreview, (progress) => {
        this.zone.run(() => {
          this.scanProgress = this.formatScanProgress(progress.status, progress.progress);
          this.scheduleRender();
        });
      });

      this.zone.run(() => {
        this.applySheetScan(pool, body);
        this.scanSummary = this.buildScanSummary(pool, body);
        this.scanStatus = 'success';
        this.scanProgress = '';
        this.scheduleRender();
      });
    } catch (error) {
      this.zone.run(() => {
        this.scanStatus = 'failed';
        this.scanProgress = '';
        this.scanError = error instanceof Error ? error.message : 'Unable to read the Pool Sheet photo.';
        this.scheduleRender();
      });
    }
  }

  changeTeamCount(value: number): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    const count = this.clampWholeNumber(value, 3, 7);
    const hasExistingMatches = pool.matches.length > 0;

    if (hasExistingMatches && !confirm('Changing team count will replace the current schedule and scores. Continue?')) {
      return;
    }

    pool.teamCount = count;
    pool.teams = Array.from({ length: count }, (_, index) => {
      const seed = index + 1;
      return pool.teams.find((team) => team.seed === seed) ?? {
        seed,
        name: `Team ${seed}`
      };
    });
    pool.matches = this.createTemplateMatches(count, pool.gamesPerMatch);
    pool.targetScore = this.defaultTargetScore(count);
    this.expandedMatchId = null;
    this.touchPool(pool);
  }

  applyGameFormat(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    pool.gamesPerMatch = this.clampWholeNumber(pool.gamesPerMatch, 1, 5);
    pool.targetScore = this.clampWholeNumber(pool.targetScore, 1, 99);
    pool.matches = pool.matches.map((match) => ({
      ...match,
      games: this.resizeGamesForCount(match.games, pool.gamesPerMatch)
    }));
    this.touchPool(pool);
  }

  addMatch(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    const match: Match = {
      id: this.createId(),
      refSeed: pool.teams[2]?.seed ?? null,
      teamASeed: pool.teams[0]?.seed ?? null,
      teamBSeed: pool.teams[1]?.seed ?? null,
      games: this.createGames(pool.gamesPerMatch),
      final: false,
      updatedAt: new Date().toISOString()
    };
    pool.matches.push(match);
    this.touchPool(pool);
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
  }

  handleScoreChanged(match: Match, game: GameScore): void {
    const pool = this.activePool;

    if (!pool) {
      return;
    }

    this.showSideSwitchToastIfNeeded(pool, match, game);
    this.touchMatch(pool, match);
    this.persistLocal();
    this.realtime.publishMatch(pool, match);
  }

  dismissSideSwitchToast(): void {
    this.sideSwitchToast = null;
    this.clearSideSwitchToastTimeout();
    this.scheduleRender();
  }

  async handleFinalChanged(match: Match): Promise<void> {
    const pool = this.activePool;

    if (!pool) {
      return;
    }

    this.touchMatch(pool, match);
    this.persistLocal();
    this.realtime.publishMatch(pool, match);

    if (match.final) {
      await this.persistFinalMatch(pool, match);
    }
  }

  setExpanded(matchId: string, expanded: boolean): void {
    this.expandedMatchId = expanded ? matchId : null;
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
  }

  save(): void {
    const pool = this.activePool;

    if (!pool || !this.isAdmin) {
      return;
    }

    this.touchPool(pool);
  }

  private async loadOrCreateEvent(create: boolean): Promise<void> {
    this.loadingEvent = true;
    this.eventError = '';

    try {
      const code = this.normalizeEventCode(this.eventCode);
      const response = await fetch(create ? '/api/scoring/events' : `/api/scoring/events/${code}`, {
        method: create ? 'POST' : 'GET',
        headers: create ? this.adminHeaders() : undefined,
        body: create ? JSON.stringify({
          code,
          name: this.eventName.trim() || code
        }) : undefined
      });

      if (!response.ok) {
        throw new Error(await this.errorMessage(response));
      }

      const body = await response.json() as { event: EventState };
      this.event = this.normalizeEvent(body.event);
      this.eventCode = this.event.code;
      this.eventName = this.event.name;
      this.viewMode = 'event';
      this.persistLocal();
      await this.realtime.connect(this.event.code);
    } catch (error) {
      this.eventError = error instanceof Error ? error.message : 'Unable to open event.';
    } finally {
      this.loadingEvent = false;
      this.scheduleRender();
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

  private async persistFinalMatch(pool: PoolState, match: Match): Promise<void> {
    if (!this.event || this.applyingRemoteState) {
      return;
    }

    this.event.updatedAt = new Date().toISOString();
    this.persistLocal();

    const response = await fetch(`/api/scoring/events/${this.event.code}/pools/${pool.id}/matches/${match.id}/final`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ match })
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
    this.scheduleRender();
  }

  private applyRemotePoolSetup(remote: PoolState): void {
    if (!this.event) {
      return;
    }

    const pool = this.normalizePool(remote);
    const existingIndex = this.event.pools.findIndex((candidate) => candidate.id === pool.id);
    this.applyingRemoteState = true;

    if (existingIndex >= 0) {
      this.event.pools = this.event.pools.map((candidate) => candidate.id === pool.id ? pool : candidate);
    } else {
      this.event.pools = [...this.event.pools, pool];
    }

    this.persistLocal();
    this.applyingRemoteState = false;
    this.scheduleRender();
  }

  private applyRemoteMatch(poolId: string, remote: Match): void {
    if (!this.event) {
      return;
    }

    const pool = this.event.pools.find((candidate) => candidate.id === poolId);

    if (!pool) {
      return;
    }

    const match = this.normalizeMatch(remote, pool.gamesPerMatch);
    const existingIndex = pool.matches.findIndex((candidate) => candidate.id === match.id);

    if (existingIndex < 0 || this.isNewer(match.updatedAt, pool.matches[existingIndex].updatedAt)) {
      this.applyingRemoteState = true;
      if (existingIndex >= 0) {
        pool.matches = pool.matches.map((candidate) => candidate.id === match.id ? match : candidate);
      } else {
        pool.matches = [...pool.matches, match];
      }
      pool.updatedAt = match.updatedAt;
      this.persistLocal();
      this.applyingRemoteState = false;
      this.scheduleRender();
    }
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
    const activePoolId = typeof event.activePoolId === 'string' && pools.some((pool) => pool.id === event.activePoolId)
      ? event.activePoolId
      : pools[0]?.id ?? null;

    return {
      code: this.normalizeEventCode(event.code),
      name: typeof event.name === 'string' && event.name.trim() ? event.name.trim() : event.code,
      pools,
      activePoolId,
      updatedAt: typeof event.updatedAt === 'string' ? event.updatedAt : null
    };
  }

  private normalizePool(pool: PoolState): PoolState {
    const baseline = this.createDefaultPool();
    const teamCount = this.clampWholeNumber(pool.teamCount, 3, 7);
    const gamesPerMatch = this.clampWholeNumber(pool.gamesPerMatch, 1, 5);
    const sourceTeams = Array.isArray(pool.teams) ? pool.teams : [];
    const teams = Array.from({ length: teamCount }, (_, index) => {
      const seed = index + 1;
      return sourceTeams.find((team) => team.seed === seed) ?? {
        seed,
        name: `Team ${seed}`
      };
    });

    return {
      id: typeof pool.id === 'string' && pool.id.trim() ? pool.id : baseline.id,
      title: typeof pool.title === 'string' && pool.title.trim() ? pool.title : baseline.title,
      teamCount,
      gamesPerMatch,
      targetScore: pool.targetScore == null
        ? this.defaultTargetScore(teamCount)
        : this.clampWholeNumber(pool.targetScore, 1, 99),
      teams,
      matches: Array.isArray(pool.matches) ? pool.matches.map((match) => this.normalizeMatch(match, gamesPerMatch)) : [],
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

  private touchPool(pool: PoolState): void {
    pool.updatedAt = new Date().toISOString();
  }

  private normalizeMatch(match: Match, gamesPerMatch: number): Match {
    return {
      ...match,
      id: typeof match.id === 'string' && match.id.trim() ? match.id : this.createId(),
      refSeed: this.seedOrNull(match.refSeed, 7),
      teamASeed: this.seedOrNull(match.teamASeed, 7),
      teamBSeed: this.seedOrNull(match.teamBSeed, 7),
      games: this.resizeGamesForCount(match.games ?? [], gamesPerMatch),
      final: Boolean(match.final),
      updatedAt: typeof match.updatedAt === 'string' ? match.updatedAt : null
    };
  }

  private touchMatch(pool: PoolState, match: Match): void {
    const now = new Date().toISOString();
    match.updatedAt = now;
    pool.updatedAt = now;
  }

  private applySheetScan(pool: PoolState, scan: SheetScanResult): void {
    const maxSeed = Math.max(
      0,
      ...scan.teams.map((team) => this.wholeNumber(team.seed)),
      ...scan.matches.flatMap((match) => [
        this.wholeNumber(match.refSeed),
        this.wholeNumber(match.teamASeed),
        this.wholeNumber(match.teamBSeed)
      ])
    );
    const teamCount = this.clampWholeNumber(scan.teamCount ?? (maxSeed || pool.teamCount), 3, 7);
    const scannedTeams = new Map(scan.teams.map((team) => [this.wholeNumber(team.seed), team.name?.trim() || null]));
    const gamesPerMatch = this.clampWholeNumber(scan.gamesPerMatch ?? pool.gamesPerMatch, 1, 5);

    pool.title = this.uniquePoolTitle(scan.title?.trim() || pool.title, pool.id);
    pool.teamCount = teamCount;
    pool.gamesPerMatch = gamesPerMatch;
    pool.targetScore = scan.targetScore == null ? this.defaultTargetScore(teamCount) : this.clampWholeNumber(scan.targetScore, 1, 99);
    pool.teams = Array.from({ length: teamCount }, (_, index) => {
      const seed = index + 1;
      return {
        seed,
        name: scannedTeams.get(seed) || pool.teams.find((team) => team.seed === seed)?.name || `Team ${seed}`
      };
    });
    pool.matches = scan.matches.length
      ? scan.matches.map((match) => this.createScannedMatch(match, teamCount, gamesPerMatch))
      : this.createTemplateMatches(teamCount, gamesPerMatch);
    this.expandedMatchId = null;
    this.touchPool(pool);
  }

  private buildScanSummary(pool: PoolState, scan: SheetScanResult): { read: string[]; assumed: string[]; manual: string[] } {
    const maxSeed = Math.max(
      0,
      ...scan.teams.map((team) => this.wholeNumber(team.seed)),
      ...scan.matches.flatMap((match) => [
        this.wholeNumber(match.refSeed),
        this.wholeNumber(match.teamASeed),
        this.wholeNumber(match.teamBSeed)
      ])
    );
    const teamCount = this.clampWholeNumber(scan.teamCount ?? (maxSeed || pool.teamCount), 3, 7);
    const namedTeams = scan.teams.filter((team) => team.name?.trim()).length;
    const completeMatches = scan.matches.filter((match) => (
      this.seedOrNull(match.refSeed, teamCount) != null
      && this.seedOrNull(match.teamASeed, teamCount) != null
      && this.seedOrNull(match.teamBSeed, teamCount) != null
    )).length;
    const defaultScheduleUsed = scan.matches.length === 0 && this.createTemplateMatches(teamCount, pool.gamesPerMatch).length > 0;
    const targetScore = scan.targetScore ?? this.defaultTargetScore(teamCount);
    const gamesPerMatch = scan.gamesPerMatch ?? pool.gamesPerMatch;

    return {
      read: [
        scan.title?.trim() ? `Title: ${scan.title.trim()}` : '',
        scan.teamCount != null ? `Team count: ${scan.teamCount}` : '',
        scan.gamesPerMatch != null && scan.targetScore != null ? `Format: ${scan.gamesPerMatch} games to ${scan.targetScore}` : '',
        namedTeams > 0 ? `Team names: ${namedTeams} of ${teamCount}` : '',
        completeMatches > 0 ? `Schedule rows: ${completeMatches}` : ''
      ].filter(Boolean),
      assumed: [
        scan.teamCount == null ? `Team count assumed from OCR context: ${teamCount}` : '',
        scan.gamesPerMatch == null || scan.targetScore == null ? `Format assumed: ${gamesPerMatch} games to ${targetScore}` : '',
        defaultScheduleUsed ? `Schedule assumed from the ${teamCount}-team default order` : '',
        ...scan.notes.filter((note) => !/review handwritten team names/i.test(note))
      ].filter(Boolean),
      manual: [
        namedTeams < teamCount ? `Fill or verify ${teamCount - namedTeams} team name${teamCount - namedTeams === 1 ? '' : 's'}` : 'Verify handwritten team names',
        completeMatches < pool.matches.length ? 'Review the match order and Work Team values' : '',
        'Confirm games per match and target score before scoring'
      ].filter(Boolean)
    };
  }

  private createDefaultPool(title = 'Pool'): PoolState {
    const id = this.createId();

    return {
      id,
      title,
      teamCount: 4,
      gamesPerMatch: 2,
      targetScore: this.defaultTargetScore(4),
      teams: [1, 2, 3, 4].map((seed) => ({ seed, name: `Team ${seed}` })),
      matches: this.createTemplateMatches(4, 2),
      imagePreview: null,
      updatedAt: new Date().toISOString()
    };
  }

  private createScannedMatch(
    match: { refSeed: number | null; teamASeed: number | null; teamBSeed: number | null },
    teamCount: number,
    gamesPerMatch: number
  ): Match {
    return {
      id: this.createId(),
      refSeed: this.seedOrNull(match.refSeed, teamCount),
      teamASeed: this.seedOrNull(match.teamASeed, teamCount),
      teamBSeed: this.seedOrNull(match.teamBSeed, teamCount),
      games: this.createGames(gamesPerMatch),
      final: false,
      updatedAt: new Date().toISOString()
    };
  }

  private createTemplateMatches(teamCount: number, gamesPerMatch = 2): Match[] {
    const template = DEFAULT_SCHEDULES[teamCount] ?? [];
    return template.map((row) => ({
      id: this.createId(),
      refSeed: row.refSeed,
      teamASeed: row.teamASeed,
      teamBSeed: row.teamBSeed,
      games: this.createGames(gamesPerMatch),
      final: false,
      updatedAt: new Date().toISOString()
    }));
  }

  private createGames(gamesPerMatch = 2): GameScore[] {
    return Array.from({ length: gamesPerMatch }, () => ({
      scoreA: 0,
      scoreB: 0
    }));
  }

  private buildStandings(pool: PoolState): TeamStanding[] {
    const standings = new Map<number, TeamStanding>();

    for (const team of pool.teams) {
      standings.set(team.seed, {
        seed: team.seed,
        name: team.name,
        wins: 0,
        losses: 0,
        pointDifferential: 0
      });
    }

    for (const match of pool.matches) {
      if (!match.final || match.teamASeed == null || match.teamBSeed == null) {
        continue;
      }

      const teamA = standings.get(match.teamASeed);
      const teamB = standings.get(match.teamBSeed);

      if (!teamA || !teamB) {
        continue;
      }

      for (const game of match.games) {
        const scoreA = this.wholeNumber(game.scoreA);
        const scoreB = this.wholeNumber(game.scoreB);

        if (scoreA === scoreB) {
          continue;
        }

        teamA.pointDifferential += scoreA - scoreB;
        teamB.pointDifferential += scoreB - scoreA;

        if (scoreA > scoreB) {
          teamA.wins += 1;
          teamB.losses += 1;
        } else {
          teamB.wins += 1;
          teamA.losses += 1;
        }
      }
    }

    return [...standings.values()].sort((left, right) => {
      return right.wins - left.wins
        || right.pointDifferential - left.pointDifferential
        || this.headToHeadWins(pool, right.seed, left.seed) - this.headToHeadWins(pool, left.seed, right.seed)
        || left.seed - right.seed;
    });
  }

  private headToHeadWins(pool: PoolState, seed: number, opponentSeed: number): number {
    let wins = 0;

    for (const match of pool.matches) {
      if (!match.final) {
        continue;
      }

      const involvesTeams = (match.teamASeed === seed && match.teamBSeed === opponentSeed)
        || (match.teamASeed === opponentSeed && match.teamBSeed === seed);

      if (!involvesTeams) {
        continue;
      }

      for (const game of match.games) {
        const scoreA = this.wholeNumber(game.scoreA);
        const scoreB = this.wholeNumber(game.scoreB);

        if (scoreA === scoreB) {
          continue;
        }

        const winner = scoreA > scoreB ? match.teamASeed : match.teamBSeed;

        if (winner === seed) {
          wins += 1;
        }
      }
    }

    return wins;
  }

  private buildMatchSummary(pool: PoolState): string {
    const current = pool.matches.find((match) => !match.final && match.games.some((game) => this.wholeNumber(game.scoreA) > 0 || this.wholeNumber(game.scoreB) > 0));
    const next = current ?? pool.matches.find((match) => !match.final);

    if (!next) {
      return 'Complete';
    }

    const label = current ? 'Now' : 'Next';
    return `${label}: ${this.teamName(pool, next.teamASeed)} vs ${this.teamName(pool, next.teamBSeed)} | Work: ${this.teamName(pool, next.refSeed)}`;
  }

  private teamName(pool: PoolState, seed: number | null): string {
    if (seed == null) {
      return 'None';
    }

    return pool.teams.find((team) => team.seed === seed)?.name ?? `Team ${seed}`;
  }

  private showSideSwitchToastIfNeeded(pool: PoolState, match: Match, game: GameScore): void {
    const interval = this.sideSwitchInterval(pool.targetScore);
    const total = this.wholeNumber(game.scoreA) + this.wholeNumber(game.scoreB);
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
      detail: `${this.teamName(pool, match.teamASeed)} and ${this.teamName(pool, match.teamBSeed)} should switch sides.`
    };
    this.clearSideSwitchToastTimeout();
    this.sideSwitchToastTimeout = window.setTimeout(() => {
      this.zone.run(() => {
        this.sideSwitchToast = null;
        this.sideSwitchToastTimeout = null;
        this.scheduleRender();
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
    const body = await response.json().catch(() => ({})) as { message?: string; error?: string };
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

  private poolCard(pool: PoolState): PoolCard {
    return {
      pool,
      standings: this.buildStandings(pool),
      completedMatches: pool.matches.filter((match) => match.final).length,
      totalMatches: pool.matches.length,
      matchSummary: this.buildMatchSummary(pool)
    };
  }

  private clonePool(pool: PoolState): PoolState {
    return JSON.parse(JSON.stringify(pool)) as PoolState;
  }

  private hasStartedScoring(pool: PoolState): boolean {
    return pool.matches.some((match) => (
      match.final
      || match.games.some((game) => this.wholeNumber(game.scoreA) > 0 || this.wholeNumber(game.scoreB) > 0)
    ));
  }

  private resetScanState(): void {
    this.scanError = '';
    this.scanProgress = '';
    this.scanSummary = null;
    this.scanStatus = 'idle';
  }

  private nextPoolTitle(): string {
    return this.uniquePoolTitle(`Pool ${((this.event?.pools.length ?? 0) + 1)}`);
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

  private seedOrNull(seed: number | null, teamCount: number): number | null {
    const value = this.wholeNumber(seed);
    return value >= 1 && value <= teamCount ? value : null;
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
      reader.onload = () => typeof reader.result === 'string' ? resolve(reader.result) : reject(new Error('Invalid file result.'));
      reader.onerror = () => reject(reader.error ?? new Error('Unable to read file.'));
      reader.readAsDataURL(file);
    });
  }

  private formatScanProgress(status: string, progress: number): string {
    const label = status
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (letter) => letter.toUpperCase());
    const percent = Math.round(progress * 100);

    return percent > 0 && percent < 100 ? `${label} ${percent}%` : label;
  }

  private scheduleRender(): void {
    this.changeDetector.markForCheck();
    window.setTimeout(() => {
      this.zone.run(() => this.changeDetector.detectChanges());
    });
  }

  private defaultTargetScore(teamCount: number): number {
    return teamCount === 4 ? 15 : 11;
  }

  private createId(): string {
    const browserCrypto = globalThis.crypto;

    if (typeof browserCrypto?.randomUUID === 'function') {
      return browserCrypto.randomUUID();
    }

    if (typeof browserCrypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      browserCrypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }

  private resizeGamesForCount(games: GameScore[], count: number): GameScore[] {
    return Array.from({ length: count }, (_, index) => {
      const existing = games[index];
      return {
        scoreA: this.wholeNumber(existing?.scoreA),
        scoreB: this.wholeNumber(existing?.scoreB)
      };
    });
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

  private clampWholeNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.wholeNumber(value)));
  }

  private wholeNumber(value: unknown): number {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }
}
