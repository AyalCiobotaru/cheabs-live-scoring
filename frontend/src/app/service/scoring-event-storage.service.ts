import { Injectable } from '@angular/core';
import { EventState } from '../models';
import { eventWithoutImages } from '../util/scoring-event-projection';

const CURRENT_EVENT_KEY = 'cheabs.liveScoring.currentEvent.v1';
const POOL_FAVORITES_KEY_PREFIX = 'cheabs.liveScoring.poolFavorites.v1.';
const ADMIN_PASSWORD_KEY = 'cheabs.liveScoring.adminPassword.v1';

@Injectable({ providedIn: 'root' })
export class ScoringEventStorageService {
  currentEventCode(): string {
    return localStorage.getItem(CURRENT_EVENT_KEY) ?? '';
  }

  adminPassword(): string {
    return sessionStorage.getItem(ADMIN_PASSWORD_KEY) ?? '';
  }

  saveAdminPassword(adminPassword: string): void {
    sessionStorage.setItem(ADMIN_PASSWORD_KEY, adminPassword);
  }

  clearAdminPassword(): void {
    sessionStorage.removeItem(ADMIN_PASSWORD_KEY);
  }

  clearCurrentEventCode(): void {
    localStorage.removeItem(CURRENT_EVENT_KEY);
  }

  saveEvent(event: EventState, isAdmin: boolean): void {
    localStorage.setItem(CURRENT_EVENT_KEY, event.code);
    localStorage.setItem(this.localEventKey(event.code), JSON.stringify(eventWithoutImages(event, isAdmin)));
  }

  loadFavoritePoolIds(event: EventState): Set<string> {
    const raw = localStorage.getItem(this.poolFavoritesKey(event.code));
    const ids = parseStoredStringArray(raw);
    const eventPoolIds = new Set(event.pools.map((pool) => pool.id));
    return new Set(ids.filter((id) => eventPoolIds.has(id)));
  }

  saveFavoritePoolIds(event: EventState, favoritePoolIds: Set<string>): void {
    const eventPoolIds = new Set(event.pools.map((pool) => pool.id));
    const ids = [...favoritePoolIds].filter((id) => eventPoolIds.has(id));
    localStorage.setItem(this.poolFavoritesKey(event.code), JSON.stringify(ids));
  }

  private localEventKey(code: string): string {
    return `cheabs.liveScoring.event.${code}.v1`;
  }

  private poolFavoritesKey(code: string): string {
    return `${POOL_FAVORITES_KEY_PREFIX}${code}`;
  }
}

const parseStoredStringArray = (raw: string | null): string[] => {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((value): value is string => typeof value === 'string') : [];
  } catch {
    return [];
  }
};
