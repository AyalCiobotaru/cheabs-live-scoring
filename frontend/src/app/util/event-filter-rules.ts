import { normalizeDivision, normalizePoolCategory } from './division-rules';

export interface EventDivisionFilter {
  category: string | null;
  division: string | null;
}

export const normalizeDivisionFilter = (
  selection: { category: string; division: string | null } | null
): EventDivisionFilter => ({
  category: selection ? normalizePoolCategory(selection.category) : null,
  division: selection?.division ? normalizeDivision(selection.division) : null
});

export const divisionFilterFromRoute = (category: string | null, division: string | null): EventDivisionFilter => {
  const normalizedCategory = category ? normalizePoolCategory(category) : null;
  const normalizedDivision = division ? normalizeDivision(division) : null;
  const routeCategory = normalizedCategory && normalizedCategory === category ? normalizedCategory : null;
  const routeDivision = normalizedDivision && normalizedDivision === division ? normalizedDivision : null;

  return {
    category: routeCategory,
    division: routeCategory ? routeDivision : null
  };
};
