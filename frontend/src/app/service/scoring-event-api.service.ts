import { Injectable } from '@angular/core';
import { CsvImportResponse, CsvImportRow, EventState, Match, PoolState, SeededPoolsResponse } from '../models';
import { poolWithoutImage } from '../util/scoring-event-projection';

@Injectable({ providedIn: 'root' })
export class ScoringEventApiService {
  async loadEvent(code: string, adminPassword = ''): Promise<EventState> {
    const response = await fetch(`/api/scoring/events/${code}`, {
      headers: adminPassword ? this.adminHeaders(adminPassword) : undefined
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }

    return this.eventFromResponse(response);
  }

  async createEvent(code: string, name: string, adminPassword: string): Promise<EventState> {
    const response = await fetch('/api/scoring/events', {
      method: 'POST',
      headers: this.adminHeaders(adminPassword),
      body: JSON.stringify({ code, name })
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }

    return this.eventFromResponse(response);
  }

  async importEvent(fileName: string, rows: CsvImportRow[], adminPassword: string): Promise<CsvImportResponse> {
    const response = await fetch('/api/scoring/events/import', {
      method: 'POST',
      headers: this.adminHeaders(adminPassword),
      body: JSON.stringify({ fileName, rows })
    });
    const body = (await response.json().catch(() => ({}))) as CsvImportResponse;

    if (!response.ok || !body.event) {
      return {
        errors: body.errors ?? [{ lineNumber: null, message: body.message || body.error || 'Import failed.' }],
        warnings: body.warnings ?? []
      };
    }

    return body;
  }

  async adminLogin(adminPassword: string): Promise<void> {
    const response = await fetch('/api/scoring/admin-login', {
      method: 'POST',
      headers: this.adminHeaders(adminPassword)
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }
  }

  async replaceSeededPools(
    eventCode: string,
    payload: {
      pools: PoolState[];
      category: string;
      division: string;
      replaceDivisionPools: boolean;
      confirmOverwriteScored: boolean;
    },
    adminPassword: string
  ): Promise<SeededPoolsResponse> {
    const response = await fetch(`/api/scoring/events/${eventCode}/pools/bulk`, {
      method: 'PUT',
      headers: this.adminHeaders(adminPassword),
      body: JSON.stringify({
        division: payload.division,
        category: payload.category,
        replaceDivisionPools: payload.replaceDivisionPools,
        confirmOverwriteScored: payload.confirmOverwriteScored,
        pools: payload.pools.map(poolWithoutImage)
      })
    });
    const body = (await response.json().catch(() => ({}))) as SeededPoolsResponse;

    if (!response.ok || !body.event) {
      return body;
    }

    return body;
  }

  async deletePool(eventCode: string, poolId: string, adminPassword: string): Promise<EventState> {
    const response = await fetch(`/api/scoring/events/${eventCode}/pools/${poolId}`, {
      method: 'DELETE',
      headers: this.adminHeaders(adminPassword)
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }

    return this.eventFromResponse(response);
  }

  async savePoolSetup(event: EventState, pool: PoolState, adminPassword: string): Promise<void> {
    const response = await fetch(`/api/scoring/events/${event.code}/pools/${pool.id}`, {
      method: 'PUT',
      headers: this.adminHeaders(adminPassword),
      body: JSON.stringify({
        eventName: event.name,
        activePoolId: pool.id,
        pool: poolWithoutImage(pool)
      })
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }
  }

  async saveMatch(
    eventCode: string,
    pool: PoolState,
    match: Match,
    timerAction: 'start' | 'clear' | undefined,
    adminPassword: string,
    useAdminHeaders: boolean
  ): Promise<void> {
    const response = await fetch(`/api/scoring/events/${eventCode}/pools/${pool.id}/matches/${match.id}`, {
      method: 'PUT',
      headers: useAdminHeaders ? this.adminHeaders(adminPassword) : { 'content-type': 'application/json' },
      body: JSON.stringify({ match, timerAction })
    });

    if (!response.ok) {
      throw new Error(await this.errorMessage(response));
    }
  }

  private async eventFromResponse(response: Response): Promise<EventState> {
    const body = (await response.json()) as { event: EventState };
    return body.event;
  }

  private async errorMessage(response: Response): Promise<string> {
    const body = (await response.json().catch(() => ({}))) as { message?: string; error?: string };
    return body.message || body.error || 'Unable to save event.';
  }

  private adminHeaders(adminPassword: string): Record<string, string> {
    return {
      'content-type': 'application/json',
      'x-admin-password': adminPassword
    };
  }
}
