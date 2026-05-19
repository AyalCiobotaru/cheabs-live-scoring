import { Component, OnDestroy, OnInit, effect, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { PoolSetupComponent } from '../../components/pool-setup/pool-setup.component';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';

@Component({
  selector: 'app-pool-setup-page',
  standalone: true,
  imports: [PoolSetupComponent],
  templateUrl: './pool-setup-page.component.html'
})
export class PoolSetupPageComponent implements OnInit, OnDestroy {
  readonly scoring = inject(ScoringEventStateService);
  private readonly route = inject(ActivatedRoute);
  private routeSubscription?: Subscription;

  constructor() {
    effect(() => {
      this.scoring.version();
      const poolId = this.route.snapshot.paramMap.get('poolId');

      if (poolId) {
        this.scoring.redirectInvalidPool(poolId);
        this.scoring.startEditPoolDraft(poolId);
      } else {
        this.scoring.startNewPoolDraft();
      }
    });
  }

  ngOnInit(): void {
    this.routeSubscription = this.route.paramMap.subscribe((params) => {
      const poolId = params.get('poolId');

      if (poolId) {
        this.scoring.startEditPoolDraft(poolId);
      } else {
        this.scoring.startNewPoolDraft();
      }
    });
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
  }
}
