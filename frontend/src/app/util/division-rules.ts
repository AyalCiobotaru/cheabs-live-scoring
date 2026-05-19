export const DIVISION_OPTIONS = ['Open', 'AA', 'A/AA', 'A', 'BB', 'B/BB', 'B'];

export const normalizeDivision = (value: unknown): string => {
  const division = typeof value === 'string' ? value.trim() : '';
  return DIVISION_OPTIONS.includes(division) ? division : DIVISION_OPTIONS[0];
};

export const divisionSortIndex = (division: string): number => {
  const index = DIVISION_OPTIONS.indexOf(division);
  return index >= 0 ? index : DIVISION_OPTIONS.length;
};
