import { CategoryPoolGroup, EventState, PoolCard, PoolState } from '../models';
import { normalizeDivision, normalizePoolCategory } from './division-rules';
import { categoryPoolGroupsFor } from './pool-card-groups';
import { buildPoolCard } from './standings-rules';

export const canViewPool = (pool: PoolState, isAdmin: boolean): boolean => isAdmin || !pool.hidden;

export const canScorePool = (pool: PoolState, isAdmin: boolean): boolean => isAdmin || pool.editable !== false;

export const poolCardsForEvent = (event: EventState | null, isAdmin: boolean): PoolCard[] =>
  event?.pools.filter((pool) => canViewPool(pool, isAdmin)).map((pool) => buildPoolCard(pool)) ?? [];

export const visiblePoolCardsFor = (
  poolCards: PoolCard[],
  showingFavoritePools: boolean,
  favoritePoolIds: Set<string>
): PoolCard[] =>
  showingFavoritePools ? poolCards.filter((card) => favoritePoolIds.has(card.pool.id)) : poolCards;

export const visibleCategoryPoolGroupsFor = (
  categoryGroups: CategoryPoolGroup[],
  showingFavoritePools: boolean,
  selectedCategory: string | null,
  selectedDivision: string | null
): CategoryPoolGroup[] => {
  if (showingFavoritePools || !selectedCategory) {
    return categoryGroups;
  }

  return categoryGroups
    .filter((group) => group.category === selectedCategory)
    .map((group) => ({
      ...group,
      divisions: selectedDivision
        ? group.divisions.filter((divisionGroup) => divisionGroup.division === selectedDivision)
        : group.divisions
    }))
    .filter((group) => group.divisions.length > 0);
};

export const poolCountForDivision = (event: EventState | null, category: string, division: string): number =>
  event?.pools.filter(
    (pool) => normalizePoolCategory(pool.category) === category && normalizeDivision(pool.division) === division
  ).length ?? 0;

export const divisionFilterOptionsFor = (
  groups: CategoryPoolGroup[]
): {
  category: string;
  cards: PoolCard[];
  divisions: { category: string; division: string; count: number }[];
}[] =>
  groups.map((group) => ({
    category: group.category,
    cards: group.cards,
    divisions: group.divisions.map((division) => ({
      category: division.category,
      division: division.division,
      count: division.cards.length
    }))
  }));

export const categoryGroupsForCards = categoryPoolGroupsFor;
