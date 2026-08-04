import { Injectable, NgZone } from '@angular/core';
import { Subscription } from 'rxjs';
import { EventState, Match, PoolState, PoolTimerUpdate } from '../models';
import { ScoringRealtimeService } from './scoring-realtime.service';

interface RealtimeHandlers {
  event: (event: EventState) => void;
  poolSetup: (pool: PoolState) => void;
  poolDeleted: (poolId: string) => void;
  match: (poolId: string, match: Match) => void;
  poolTimer: (poolId: string, timer: PoolTimerUpdate) => void;
  snapshotRequest: () => void;
}

@Injectable({ providedIn: 'root' })
export class ScoringEventRealtimeCoordinatorService {
  private subscriptions: Subscription[] = [];

  readonly status$ = this.realtime.status$;

  constructor(
    private readonly zone: NgZone,
    private readonly realtime: ScoringRealtimeService
  ) {}

  start(handlers: RealtimeHandlers): void {
    this.stopSubscriptions();
    this.subscriptions = [
      this.realtime.remoteEvent$.subscribe((event) => {
        this.zone.run(() => handlers.event(event));
      }),
      this.realtime.remotePoolSetup$.subscribe((pool) => {
        this.zone.run(() => handlers.poolSetup(pool));
      }),
      this.realtime.remotePoolDeleted$.subscribe((poolId) => {
        this.zone.run(() => handlers.poolDeleted(poolId));
      }),
      this.realtime.remoteMatch$.subscribe(({ poolId, match }) => {
        this.zone.run(() => handlers.match(poolId, match));
      }),
      this.realtime.remotePoolTimer$.subscribe(({ poolId, timer }) => {
        this.zone.run(() => handlers.poolTimer(poolId, timer));
      }),
      this.realtime.snapshotRequest$.subscribe(() => {
        this.zone.run(() => handlers.snapshotRequest());
      })
    ];
  }

  async connect(eventCode: string): Promise<void> {
    await this.realtime.connect(eventCode);
  }

  close(): void {
    this.stopSubscriptions();
    this.realtime.close();
  }

  publishSnapshot(event: EventState): void {
    this.realtime.publishSnapshot(event);
  }

  publishMatch(pool: PoolState, match: Match): void {
    this.realtime.publishMatch(pool, match);
  }

  publishPoolTimer(pool: PoolState): void {
    this.realtime.publishPoolTimer(pool);
  }

  private stopSubscriptions(): void {
    for (const subscription of this.subscriptions) {
      subscription.unsubscribe();
    }

    this.subscriptions = [];
  }
}
