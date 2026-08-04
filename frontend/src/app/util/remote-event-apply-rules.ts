import { EventState, Match, PoolState, PoolTimerUpdate } from '../models';
import { normalizeMatchState, normalizePoolState } from './scoring-event-normalizers';
import { isNewer } from './scoring-event-merge';
import { touchPool } from './pool-runtime-rules';

export const applyRemotePoolSetupToEvent = (event: EventState, remote: PoolState, isAdmin: boolean): boolean => {
  const pool = normalizePoolState(remote);
  const existingIndex = event.pools.findIndex((candidate) => candidate.id === pool.id);

  if (pool.hidden && !isAdmin) {
    if (existingIndex >= 0) {
      event.pools = event.pools.filter((candidate) => candidate.id !== pool.id);
      event.activePoolId = event.activePoolId === pool.id ? (event.pools[0]?.id ?? null) : event.activePoolId;
      return true;
    }

    return false;
  }

  if (existingIndex >= 0) {
    event.pools = event.pools.map((candidate) => (candidate.id === pool.id ? pool : candidate));
  } else {
    event.pools = [...event.pools, pool];
  }

  return true;
};

export const applyRemoteMatchToEvent = (event: EventState, poolId: string, remote: Match): boolean => {
  const pool = event.pools.find((candidate) => candidate.id === poolId);

  if (!pool) {
    return false;
  }

  const match = normalizeMatchState(remote, pool.gamesPerMatch, pool.pointCap, pool.teamCount);
  const existingIndex = pool.matches.findIndex((candidate) => candidate.id === match.id);

  if (existingIndex >= 0 && !isNewer(match.updatedAt, pool.matches[existingIndex].updatedAt)) {
    return false;
  }

  if (existingIndex >= 0) {
    pool.matches = pool.matches.map((candidate) => (candidate.id === match.id ? match : candidate));
  } else {
    pool.matches = [...pool.matches, match];
  }

  pool.updatedAt = match.updatedAt;
  return true;
};

export const applyRemotePoolDeletedToEvent = (
  event: EventState,
  poolId: string,
  activePoolId: string | null
): { changed: boolean; deletedActivePool: boolean } => {
  if (!event.pools.some((pool) => pool.id === poolId)) {
    return { changed: false, deletedActivePool: false };
  }

  const deletedActivePool = activePoolId === poolId;
  event.pools = event.pools.filter((pool) => pool.id !== poolId);
  event.activePoolId = event.activePoolId === poolId ? (event.pools[0]?.id ?? null) : event.activePoolId;

  return { changed: true, deletedActivePool };
};

export const applyRemotePoolTimerToEvent = (
  event: EventState,
  poolId: string,
  timer: PoolTimerUpdate
): boolean => {
  const pool = event.pools.find((candidate) => candidate.id === poolId);

  if (!pool) {
    return false;
  }

  pool.nextMatchStartAt = typeof timer.nextMatchStartAt === 'string' ? timer.nextMatchStartAt : null;
  pool.nextMatchStartSourceMatchId =
    pool.nextMatchStartAt && typeof timer.nextMatchStartSourceMatchId === 'string'
      ? timer.nextMatchStartSourceMatchId
      : null;
  touchPool(pool);
  return true;
};
