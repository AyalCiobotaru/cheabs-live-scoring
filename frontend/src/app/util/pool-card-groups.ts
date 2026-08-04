import { CategoryPoolGroup, PoolCard } from '../models';
import { divisionSortIndex, normalizeDivision, normalizePoolCategory, poolCategorySortIndex } from './division-rules';

export const categoryPoolGroupsFor = (cards: PoolCard[]): CategoryPoolGroup[] => {
  const groups = new Map<string, Map<string, PoolCard[]>>();

  for (const card of cards) {
    const category = normalizePoolCategory(card.pool.category);
    const division = normalizeDivision(card.pool.division);
    const divisionGroups = groups.get(category) ?? new Map<string, PoolCard[]>();
    divisionGroups.set(division, [...(divisionGroups.get(division) ?? []), card]);
    groups.set(category, divisionGroups);
  }

  return [...groups.entries()]
    .sort(([left], [right]) => poolCategorySortIndex(left) - poolCategorySortIndex(right) || left.localeCompare(right))
    .map(([category, divisionMap]) => {
      const divisions = [...divisionMap.entries()]
        .sort(([left], [right]) => divisionSortIndex(left) - divisionSortIndex(right) || left.localeCompare(right))
        .map(([division, divisionCards]) => ({ category, division, cards: divisionCards }));

      return {
        category,
        divisions,
        cards: divisions.flatMap((division) => division.cards)
      };
    });
};
