import { EventState, Match, PoolState } from '../models';

export const mergeEvents = (local: EventState, remote: EventState, isAdmin: boolean): EventState => {
  const pools = new Map<string, PoolState>();

  for (const pool of local.pools) {
    pools.set(pool.id, pool);
  }

  for (const remotePool of remote.pools) {
    const localPool = pools.get(remotePool.id);

    if (!localPool) {
      pools.set(remotePool.id, remotePool);
    } else if (isNewer(remotePool.updatedAt, localPool.updatedAt)) {
      pools.set(remotePool.id, mergePoolMatches(localPool, remotePool));
    }
  }

  const mergedPools = isAdmin ? [...pools.values()] : [...pools.values()].filter((pool) => !pool.hidden);
  const activePoolId = mergedPools.some((pool) => pool.id === local.activePoolId)
    ? local.activePoolId
    : (remote.activePoolId ?? mergedPools[0]?.id ?? null);

  return {
    ...local,
    name: remote.name || local.name,
    pools: mergedPools,
    activePoolId: mergedPools.some((pool) => pool.id === activePoolId) ? activePoolId : (mergedPools[0]?.id ?? null),
    updatedAt: isNewer(remote.updatedAt, local.updatedAt) ? remote.updatedAt : local.updatedAt
  };
};

const mergePoolMatches = (local: PoolState, remote: PoolState): PoolState => {
  const matches = new Map<string, Match>();

  for (const match of local.matches) {
    matches.set(match.id, match);
  }

  for (const remoteMatch of remote.matches) {
    const localMatch = matches.get(remoteMatch.id);

    if (!localMatch || isNewer(remoteMatch.updatedAt, localMatch.updatedAt)) {
      matches.set(remoteMatch.id, remoteMatch);
    }
  }

  return {
    ...remote,
    matches: remote.matches.map((match) => matches.get(match.id) ?? match)
  };
};

export const isNewer = (left: string | null, right: string | null): boolean =>
  Date.parse(left ?? '') > Date.parse(right ?? '');
