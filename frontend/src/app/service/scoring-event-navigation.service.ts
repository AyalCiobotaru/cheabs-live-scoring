import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({ providedIn: 'root' })
export class ScoringEventNavigationService {
  constructor(private readonly router: Router) {}

  home(): Promise<boolean> {
    return this.router.navigate(['/']);
  }

  event(eventCode: string): Promise<boolean> {
    return this.router.navigate(['/events', eventCode]);
  }

  eventWithFilters(
    eventCode: string,
    filters: { category: string | null; division: string | null }
  ): Promise<boolean> {
    return this.router.navigate(['/events', eventCode], {
      queryParams: filters.category
        ? { category: filters.category, ...(filters.division ? { division: filters.division } : {}) }
        : {}
    });
  }

  favoritePools(eventCode: string): Promise<boolean> {
    return this.router.navigate(['/events', eventCode], {
      queryParams: { favorites: '1' }
    });
  }

  pool(eventCode: string, poolId: string): Promise<boolean> {
    return this.router.navigate(['/events', eventCode, 'pools', poolId]);
  }

  poolOrEvent(eventCode: string, poolId: string | null): Promise<boolean> {
    return poolId ? this.pool(eventCode, poolId) : this.event(eventCode);
  }

  poolSetup(eventCode: string, poolId: string): Promise<boolean> {
    return this.router.navigate(['/events', eventCode, 'pools', poolId, 'setup']);
  }

  newPool(eventCode: string): Promise<boolean> {
    return this.router.navigate(['/events', eventCode, 'new-pool']);
  }

  poolTimer(eventCode: string, poolId: string): Promise<boolean> {
    return this.router.navigate(['/events', eventCode, 'pools', poolId, 'timer']);
  }

  url(route: string): Promise<boolean> {
    return this.router.navigateByUrl(route);
  }
}
