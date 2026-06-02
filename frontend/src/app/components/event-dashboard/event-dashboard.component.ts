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

  @Output() addPool = new EventEmitter<void>();
  @Output() poolSelected = new EventEmitter<string>();
  @Output() poolDeleted = new EventEmitter<string>();
}
