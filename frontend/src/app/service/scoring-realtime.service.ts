import { Injectable, NgZone } from '@angular/core';
import { Realtime, type InboundMessage, type RealtimeChannel } from 'ably';
import { BehaviorSubject, Subject } from 'rxjs';
import { EventState, Match, PoolState, PoolTimerUpdate, RealtimeSnapshot } from '../models';

type RealtimeStatus = 'checking' | 'disabled' | 'connecting' | 'connected' | 'failed';

@Injectable({ providedIn: 'root' })
export class ScoringRealtimeService {
  private readonly updateEventName = 'event-update';
  private readonly clientId = this.createId();
  private client: Realtime | null = null;
  private channel: RealtimeChannel | null = null;
  private eventCode: string | null = null;

  readonly status$ = new BehaviorSubject<RealtimeStatus>('checking');
  readonly remoteEvent$ = new Subject<EventState>();
  readonly remotePoolSetup$ = new Subject<PoolState>();
  readonly remotePoolDeleted$ = new Subject<string>();
  readonly remoteMatch$ = new Subject<{ poolId: string; match: Match }>();
  readonly remotePoolTimer$ = new Subject<{ poolId: string; timer: PoolTimerUpdate }>();
  readonly snapshotRequest$ = new Subject<void>();

  constructor(private readonly zone: NgZone) {}

  async connect(eventCode: string): Promise<void> {
    if (this.client && this.eventCode === eventCode) {
      return;
    }

    this.close();
    const enabled = await this.isEnabled();

    if (!enabled) {
      this.status$.next('disabled');
      return;
    }

    this.eventCode = eventCode;
    this.status$.next('connecting');
    this.client = new Realtime({
      authUrl: '/api/scoring/ably-token'
    });
    this.client.connection.on((stateChange) => {
      this.zone.run(() => {
        if (stateChange.current === 'connected') {
          this.status$.next('connected');
        } else if (stateChange.current === 'failed' || stateChange.current === 'suspended') {
          this.status$.next('failed');
        }
      });
    });

    this.channel = this.client.channels.get(this.channelName(eventCode), {
      params: { rewind: '1' }
    });
    await this.channel.subscribe(this.updateEventName, (message: InboundMessage) => {
      const snapshot = message.data as RealtimeSnapshot;

      if (!snapshot || snapshot.eventCode !== eventCode || snapshot.clientId === this.clientId) {
        return;
      }

      this.zone.run(() => {
        if ((snapshot.kind === 'event-updated' || snapshot.kind === 'event-snapshot') && snapshot.event) {
          this.remoteEvent$.next(snapshot.event);
        } else if (snapshot.kind === 'pool-setup-updated' && snapshot.pool) {
          this.remotePoolSetup$.next(snapshot.pool);
        } else if (snapshot.kind === 'pool-deleted' && snapshot.poolId) {
          this.remotePoolDeleted$.next(snapshot.poolId);
        } else if (snapshot.kind === 'match-updated' && snapshot.poolId && snapshot.match) {
          this.remoteMatch$.next({ poolId: snapshot.poolId, match: snapshot.match });
        } else if (snapshot.kind === 'pool-timer-updated' && snapshot.poolId && snapshot.timer) {
          this.remotePoolTimer$.next({ poolId: snapshot.poolId, timer: snapshot.timer });
        } else if (snapshot.kind === 'event-snapshot-request') {
          this.snapshotRequest$.next();
        }
      });
    });
    this.requestSnapshot();
  }

  publishMatch(pool: PoolState, match: Match): void {
    if (!this.channel || !this.eventCode) {
      return;
    }

    void this.channel.publish(this.updateEventName, {
      clientId: this.clientId,
      eventCode: this.eventCode,
      kind: 'match-updated',
      message: 'Scoring match update.',
      updatedAt: new Date().toISOString(),
      poolId: pool.id,
      match
    } satisfies RealtimeSnapshot);
  }

  publishPoolTimer(pool: PoolState): void {
    if (!this.channel || !this.eventCode) {
      return;
    }

    void this.channel.publish(this.updateEventName, {
      clientId: this.clientId,
      eventCode: this.eventCode,
      kind: 'pool-timer-updated',
      message: 'Scoring pool timer update.',
      updatedAt: new Date().toISOString(),
      poolId: pool.id,
      timer: {
        nextMatchStartAt: pool.nextMatchStartAt,
        nextMatchStartSourceMatchId: pool.nextMatchStartSourceMatchId
      }
    } satisfies RealtimeSnapshot);
  }

  publishSnapshot(event: EventState): void {
    if (!this.channel || !this.eventCode) {
      return;
    }

    void this.channel.publish(this.updateEventName, {
      clientId: this.clientId,
      eventCode: this.eventCode,
      kind: 'event-snapshot',
      message: 'Scoring event snapshot.',
      updatedAt: new Date().toISOString(),
      event: this.eventWithoutImages(event)
    } satisfies RealtimeSnapshot);
  }

  requestSnapshot(): void {
    if (!this.channel || !this.eventCode) {
      return;
    }

    void this.channel.publish(this.updateEventName, {
      clientId: this.clientId,
      eventCode: this.eventCode,
      kind: 'event-snapshot-request',
      message: 'Scoring snapshot request.',
      updatedAt: new Date().toISOString()
    } satisfies RealtimeSnapshot);
  }

  close(): void {
    this.client?.close();
    this.client = null;
    this.channel = null;
    this.eventCode = null;
  }

  private async isEnabled(): Promise<boolean> {
    try {
      const response = await fetch('/api/scoring/realtime-config');

      if (!response.ok) {
        return false;
      }

      const body = (await response.json()) as { enabled?: boolean };
      return body.enabled === true;
    } catch {
      return false;
    }
  }

  private channelName(eventCode: string): string {
    return `cheabs:live-scoring:event:${eventCode}`;
  }

  private eventWithoutImages(event: EventState): EventState {
    return {
      ...event,
      pools: event.pools.map((pool) => ({
        ...pool,
        imagePreview: null
      }))
    };
  }

  private createId(): string {
    const browserCrypto = globalThis.crypto;

    if (typeof browserCrypto?.randomUUID === 'function') {
      return browserCrypto.randomUUID();
    }

    if (typeof browserCrypto?.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      browserCrypto.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
    }

    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  }
}
