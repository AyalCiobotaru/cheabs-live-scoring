import { EventState, PoolState } from '../models';

export const eventWithoutImages = (event: EventState, isAdmin: boolean): EventState => {
  const pools = isAdmin ? event.pools : event.pools.filter((pool) => !pool.hidden);
  const activePoolId = pools.some((pool) => pool.id === event.activePoolId)
    ? event.activePoolId
    : (pools[0]?.id ?? null);

  return {
    ...event,
    activePoolId,
    pools: pools.map(poolWithoutImage)
  };
};

export const poolWithoutImage = (pool: PoolState): PoolState => ({
  ...pool,
  imagePreview: null
});
