import { EventState, PoolCard } from '../models';

export const favoritePoolCount = (cards: PoolCard[], favoritePoolIds: Set<string>): number =>
  cards.filter((card) => favoritePoolIds.has(card.pool.id)).length;

export const favoritePoolIdList = (favoritePoolIds: Set<string>): string[] => [...favoritePoolIds];

export const toggleFavoritePool = (
  event: EventState | null,
  favoritePoolIds: Set<string>,
  poolId: string
): Set<string> | null => {
  if (!event?.pools.some((pool) => pool.id === poolId)) {
    return null;
  }

  const next = new Set(favoritePoolIds);

  if (next.has(poolId)) {
    next.delete(poolId);
  } else {
    next.add(poolId);
  }

  return next;
};

export const removeFavoritePool = (favoritePoolIds: Set<string>, poolId: string): Set<string> | null => {
  if (!favoritePoolIds.has(poolId)) {
    return null;
  }

  const next = new Set(favoritePoolIds);
  next.delete(poolId);
  return next;
};

export const pruneFavoritePools = (event: EventState, favoritePoolIds: Set<string>): Set<string> => {
  const eventPoolIds = new Set(event.pools.map((pool) => pool.id));
  return new Set([...favoritePoolIds].filter((id) => eventPoolIds.has(id)));
};
