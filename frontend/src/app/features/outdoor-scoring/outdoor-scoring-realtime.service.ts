import { Injectable, NgZone } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { Realtime, type InboundMessage, type RealtimeChannel } from 'ably';
import { OutdoorPoolState, OutdoorRealtimeSnapshot, OutdoorSnapshotRequest } from './outdoor-scoring.models';

type RealtimeStatus = 'checking' | 'disabled' | 'connecting' | 'connected' | 'failed';

@Injectable({ providedIn: 'root' })
export class OutdoorScoringRealtimeService {
  private readonly channelName = 'cheabs:live-scoring:global';
  private readonly updateEventName = 'score-update';
  private readonly snapshotRequestEventName = 'snapshot-request';
  private readonly clientId = this.createId();
  private client: Realtime | null = null;
  private channel: RealtimeChannel | null = null;

  readonly status$ = new BehaviorSubject<RealtimeStatus>('checking');
  readonly remotePool$ = new Subject<OutdoorPoolState>();
  readonly snapshotRequest$ = new Subject<void>();

  constructor(private readonly zone: NgZone) {}

  async connect(): Promise<void> {
    if (this.client) {
      return;
    }

    const enabled = await this.isEnabled();

    if (!enabled) {
      this.status$.next('disabled');
      return;
    }

    this.status$.next('connecting');
    this.client = new Realtime({
      authUrl: '/api/outdoor-scoring/ably-token'
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

    this.channel = this.client.channels.get(this.channelName, {
      params: { rewind: '1' }
    });
    await this.channel.subscribe(this.updateEventName, (message: InboundMessage) => {
      const snapshot = message.data as OutdoorRealtimeSnapshot;

      if (!snapshot?.pool || snapshot.clientId === this.clientId) {
        return;
      }

      this.zone.run(() => this.remotePool$.next(snapshot.pool));
    });
    await this.channel.subscribe(this.snapshotRequestEventName, (message: InboundMessage) => {
      const request = message.data as OutdoorSnapshotRequest;

      if (request?.clientId === this.clientId) {
        return;
      }

      this.zone.run(() => this.snapshotRequest$.next());
    });
    this.requestSnapshot();
  }

  publish(pool: OutdoorPoolState, kind: OutdoorRealtimeSnapshot['kind'] = 'pool-updated'): void {
    if (!this.channel || this.status$.value !== 'connected') {
      return;
    }

    const syncedPool: OutdoorPoolState = {
      ...pool,
      imagePreview: null
    };

    void this.channel.publish(this.updateEventName, {
      clientId: this.clientId,
      kind,
      message: kind === 'score-updated' ? 'Outdoor scoring score update.' : 'Outdoor scoring pool update.',
      updatedAt: new Date().toISOString(),
      pool: syncedPool
    } satisfies OutdoorRealtimeSnapshot);
  }

  requestSnapshot(): void {
    if (!this.channel || this.status$.value !== 'connected') {
      return;
    }

    void this.channel.publish(this.snapshotRequestEventName, {
      clientId: this.clientId,
      requestedAt: new Date().toISOString()
    } satisfies OutdoorSnapshotRequest);
  }

  close(): void {
    this.client?.close();
    this.client = null;
    this.channel = null;
  }

  private async isEnabled(): Promise<boolean> {
    try {
      const response = await fetch('/api/outdoor-scoring/realtime-config');

      if (!response.ok) {
        return false;
      }

      const body = await response.json() as { enabled?: boolean };
      return body.enabled === true;
    } catch {
      return false;
    }
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
