import { EventState, GameScore, Match, PoolState, SeededPoolSource } from '../models';
import { normalizeDivision, normalizePoolCategory } from './division-rules';
import { createDefaultPool, defaultCap, defaultTargetScore, parseCourtNumbers } from './pool-setup-rules';
import { clampWholeNumber, createId, resizeGamesForCount, seedOrNull } from './scoring-helpers';

export const normalizeEventCode = (value: string): string =>
  String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

export const normalizeEventState = (event: EventState, isAdmin: boolean): EventState => {
  const normalizedPools = Array.isArray(event.pools) ? event.pools.map(normalizePoolState) : [];
  const pools = isAdmin ? normalizedPools : normalizedPools.filter((pool) => !pool.hidden);
  const activePoolId =
    typeof event.activePoolId === 'string' && pools.some((pool) => pool.id === event.activePoolId)
      ? event.activePoolId
      : (pools[0]?.id ?? null);

  return {
    code: normalizeEventCode(event.code),
    name: typeof event.name === 'string' && event.name.trim() ? event.name.trim() : event.code,
    pools,
    activePoolId,
    updatedAt: typeof event.updatedAt === 'string' ? event.updatedAt : null
  };
};

export const normalizePoolState = (pool: PoolState): PoolState => {
  const baseline = createDefaultPool();
  const teamCount = clampWholeNumber(pool.teamCount, 3, 7);
  const gamesPerMatch = clampWholeNumber(pool.gamesPerMatch, 1, 5);
  const targetScore =
    pool.targetScore == null ? defaultTargetScore(teamCount) : clampWholeNumber(pool.targetScore, 1, 99);
  const pointCap = pool.pointCap == null ? null : Math.max(targetScore, clampWholeNumber(pool.pointCap, 1, 99));
  const matchStartTimerMinutes = clampWholeNumber(pool.matchStartTimerMinutes ?? 10, 0, 99);
  const courtNumbers = Array.isArray(pool.courtNumbers) ? parseCourtNumbers(pool.courtNumbers.join(',')) : [];
  const nextMatchStartAt =
    matchStartTimerMinutes > 0 && typeof pool.nextMatchStartAt === 'string' ? pool.nextMatchStartAt : null;
  const nextMatchStartSourceMatchId =
    nextMatchStartAt && typeof pool.nextMatchStartSourceMatchId === 'string'
      ? pool.nextMatchStartSourceMatchId
      : null;
  const sourceTeams = Array.isArray(pool.teams) ? pool.teams : [];
  const teams = Array.from({ length: teamCount }, (_, index) => {
    const seed = index + 1;
    const team = sourceTeams.find((candidate) => candidate.seed === seed);

    return {
      seed,
      name: typeof team?.name === 'string' && team.name.trim() ? team.name : `Team ${seed}`,
      seededSourceSeed: seededSourceSeedOrNull(team?.seededSourceSeed)
    };
  });

  return {
    id: typeof pool.id === 'string' && pool.id.trim() ? pool.id : baseline.id,
    title: typeof pool.title === 'string' && pool.title.trim() ? pool.title : baseline.title,
    category: normalizePoolCategory(pool.category),
    division: normalizeDivision(pool.division),
    hidden: Boolean(pool.hidden),
    editable: pool.editable !== false,
    teamCount,
    gamesPerMatch,
    targetScore,
    pointCap,
    matchStartTimerMinutes,
    courtNumbers,
    nextMatchStartAt,
    nextMatchStartSourceMatchId,
    teams,
    matches: Array.isArray(pool.matches)
      ? pool.matches.map((match) => normalizeMatchState(match, gamesPerMatch, pointCap, teamCount))
      : [],
    seededPoolSource: normalizeSeededPoolSource(pool.seededPoolSource),
    imagePreview: typeof pool.imagePreview === 'string' ? pool.imagePreview : null,
    updatedAt: typeof pool.updatedAt === 'string' ? pool.updatedAt : null
  };
};

export const normalizeMatchState = (
  match: Match,
  gamesPerMatch: number,
  pointCap: number | null = 99,
  teamCount = 7
): Match => ({
  ...match,
  id: typeof match.id === 'string' && match.id.trim() ? match.id : createId(),
  courtNumber: clampNullableWholeNumber(match.courtNumber, 1, 99),
  refSeed: seedOrNull(match.refSeed, teamCount),
  teamASeed: seedOrNull(match.teamASeed, teamCount),
  teamBSeed: seedOrNull(match.teamBSeed, teamCount),
  games: resizeGamesForCount(match.games ?? [], gamesPerMatch).map((game) => capGameScore(game, pointCap)),
  final: Boolean(match.final),
  updatedAt: typeof match.updatedAt === 'string' ? match.updatedAt : null
});

export const capGameScore = (game: GameScore, pointCap: number | null): GameScore => {
  const cap = pointCap == null ? 99 : clampWholeNumber(pointCap, 1, 99);
  game.scoreA = clampWholeNumber(game.scoreA, 0, cap);
  game.scoreB = clampWholeNumber(game.scoreB, 0, cap);
  game.final = Boolean(game.final);
  return game;
};

const normalizeSeededPoolSource = (source: SeededPoolSource | null | undefined): SeededPoolSource | null => {
  if (!source || source.kind !== 'seeded-import') {
    return null;
  }

  const teams = Array.isArray(source.teams)
    ? source.teams
        .map((team) => ({
          seed: clampWholeNumber(team.seed, 1, 999),
          name: typeof team.name === 'string' ? team.name.trim() : ''
        }))
        .filter((team) => team.name)
        .sort((left, right) => left.seed - right.seed)
    : [];

  if (!teams.length) {
    return null;
  }

  const formats: SeededPoolSource['formats'] = {};

  for (const size of ['4', '5', '6', '7']) {
    const format = source.formats?.[size] ?? {
      gamesPerMatch: 2,
      targetScore: defaultTargetScore(Number(size)),
      pointCap: defaultCap(Number(size)),
      schedulePresetId: ''
    };
    const targetScore = clampWholeNumber(format.targetScore, 1, 99);

    formats[size] = {
      gamesPerMatch: clampWholeNumber(format.gamesPerMatch, 1, 5),
      targetScore,
      pointCap: format.pointCap == null ? null : Math.max(targetScore, clampWholeNumber(format.pointCap, 1, 99)),
      schedulePresetId: typeof format.schedulePresetId === 'string' ? format.schedulePresetId : ''
    };
  }

  const now = new Date().toISOString();

  return {
    kind: 'seeded-import',
    category: normalizePoolCategory(source.category),
    division: normalizeDivision(source.division),
    teams,
    formats,
    prioritizeFiveTeamPools: Boolean(source.prioritizeFiveTeamPools),
    matchStartTimerMinutes: clampWholeNumber(source.matchStartTimerMinutes, 0, 99),
    courtNumbers: Array.isArray(source.courtNumbers) ? parseCourtNumbers(source.courtNumbers.join(',')) : [],
    hidden: Boolean(source.hidden),
    editable: source.editable !== false,
    createdAt: typeof source.createdAt === 'string' ? source.createdAt : now,
    updatedAt: typeof source.updatedAt === 'string' ? source.updatedAt : now
  };
};

const seededSourceSeedOrNull = (value: unknown): number | null => {
  const number = Number(value);

  return Number.isInteger(number) && number >= 1 && number <= 999 ? number : null;
};

const clampNullableWholeNumber = (value: unknown, min: number, max: number): number | null => {
  const number = Number(value);

  return Number.isInteger(number) && number >= min && number <= max ? number : null;
};
