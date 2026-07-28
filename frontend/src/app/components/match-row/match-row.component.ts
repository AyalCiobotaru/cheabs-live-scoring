import { NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { GameScore, Match, Team } from '../../models';

@Component({
  selector: 'app-match-row',
  standalone: true,
  imports: [FormsModule, NgClass],
  templateUrl: './match-row.component.html',
  styleUrl: './match-row.component.scss'
})
export class MatchRowComponent {
  @Input({ required: true }) match!: Match;
  @Input({ required: true }) teams: Team[] = [];
  @Input({ required: true }) index = 0;
  @Input({ required: true }) targetScore = 25;
  @Input({ required: true }) pointCap: number | null = 25;
  @Input() expanded = false;
  @Input() first = false;
  @Input() last = false;
  @Input() canEditSetup = false;
  @Input() canScore = true;

  @Output() expandedChange = new EventEmitter<boolean>();
  @Output() scoreChanged = new EventEmitter<GameScore>();
  @Output() finalChanged = new EventEmitter<void>();
  @Output() movedUp = new EventEmitter<void>();
  @Output() movedDown = new EventEmitter<void>();
  @Output() removed = new EventEmitter<void>();

  teamName(seed: number | null): string {
    if (seed == null) {
      return 'Team';
    }

    return this.teams.find((team) => team.seed === Number(seed))?.name || `Team ${seed}`;
  }

  toggleExpanded(): void {
    if (!this.canScore) {
      return;
    }

    this.expandedChange.emit(!this.expanded);
  }

  updateScore(game: GameScore, side: 'A' | 'B', change: number): void {
    if (!this.canScore || this.match.final || game.final) {
      return;
    }

    if (side === 'A') {
      game.scoreA = this.capScore(this.wholeNumber(game.scoreA) + change);
    } else {
      game.scoreB = this.capScore(this.wholeNumber(game.scoreB) + change);
    }

    this.scoreChanged.emit(game);
  }

  setScore(game: GameScore, side: 'A' | 'B', value: unknown): void {
    if (!this.canScore || this.match.final || game.final) {
      return;
    }

    if (side === 'A') {
      game.scoreA = this.capScore(value);
    } else {
      game.scoreB = this.capScore(value);
    }

    this.scoreChanged.emit(game);
  }

  markGameFinal(game: GameScore): void {
    if (!this.canScore || !this.canMarkGameFinal(game)) {
      return;
    }

    game.final = true;
    this.scoreChanged.emit(game);
  }

  reopenGame(game: GameScore): void {
    if (!this.canScore || this.match.final) {
      return;
    }

    game.final = false;
    this.scoreChanged.emit(game);
  }

  canScoreGame(gameIndex: number): boolean {
    return gameIndex === 0 || Boolean(this.match.games[gameIndex - 1]?.final);
  }

  canMarkGameFinal(game: GameScore): boolean {
    const scoreA = this.wholeNumber(game.scoreA);
    const scoreB = this.wholeNumber(game.scoreB);
    const winningScore = Math.max(scoreA, scoreB);
    const targetScore = Math.max(1, this.wholeNumber(this.targetScore));
    const pointCap = this.normalizedPointCap(targetScore);

    return winningScore >= targetScore && (Math.abs(scoreA - scoreB) >= 2 || winningScore === pointCap);
  }

  canMarkFinal(): boolean {
    return this.match.games.length > 0 && this.match.games.every((game) => game.final);
  }

  markFinal(): void {
    if (!this.canScore || !this.canMarkFinal()) {
      return;
    }

    this.match.final = true;
    this.expandedChange.emit(false);
    this.finalChanged.emit();
  }

  reopen(): void {
    if (!this.canScore) {
      return;
    }

    this.match.final = false;
    this.expandedChange.emit(true);
    this.finalChanged.emit();
  }

  private wholeNumber(value: unknown): number {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }

  private capScore(value: unknown): number {
    const cap = this.normalizedPointCap(1) ?? 99;
    return Math.min(cap, Math.max(0, this.wholeNumber(value)));
  }

  private normalizedPointCap(minimum: number): number | null {
    return this.pointCap == null ? null : Math.max(minimum, this.wholeNumber(this.pointCap));
  }
}
