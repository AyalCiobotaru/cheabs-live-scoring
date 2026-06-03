import { Component, EventEmitter, Input, Output } from '@angular/core';
import { GameScore, Match, PoolCard, PoolState } from '../../models';
import { MatchRowComponent } from '../match-row/match-row.component';
import { PoolSummaryComponent } from '../pool-summary/pool-summary.component';

export interface MatchExpandedChange {
  matchId: string;
  expanded: boolean;
}

export interface MatchScoreChange {
  match: Match;
  game: GameScore;
}

export interface MatchMove {
  matchId: string;
  direction: -1 | 1;
}

@Component({
  selector: 'app-pool-view',
  standalone: true,
  imports: [MatchRowComponent, PoolSummaryComponent],
  templateUrl: './pool-view.component.html'
})
export class PoolViewComponent {
  @Input({ required: true }) eventName = '';
  @Input({ required: true }) pool!: PoolState;
  @Input({ required: true }) activePoolCard: PoolCard | null = null;
  @Input({ required: true }) expandedMatchId: string | null = null;
  @Input({ required: true }) isAdmin = false;

  @Output() editSetup = new EventEmitter<void>();
  @Output() poolDeleted = new EventEmitter<void>();
  @Output() timerSelected = new EventEmitter<void>();
  @Output() expandedChange = new EventEmitter<MatchExpandedChange>();
  @Output() scoreChanged = new EventEmitter<MatchScoreChange>();
  @Output() finalChanged = new EventEmitter<Match>();
  @Output() moved = new EventEmitter<MatchMove>();
  @Output() removed = new EventEmitter<string>();
}
