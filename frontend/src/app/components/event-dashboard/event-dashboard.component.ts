import { Component, EventEmitter, Input, Output } from '@angular/core';
import { DivisionPoolGroup, EventState, PoolCard } from '../../models';
import { PoolSummaryComponent } from '../pool-summary/pool-summary.component';

@Component({
  selector: 'app-event-dashboard',
  standalone: true,
  imports: [PoolSummaryComponent],
  templateUrl: './event-dashboard.component.html'
})
export class EventDashboardComponent {
  @Input({ required: true }) event!: EventState;
  @Input({ required: true }) isAdmin = false;
  @Input({ required: true }) poolCards: PoolCard[] = [];
  @Input({ required: true }) visibleDivisionPoolGroups: DivisionPoolGroup[] = [];
  @Input({ required: true }) favoritePoolIds: string[] = [];
  @Input({ required: true }) showingFavoritePools = false;
  @Input({ required: true }) favoritePoolCount = 0;

  @Output() addPool = new EventEmitter<void>();
  @Output() allPoolsSelected = new EventEmitter<void>();
  @Output() favoritesSelected = new EventEmitter<void>();
  @Output() poolFavoriteToggled = new EventEmitter<string>();
  @Output() poolSelected = new EventEmitter<string>();
  @Output() timerSelected = new EventEmitter<string>();
  @Output() poolDeleted = new EventEmitter<string>();

  isFavorite(poolId: string): boolean {
    return this.favoritePoolIds.includes(poolId);
  }
}
