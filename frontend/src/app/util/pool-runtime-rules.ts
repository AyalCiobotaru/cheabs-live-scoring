import { Match, PoolState } from '../models';
import { clampWholeNumber, wholeNumber } from './scoring-helpers';

export const touchPool = (pool: PoolState): void => {
  pool.matchStartTimerMinutes = clampWholeNumber(pool.matchStartTimerMinutes, 0, 99);
  if (pool.matchStartTimerMinutes === 0) {
    pool.nextMatchStartAt = null;
    pool.nextMatchStartSourceMatchId = null;
  }
  pool.updatedAt = new Date().toISOString();
};

export const touchMatch = (pool: PoolState, match: Match): void => {
  const now = new Date().toISOString();
  match.updatedAt = now;
  pool.updatedAt = now;
};

export const startPoolTimer = (pool: PoolState, match: Match): void => {
  const now = Date.now();
  pool.nextMatchStartAt = new Date(now + pool.matchStartTimerMinutes * 60_000).toISOString();
  pool.nextMatchStartSourceMatchId = match.id;
};

export const clearPoolTimer = (pool: PoolState): boolean => {
  if (!pool.nextMatchStartAt && !pool.nextMatchStartSourceMatchId) {
    return false;
  }

  pool.nextMatchStartAt = null;
  pool.nextMatchStartSourceMatchId = null;
  return true;
};

export const shouldStartPoolTimer = (pool: PoolState, match: Match): boolean => {
  const matchIndex = pool.matches.findIndex((candidate) => candidate.id === match.id);

  return pool.matchStartTimerMinutes > 0 && matchIndex >= 0 && matchIndex < pool.matches.length - 1;
};

export const hasStartedScoring = (pool: PoolState): boolean =>
  pool.matches.some(
    (match) =>
      match.final || match.games.some((game) => wholeNumber(game.scoreA) > 0 || wholeNumber(game.scoreB) > 0)
  );

export const formatScanProgress = (status: string, progress: number): string => {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  const percent = Math.round(progress * 100);

  return percent > 0 && percent < 100 ? `${label} ${percent}%` : label;
};
