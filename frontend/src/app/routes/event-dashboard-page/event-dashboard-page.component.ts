import { Component, OnDestroy, OnInit, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { EventDashboardComponent } from '../../components/event-dashboard/event-dashboard.component';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';

@Component({
  selector: 'app-event-dashboard-page',
  standalone: true,
  imports: [EventDashboardComponent],
  templateUrl: './event-dashboard-page.component.html'
})
export class EventDashboardPageComponent implements OnInit, OnDestroy {
  readonly scoring = inject(ScoringEventStateService);
  private readonly route = inject(ActivatedRoute);
  private querySubscription?: Subscription;

  ngOnInit(): void {
    this.scoring.draftPool = null;
    this.scoring.expandedMatchId = null;
    this.querySubscription = this.route.queryParamMap.subscribe((params) => {
      this.scoring.setSelectedDivisionFromRoute(params.get('division'));
    });
  }

  ngOnDestroy(): void {
    this.querySubscription?.unsubscribe();
  }
}
