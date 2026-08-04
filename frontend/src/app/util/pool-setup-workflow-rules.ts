import { PoolState } from '../models';
import { normalizeDivision, normalizePoolCategory } from './division-rules';

export const existingPoolForDraft = (pools: PoolState[], draft: PoolState): PoolState | null =>
  pools.find((candidate) => candidate.id === draft.id) ?? null;

export const upsertPool = (pools: PoolState[], pool: PoolState): PoolState[] =>
  pools.some((candidate) => candidate.id === pool.id)
    ? pools.map((candidate) => (candidate.id === pool.id ? pool : candidate))
    : [...pools, pool];

export const poolsForCategoryDivision = (
  pools: PoolState[],
  selection: { category: string; division: string }
): PoolState[] => {
  const selectedCategory = normalizePoolCategory(selection.category);
  const selectedDivision = normalizeDivision(selection.division);

  return pools.filter(
    (pool) =>
      normalizePoolCategory(pool.category) === selectedCategory && normalizeDivision(pool.division) === selectedDivision
  );
};

export const hiddenPoolsForCategoryDivision = (
  pools: PoolState[],
  selection: { category: string; division: string }
): PoolState[] => poolsForCategoryDivision(pools, selection).filter((pool) => pool.hidden);

export const publishPool = (pool: PoolState): void => {
  pool.hidden = false;
  pool.updatedAt = new Date().toISOString();
};

export const normalizePoolSetupSelection = (selection: { category: string; division: string }): {
  category: string;
  division: string;
} => ({
  category: normalizePoolCategory(selection.category),
  division: normalizeDivision(selection.division)
});
