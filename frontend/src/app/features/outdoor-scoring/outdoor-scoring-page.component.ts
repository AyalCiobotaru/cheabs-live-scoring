import { AsyncPipe } from '@angular/common';
import { ChangeDetectorRef, Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  OutdoorGameScore,
  OutdoorMatch,
  OutdoorPoolState,
  OutdoorSheetScanResult,
  OutdoorTeamStanding
} from './outdoor-scoring.models';
import { OutdoorMatchRowComponent } from './outdoor-match-row/outdoor-match-row.component';
import { OutdoorScoringRealtimeService } from './outdoor-scoring-realtime.service';
import { OutdoorSheetScannerService } from './outdoor-sheet-scanner.service';

const STORAGE_KEY = 'cheabs.liveScoring.pool.v1';
const TEAM_COUNT_OPTIONS = [3, 4, 5, 6, 7];

interface ScheduleTemplateRow {
  teamASeed: number;
  teamBSeed: number;
  refSeed: number;
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
  selector: 'app-outdoor-scoring-page',
  standalone: true,
  imports: [AsyncPipe, FormsModule, OutdoorMatchRowComponent],
  templateUrl: './outdoor-scoring-page.component.html',
  styleUrl: './outdoor-scoring-page.component.scss'
})
export class OutdoorScoringPageComponent implements OnInit, OnDestroy {
  private remoteSubscription?: Subscription;
  private snapshotRequestSubscription?: Subscription;
  private applyingRemoteState = false;
  private readonly hadSavedPool = localStorage.getItem(STORAGE_KEY) !== null;

  pool: OutdoorPoolState = this.loadState();
  editingSetup = !this.hadSavedPool || this.pool.matches.length === 0;
  expandedMatchId: string | null = null;
  scanError = '';
  scanProgress = '';
  scanSummary: { read: string[]; assumed: string[]; manual: string[] } | null = null;
  scanStatus: 'idle' | 'scanning' | 'success' | 'failed' = 'idle';
  readonly teamCountOptions = TEAM_COUNT_OPTIONS;
  readonly realtimeStatus$ = this.realtime.status$;

  constructor(
    private readonly changeDetector: ChangeDetectorRef,
    private readonly zone: NgZone,
    private readonly realtime: OutdoorScoringRealtimeService,
    private readonly scanner: OutdoorSheetScannerService
  ) {}

  ngOnInit(): void {
    this.remoteSubscription = this.realtime.remotePool$.subscribe((pool) => {
      this.zone.run(() => this.applyRemotePool(pool));
    });
    this.snapshotRequestSubscription = this.realtime.snapshotRequest$.subscribe(() => {
      if (this.hasPool) {
        this.realtime.publish(this.pool, 'pool-updated');
      }
    });
    void this.realtime.connect();
  }

  ngOnDestroy(): void {
    this.remoteSubscription?.unsubscribe();
    this.snapshotRequestSubscription?.unsubscribe();
  }

  private applyRemotePool(pool: OutdoorPoolState): void {
      this.applyingRemoteState = true;
      this.pool = this.normalizePool(pool);
      if (this.pool.matches.length > 0) {
        this.editingSetup = false;
      } else {
        this.editingSetup = true;
      }
      this.persistLocal();
      this.applyingRemoteState = false;
      this.scheduleRender();
  }

  get hasPool(): boolean {
    return this.pool.matches.length > 0;
  }

  get standings(): OutdoorTeamStanding[] {
    return this.buildStandings();
  }

  async captureSheet(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];

    if (!file) {
      return;
    }

    this.scanError = '';
    this.scanSummary = null;
    this.scanStatus = 'idle';
    this.scheduleRender();

