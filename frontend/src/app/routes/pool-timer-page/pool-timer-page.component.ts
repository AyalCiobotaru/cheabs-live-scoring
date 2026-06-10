import { Component, OnDestroy, OnInit, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Subscription } from 'rxjs';
import { ScoringEventStateService } from '../../service/scoring-event-state.service';

@Component({
  selector: 'app-pool-timer-page',
  standalone: true,
  templateUrl: './pool-timer-page.component.html',
  styleUrl: './pool-timer-page.component.scss'
})
export class PoolTimerPageComponent implements OnInit, OnDestroy {
  readonly scoring = inject(ScoringEventStateService);
  readonly now = signal(Date.now());

  private readonly route = inject(ActivatedRoute);
  private routeSubscription?: Subscription;
  private tickInterval: number | null = null;

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
    this.tickInterval = window.setInterval(() => {
      this.now.set(Date.now());
    }, 1000);
  }

  ngOnDestroy(): void {
    this.routeSubscription?.unsubscribe();
    if (this.tickInterval != null) {
      window.clearInterval(this.tickInterval);
    }
  }

  timerStatus(): string {
    const pool = this.scoring.activePool;

    if (!pool) {
      return 'No active timer';
    }

    if (pool.matchStartTimerMinutes <= 0) {
      return 'Timer disabled';
    }

    if (!pool.nextMatchStartAt) {
      return 'No active timer';
    }

    const deadline = Date.parse(pool.nextMatchStartAt);

    if (!Number.isFinite(deadline)) {
      return 'No active timer';
    }

    const remainingMs = deadline - this.now();

    if (remainingMs <= 0) {
      return 'Timer expired, Start Match';
    }

    return this.formatRemaining(remainingMs);
  }

  accessibleLabel(): string {
    const eventName = this.scoring.event?.name ?? 'Event';
    const poolTitle = this.scoring.activePool?.title ?? 'Pool';
    return `${eventName}, ${poolTitle}, ${this.timerStatus()}`;
  }

  private formatRemaining(remainingMs: number): string {
    const totalSeconds = Math.max(0, Math.ceil(remainingMs / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${seconds.toString().padStart(2, '0')}`;
  }
}
