import { EventState } from './event.models';
import { Match, PoolState } from './pool.models';

export interface RealtimeSnapshot {
  clientId: string;
  eventCode: string;
  kind:
    | 'event-updated'
    | 'pool-setup-updated'
    | 'pool-deleted'
    | 'match-updated'
    | 'event-snapshot-request'
    | 'event-snapshot';
  message: string;
  updatedAt: string;
  event?: EventState;
  pool?: PoolState;
  poolId?: string;
  match?: Match;
}

export interface SnapshotRequest {
  clientId: string;
  requestedAt: string;
}