    try {
      this.pool.imagePreview = await this.readPoolSheetImage(file);
      this.touch();
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
    if (!this.pool.imagePreview || this.scanStatus === 'scanning') {
      return;
    }

    this.scanStatus = 'scanning';
    this.scanError = '';
    this.scanProgress = 'Preparing OCR...';
    this.scheduleRender();

    try {
      const body = await this.scanner.scan(this.pool.imagePreview, (progress) => {
        this.zone.run(() => {
          this.scanProgress = this.formatScanProgress(progress.status, progress.progress);
          this.scheduleRender();
        });
      });

      this.zone.run(() => {
        this.applySheetScan(body);
        this.scanSummary = this.buildScanSummary(body);
        this.scanStatus = 'success';
        this.scanProgress = '';
        this.editingSetup = true;
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
    const count = this.clampWholeNumber(value, 3, 7);
    const hasExistingMatches = this.pool.matches.length > 0;

    if (hasExistingMatches && !confirm('Changing team count will replace the current schedule and scores. Continue?')) {
      return;
    }

    this.pool.teamCount = count;
    this.pool.teams = Array.from({ length: count }, (_, index) => {
      const seed = index + 1;
      return this.pool.teams.find((team) => team.seed === seed) ?? {
        seed,
        name: `Team ${seed}`
      };
    });

    this.pool.matches = this.createTemplateMatches(count, this.pool.gamesPerMatch);
    this.pool.targetScore = this.defaultTargetScore(count);
    this.expandedMatchId = null;
    this.touch();
  }

  applyGameFormat(): void {
    this.pool.gamesPerMatch = this.clampWholeNumber(this.pool.gamesPerMatch, 1, 5);
    this.pool.targetScore = this.clampWholeNumber(this.pool.targetScore, 1, 99);
    this.pool.matches = this.pool.matches.map((match) => ({
      ...match,
      games: this.resizeGames(match.games)
    }));
    this.touch();
  }

  addMatch(): void {
    const firstSeed = this.pool.teams[0]?.seed ?? null;
    const secondSeed = this.pool.teams[1]?.seed ?? null;
    const refSeed = this.pool.teams[2]?.seed ?? null;
    const match: OutdoorMatch = {
      id: this.createId(),
      refSeed,
      teamASeed: firstSeed,
      teamBSeed: secondSeed,
      games: this.createGames(),
      final: false
    };
    this.pool.matches.push(match);
    this.touch();
  }

  removeMatch(matchId: string): void {
    this.pool.matches = this.pool.matches.filter((match) => match.id !== matchId);
    if (this.expandedMatchId === matchId) {
      this.expandedMatchId = null;
    }
    this.touch();
  }

  handleScoreChanged(): void {
    this.touch('score-updated');
  }

  handleFinalChanged(): void {
    this.touch('score-updated');
  }

  setExpanded(matchId: string, expanded: boolean): void {
    this.expandedMatchId = expanded ? matchId : null;
  }

  moveMatch(matchId: string, direction: -1 | 1): void {
    const index = this.pool.matches.findIndex((match) => match.id === matchId);
    const nextIndex = index + direction;

    if (index < 0 || nextIndex < 0 || nextIndex >= this.pool.matches.length) {
      return;
    }

    const matches = [...this.pool.matches];
    const [match] = matches.splice(index, 1);
    matches.splice(nextIndex, 0, match);
    this.pool.matches = matches;
    this.touch();
  }

  resetPool(): void {
    if (!confirm('Reset this outdoor scoring pool? This clears the local sheet, schedule, and scores on this device.')) {
      return;
    }

    this.pool = this.createDefaultState();
    this.editingSetup = true;
    localStorage.removeItem(STORAGE_KEY);
  }

  save(): void {
    this.touch();
  }

  private loadState(): OutdoorPoolState {
    const saved = localStorage.getItem(STORAGE_KEY);

    if (!saved) {
      return this.createDefaultState();
    }

    try {
      const parsed = JSON.parse(saved) as OutdoorPoolState;
      return this.normalizePool(parsed);
    } catch {
      return this.createDefaultState();
    }
  }

  private normalizePool(pool: OutdoorPoolState): OutdoorPoolState {
    const baseline = this.createDefaultState();
    const gamesPerMatch = this.clampWholeNumber(pool.gamesPerMatch, 1, 5);
    const teamCount = this.clampWholeNumber(pool.teamCount, 3, 7);
    const sourceTeams = Array.isArray(pool.teams) ? pool.teams : [];
    const teams = Array.from({ length: teamCount }, (_, index) => {
      const seed = index + 1;
      return sourceTeams.find((team) => team.seed === seed) ?? {
        seed,
        name: `Team ${seed}`
      };
    });

    return {
      title: typeof pool.title === 'string' && pool.title.trim() ? pool.title : baseline.title,
      teamCount,
      gamesPerMatch,
      targetScore: pool.targetScore == null
        ? this.defaultTargetScore(teamCount)
        : this.clampWholeNumber(pool.targetScore, 1, 99),
      teams,
      matches: Array.isArray(pool.matches) ? pool.matches.map((match) => ({
        ...match,
        games: this.resizeGamesForCount(match.games ?? [], gamesPerMatch),
        final: Boolean(match.final)
      })) : [],
      imagePreview: typeof pool.imagePreview === 'string' ? pool.imagePreview : null,
      updatedAt: typeof pool.updatedAt === 'string' ? pool.updatedAt : null
    };
  }

  private createDefaultState(): OutdoorPoolState {
    return {
      title: 'Outdoor Pool',
      teamCount: 4,
      gamesPerMatch: 2,
      targetScore: this.defaultTargetScore(4),
      teams: [1, 2, 3, 4].map((seed) => ({ seed, name: `Team ${seed}` })),
      matches: this.createTemplateMatches(4, 2),
      imagePreview: null,
      updatedAt: null
    };
  }

  private touch(kind: 'pool-updated' | 'score-updated' = 'pool-updated'): void {
    this.pool.updatedAt = new Date().toISOString();
    this.persistLocal();

    if (!this.applyingRemoteState) {
      this.realtime.publish(this.pool, kind);
    }
  }

  private persistLocal(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.pool));
  }

  private applySheetScan(scan: OutdoorSheetScanResult): void {
    const maxSeed = Math.max(
      0,
      ...scan.teams.map((team) => this.wholeNumber(team.seed)),
      ...scan.matches.flatMap((match) => [
        this.wholeNumber(match.refSeed),
        this.wholeNumber(match.teamASeed),
        this.wholeNumber(match.teamBSeed)
      ])
    );
    const teamCount = this.clampWholeNumber(scan.teamCount ?? (maxSeed || this.pool.teamCount), 3, 7);
    const scannedTeams = new Map(scan.teams.map((team) => [this.wholeNumber(team.seed), team.name?.trim() || null]));
    const gamesPerMatch = this.clampWholeNumber(scan.gamesPerMatch ?? this.pool.gamesPerMatch, 1, 5);

    this.pool = {
      ...this.pool,
      title: scan.title?.trim() || this.pool.title,
      teamCount,
      gamesPerMatch,
      targetScore: scan.targetScore == null
        ? this.defaultTargetScore(teamCount)
        : this.clampWholeNumber(scan.targetScore, 1, 99),
      teams: Array.from({ length: teamCount }, (_, index) => {
        const seed = index + 1;
        return {
          seed,
          name: scannedTeams.get(seed) || this.pool.teams.find((team) => team.seed === seed)?.name || `Team ${seed}`
        };
      }),
      matches: scan.matches.length
        ? scan.matches.map((match) => this.createScannedMatch(match, teamCount, gamesPerMatch))
        : this.createTemplateMatches(teamCount, gamesPerMatch)
    };
    this.expandedMatchId = null;
    this.touch();
  }

  private buildScanSummary(scan: OutdoorSheetScanResult): { read: string[]; assumed: string[]; manual: string[] } {
    const maxSeed = Math.max(
      0,
      ...scan.teams.map((team) => this.wholeNumber(team.seed)),
      ...scan.matches.flatMap((match) => [
        this.wholeNumber(match.refSeed),
        this.wholeNumber(match.teamASeed),
        this.wholeNumber(match.teamBSeed)
      ])
    );
    const teamCount = this.clampWholeNumber(scan.teamCount ?? (maxSeed || this.pool.teamCount), 3, 7);
    const namedTeams = scan.teams.filter((team) => team.name?.trim()).length;
    const completeMatches = scan.matches.filter((match) => (
      this.seedOrNull(match.refSeed, teamCount) != null
      && this.seedOrNull(match.teamASeed, teamCount) != null
      && this.seedOrNull(match.teamBSeed, teamCount) != null
    )).length;
    const defaultScheduleUsed = scan.matches.length === 0 && this.createTemplateMatches(teamCount).length > 0;
    const targetScore = scan.targetScore ?? this.defaultTargetScore(teamCount);
    const gamesPerMatch = scan.gamesPerMatch ?? this.pool.gamesPerMatch;

    const read = [
      scan.title?.trim() ? `Title: ${scan.title.trim()}` : '',
      scan.teamCount != null ? `Team count: ${scan.teamCount}` : '',
      scan.gamesPerMatch != null && scan.targetScore != null ? `Format: ${scan.gamesPerMatch} games to ${scan.targetScore}` : '',
      namedTeams > 0 ? `Team names: ${namedTeams} of ${teamCount}` : '',
      completeMatches > 0 ? `Schedule rows: ${completeMatches}` : ''
    ].filter(Boolean);
    const assumed = [
      scan.teamCount == null ? `Team count assumed from OCR context: ${teamCount}` : '',
      scan.gamesPerMatch == null || scan.targetScore == null ? `Format assumed: ${gamesPerMatch} games to ${targetScore}` : '',
      defaultScheduleUsed ? `Schedule assumed from the ${teamCount}-team default order` : '',
      ...scan.notes.filter((note) => !/review handwritten team names/i.test(note))
    ].filter(Boolean);
    const manual = [
      namedTeams < teamCount ? `Fill or verify ${teamCount - namedTeams} team name${teamCount - namedTeams === 1 ? '' : 's'}` : 'Verify handwritten team names',
      completeMatches < this.pool.matches.length ? 'Review the match order and Work Team values' : '',
      'Confirm games per match and target score before scoring'
    ].filter(Boolean);

    return {
      read,
      assumed,
      manual
    };
  }

  private createScannedMatch(
    match: { refSeed: number | null; teamASeed: number | null; teamBSeed: number | null },
    teamCount: number,
    gamesPerMatch: number
  ): OutdoorMatch {
    return {
      id: this.createId(),
      refSeed: this.seedOrNull(match.refSeed, teamCount),
      teamASeed: this.seedOrNull(match.teamASeed, teamCount),
      teamBSeed: this.seedOrNull(match.teamBSeed, teamCount),
      games: this.createGames(gamesPerMatch),
      final: false
    };
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

  private createTemplateMatches(teamCount: number, gamesPerMatch = this.pool?.gamesPerMatch ?? 2): OutdoorMatch[] {
    const template = DEFAULT_SCHEDULES[teamCount] ?? [];
    return template.map((row) => ({
      id: this.createId(),
      refSeed: row.refSeed,
      teamASeed: row.teamASeed,
      teamBSeed: row.teamBSeed,
      games: this.createGames(gamesPerMatch),
      final: false
    }));
  }

  private defaultTargetScore(teamCount: number): number {
    return teamCount === 4 ? 15 : 11;
  }

  private createGames(gamesPerMatch = this.pool?.gamesPerMatch ?? 2): OutdoorGameScore[] {
    return Array.from({ length: gamesPerMatch }, () => ({
      scoreA: 0,
      scoreB: 0
    }));
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

  private resizeGames(games: OutdoorGameScore[]): OutdoorGameScore[] {
    return this.resizeGamesForCount(games, this.pool.gamesPerMatch);
  }

  private resizeGamesForCount(games: OutdoorGameScore[], count: number): OutdoorGameScore[] {
    return Array.from({ length: count }, (_, index) => {
      const existing = games[index];
      return {
        scoreA: this.wholeNumber(existing?.scoreA),
        scoreB: this.wholeNumber(existing?.scoreB)
      };
    });
  }

  private buildStandings(): OutdoorTeamStanding[] {
    const standings = new Map<number, OutdoorTeamStanding>();

    for (const team of this.pool.teams) {
      standings.set(team.seed, {
        seed: team.seed,
        name: team.name,
        wins: 0,
        losses: 0,
        pointDifferential: 0
      });
    }

    for (const match of this.pool.matches) {
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
        || this.headToHeadWins(right.seed, left.seed) - this.headToHeadWins(left.seed, right.seed)
        || left.seed - right.seed;
    });
  }

  private headToHeadWins(seed: number, opponentSeed: number): number {
    let wins = 0;

    for (const match of this.pool.matches) {
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

  private clampWholeNumber(value: number, min: number, max: number): number {
    return Math.min(max, Math.max(min, this.wholeNumber(value)));
  }

  private wholeNumber(value: unknown): number {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }
}
