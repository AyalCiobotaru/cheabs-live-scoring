export const DIVISION_OPTIONS = ['Open', 'AA', 'A/AA', 'A', 'BB', 'B/BB', 'B'];
export const POOL_CATEGORY_OPTIONS = ['Women', 'Men', 'Coed', 'RevCo'] as const;

export type PoolCategory = (typeof POOL_CATEGORY_OPTIONS)[number];

export const normalizeDivision = (value: unknown): string => {
  const division = typeof value === 'string' ? value.trim() : '';
  return DIVISION_OPTIONS.includes(division) ? division : DIVISION_OPTIONS[0];
};

export const divisionSortIndex = (division: string): number => {
  const index = DIVISION_OPTIONS.indexOf(division);
  return index >= 0 ? index : DIVISION_OPTIONS.length;
};

export const normalizePoolCategory = (value: unknown): PoolCategory => {
  const category = typeof value === 'string' ? value.trim() : '';
  return POOL_CATEGORY_OPTIONS.includes(category as PoolCategory) ? (category as PoolCategory) : 'Men';
};

export const poolCategorySortIndex = (category: string): number => {
  const index = POOL_CATEGORY_OPTIONS.indexOf(normalizePoolCategory(category));
  return index >= 0 ? index : POOL_CATEGORY_OPTIONS.length;
};
