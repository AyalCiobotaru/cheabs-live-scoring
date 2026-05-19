import { Component, OnDestroy, OnInit, effect, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import {
  PoolViewComponent,
  MatchExpandedChange,
  MatchMove,
  MatchScoreChange
} from '../../components/pool-view/pool-view.component';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';

@Component({
  selector: 'app-pool-page',
  standalone: true,
  imports: [PoolViewComponent],
  templateUrl: './pool-page.component.html'
})
export class PoolPageComponent implements OnInit, OnDestroy {
  readonly scoring = inject(ScoringEventStateService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription?: Subscription;

  constructor() {
    effect(() => {
      this.scoring.version();
      this.scoring.redirectInvalidPool(this.route.snapshot.paramMap.get('poolId'));
    });
  }

  ngOnInit(): void {
    this.scoring.draftPool = null;
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      this.scoring.setActivePool(params.get('poolId'));
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }

  handleExpandedChange(change: MatchExpandedChange): void {
    this.scoring.setExpanded(change.matchId, change.expanded);
  }

  handleMatchScoreChanged(change: MatchScoreChange): void {
    this.scoring.handleScoreChanged(change.match, change.game);
  }

  handleMatchMoved(move: MatchMove): void {
    this.scoring.moveMatch(move.matchId, move.direction);
  }
}
