import { Component, EventEmitter, Input, OnDestroy, OnInit, Output, signal } from '@angular/core';
import { GameScore, Match, PoolState, TeamStanding } from '../../models';
import { wholeNumber } from '../../util/scoring-helpers';

interface CurrentScore {
  games: GameScore[];
  match: Match;
  setNumber: number;
}

@Component({
  selector: 'app-pool-summary',
  standalone: true,
  templateUrl: './pool-summary.component.html',
  styleUrl: './pool-summary.component.scss'
})
export class PoolSummaryComponent implements OnInit, OnDestroy {
  @Input({ required: true }) pool!: PoolState;
  @Input({ required: true }) standings: TeamStanding[] = [];
  @Input({ required: true }) matchSummary = '';
  @Input({ required: true }) completedMatches = 0;
  @Input({ required: true }) totalMatches = 0;
  @Output() timerSelected = new EventEmitter<void>();

  readonly now = signal(Date.now());
  private tickInterval: number | null = null;

  ngOnInit(): void {
    this.tickInterval = window.setInterval(() => {
      this.now.set(Date.now());
    }, 1000);
  }

  ngOnDestroy(): void {
    if (this.tickInterval != null) {
      window.clearInterval(this.tickInterval);
    }
  }

  scoreFormatLabel(): string {
    return this.pool.pointCap == null ? 'No Cap' : `cap ${this.pool.pointCap}`;
  }

  courtSummary(): string {
    const courtNumbers = this.pool.courtNumbers ?? [];

    return courtNumbers.length ? `Court${courtNumbers.length === 1 ? '' : 's'} ${courtNumbers.join(', ')}` : '';
  }

  truthSeedFor(seed: number): number | null {
    return this.pool.teams.find((team) => team.seed === seed)?.seededSourceSeed ?? null;
  }

  currentScore(): CurrentScore | null {
    const match = this.pool.matches.find(
      (candidate) =>
        !candidate.final &&
        candidate.games.some((game) => game.final || wholeNumber(game.scoreA) > 0 || wholeNumber(game.scoreB) > 0)
    );

    if (!match) {
      return null;
    }

    const gameIndex = match.games.findIndex((game) => !game.final);
    const currentGameIndex = gameIndex >= 0 ? gameIndex : match.games.length - 1;

    return {
      games: match.games.slice(0, currentGameIndex + 1),
      match,
      setNumber: currentGameIndex + 1
    };
  }

  teamName(seed: number | null): string {
    if (seed == null) {
      return 'Team';
    }

    return this.pool.teams.find((team) => team.seed === seed)?.name ?? `Team ${seed}`;
  }

  timerStatus(): string {
    if (!this.pool.nextMatchStartAt) {
      return '';
    }

    const deadline = Date.parse(this.pool.nextMatchStartAt);

    if (!Number.isFinite(deadline)) {
      return '';
    }

    const remainingMs = deadline - this.now();

    if (remainingMs <= 0) {
      return 'Timer expired, Start Match';
    }

    return `Next match in ${this.formatRemaining(remainingMs)}`;
  }

  showTimerButton(): boolean {
    return this.pool.matchStartTimerMinutes > 0;
  }

  timerButtonClicked(event: Event): void {
    event.stopPropagation();
    this.timerSelected.emit();
  }

  private formatRemaining(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
