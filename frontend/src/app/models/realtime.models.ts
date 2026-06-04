import { EventState } from './event.models';
import { Match, PoolState } from './pool.models';

export interface PoolTimerUpdate {
  nextMatchStartAt: string | null;
  nextMatchStartSourceMatchId: string | null;
}

export interface RealtimeSnapshot {
  clientId: string;
  eventCode: string;
  kind:
    | 'event-updated'
    | 'pool-setup-updated'
    | 'pool-deleted'
    | 'pool-timer-updated'
    | 'match-updated'
    | 'event-snapshot-request'
    | 'event-snapshot';
  message: string;
  updatedAt: string;
  event?: EventState;
  pool?: PoolState;
  poolId?: string;
  match?: Match;
  timer?: PoolTimerUpdate;
}

export interface SnapshotRequest {
  clientId: string;
  requestedAt: string;
}
