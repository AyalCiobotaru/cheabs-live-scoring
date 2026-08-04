import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CategoryPoolGroup, DivisionPoolGroup, EventState, PoolCard } from '../../models';
import { PoolSummaryComponent } from '../pool-summary/pool-summary.component';

@Component({
  selector: 'app-event-dashboard',
  standalone: true,
  imports: [PoolSummaryComponent],
  templateUrl: './event-dashboard.component.html',
  styleUrl: './event-dashboard.component.scss'
})
export class EventDashboardComponent {
  @Input({ required: true }) event!: EventState;
  @Input({ required: true }) isAdmin = false;
  @Input({ required: true }) poolCards: PoolCard[] = [];
  @Input({ required: true }) visibleCategoryPoolGroups: CategoryPoolGroup[] = [];
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
  @Output() divisionPublished = new EventEmitter<{ category: string; division: string }>();
  @Output() divisionSeededEdited = new EventEmitter<{ category: string; division: string }>();

  isFavorite(poolId: string): boolean {
    return this.favoritePoolIds.includes(poolId);
  }

  hiddenPoolCount(group: DivisionPoolGroup): number {
    return group.cards.filter((card) => card.pool.hidden).length;
  }

  hasSeededPoolSource(group: DivisionPoolGroup): boolean {
    return group.cards.some((card) => card.pool.seededPoolSource);
  }
}
