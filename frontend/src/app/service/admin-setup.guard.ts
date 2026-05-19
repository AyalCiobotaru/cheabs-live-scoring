import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ScoringEventStateService } from './scoring-event-state.service';

export const adminSetupGuard: CanActivateFn = (_route, state) => {
  const scoring = inject(ScoringEventStateService);
  const router = inject(Router);

  if (scoring.isAdmin) {
    return true;
  }

  scoring.requestAdminRoute(state.url);

  const match = state.url.match(/^\/events\/([^/?]+)(?:\/pools\/([^/?]+)\/setup|\/new-pool)/);

  if (!match) {
    return router.createUrlTree(['/']);
  }

  const [, eventCode, poolId] = match;
  return poolId
    ? router.createUrlTree(['/events', eventCode, 'pools', poolId])
    : router.createUrlTree(['/events', eventCode]);
};
