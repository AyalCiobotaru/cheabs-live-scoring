import { PoolState, SeededPoolSource } from '../models';
import { normalizeDivision, normalizePoolCategory } from './division-rules';
import { createDefaultPool } from './pool-setup-rules';

export const clonePool = (pool: PoolState): PoolState => JSON.parse(JSON.stringify(pool)) as PoolState;

export const cloneSeededPoolSource = (source: SeededPoolSource): SeededPoolSource =>
  JSON.parse(JSON.stringify(source)) as SeededPoolSource;

export const createNewPoolDraft = (pools: PoolState[]): PoolState => createDefaultPool(nextPoolTitle(pools));

export const createSeededDivisionDraft = (
  pools: PoolState[],
  selection: { category: string; division: string }
): PoolState | null => {
  const selectedCategory = normalizePoolCategory(selection.category);
  const selectedDivision = normalizeDivision(selection.division);
  const sourcePool = pools.find(
    (pool) =>
      normalizePoolCategory(pool.category) === selectedCategory &&
      normalizeDivision(pool.division) === selectedDivision &&
      pool.seededPoolSource
  );
  const source = sourcePool?.seededPoolSource;

  if (!source) {
    return null;
  }

  const draft = createDefaultPool(`${selectedCategory} ${selectedDivision}`);
  draft.category = selectedCategory;
  draft.division = selectedDivision;
  draft.hidden = source.hidden;
  draft.editable = source.editable;
  draft.matchStartTimerMinutes = source.matchStartTimerMinutes;
  draft.courtNumbers = [...source.courtNumbers];
  draft.seededPoolSource = cloneSeededPoolSource(source);

  return draft;
};

export const nextPoolTitle = (pools: PoolState[]): string => uniquePoolTitle(pools, `Pool ${pools.length + 1}`);

export const uniquePoolTitle = (pools: PoolState[], title: string, currentPoolId: string | null = null): string => {
  const otherPools = pools.filter((pool) => pool.id !== currentPoolId);

  if (!otherPools.some((pool) => pool.title.toLowerCase() === title.toLowerCase())) {
    return title;
  }

  for (let index = 2; index < 100; index += 1) {
    const candidate = `${title} ${index}`;

    if (!otherPools.some((pool) => pool.title.toLowerCase() === candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${title} ${Date.now().toString(36)}`;
};
