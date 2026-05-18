import { NgClass } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { OutdoorGameScore, OutdoorMatch, OutdoorTeam } from '../outdoor-scoring.models';

@Component({
  selector: 'app-outdoor-match-row',
  standalone: true,
  imports: [FormsModule, NgClass],
  templateUrl: './outdoor-match-row.component.html',
  styleUrl: './outdoor-match-row.component.scss'
})
export class OutdoorMatchRowComponent {
  @Input({ required: true }) match!: OutdoorMatch;
  @Input({ required: true }) teams: OutdoorTeam[] = [];
  @Input({ required: true }) index = 0;
  @Input({ required: true }) targetScore = 25;
  @Input() expanded = false;
  @Input() first = false;
  @Input() last = false;

  @Output() expandedChange = new EventEmitter<boolean>();
  @Output() scoreChanged = new EventEmitter<void>();
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
    this.expandedChange.emit(!this.expanded);
  }

  updateScore(game: OutdoorGameScore, side: 'A' | 'B', change: number): void {
    if (this.match.final) {
      return;
    }

    if (side === 'A') {
      game.scoreA = Math.max(0, this.wholeNumber(game.scoreA) + change);
    } else {
      game.scoreB = Math.max(0, this.wholeNumber(game.scoreB) + change);
    }

    this.scoreChanged.emit();
  }

  normalizeScore(game: OutdoorGameScore, side: 'A' | 'B'): void {
    if (side === 'A') {
      game.scoreA = Math.max(0, this.wholeNumber(game.scoreA));
    } else {
      game.scoreB = Math.max(0, this.wholeNumber(game.scoreB));
    }
    this.scoreChanged.emit();
  }

  markFinal(): void {
    this.match.final = true;
    this.expandedChange.emit(false);
    this.finalChanged.emit();
  }

  reopen(): void {
    this.match.final = false;
    this.expandedChange.emit(true);
    this.finalChanged.emit();
  }

  private wholeNumber(value: unknown): number {
    const number = Number(value);
    return Number.isInteger(number) && number >= 0 ? number : 0;
  }
}
