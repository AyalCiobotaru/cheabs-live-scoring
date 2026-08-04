import { Match, PoolState } from '../models';
import {
  createGames,
  createPresetMatches,
  createTemplateMatches,
  defaultCap,
  defaultTargetScore
} from './pool-setup-rules';
import { capGameScore } from './scoring-event-normalizers';
import { clampWholeNumber, createId, resizeGamesForCount } from './scoring-helpers';

export const applyTeamCountToPool = (pool: PoolState, value: number): void => {
  const count = clampWholeNumber(value, 3, 7);

  pool.teamCount = count;
  pool.teams = Array.from({ length: count }, (_, index) => {
    const seed = index + 1;
    return pool.teams.find((team) => team.seed === seed) ?? { seed, name: `Team ${seed}` };
  });
  pool.matches = createTemplateMatches(count, pool.gamesPerMatch, pool.courtNumbers);
  pool.targetScore = defaultTargetScore(count);
  pool.pointCap = defaultCap(count);
};

export const applyGameFormatToPool = (pool: PoolState): void => {
  pool.gamesPerMatch = clampWholeNumber(pool.gamesPerMatch, 1, 5);
  pool.targetScore = clampWholeNumber(pool.targetScore, 1, 99);
  pool.pointCap = pool.pointCap == null ? null : Math.max(pool.targetScore, clampWholeNumber(pool.pointCap, 1, 99));
  pool.matches = pool.matches.map((match) => ({
    ...match,
    games: resizeGamesForCount(match.games, pool.gamesPerMatch).map((game) => capGameScore(game, pool.pointCap))
  }));
};

export const addMatchToPool = (pool: PoolState): void => {
  const match: Match = {
    id: createId(),
    courtNumber: pool.courtNumbers.length ? pool.courtNumbers[pool.matches.length % pool.courtNumbers.length] : null,
    refSeed: pool.teams[2]?.seed ?? null,
    teamASeed: pool.teams[0]?.seed ?? null,
    teamBSeed: pool.teams[1]?.seed ?? null,
    games: createGames(pool.gamesPerMatch),
    final: false,
    updatedAt: new Date().toISOString()
  };

  pool.matches.push(match);
};

export const applySchedulePresetToPool = (pool: PoolState, presetId: string): void => {
  pool.matches = createPresetMatches(presetId, pool.gamesPerMatch, pool.courtNumbers);
};

export const removeMatchFromPool = (pool: PoolState, matchId: string): void => {
  pool.matches = pool.matches.filter((match) => match.id !== matchId);
};

export const moveMatchInPool = (pool: PoolState, matchId: string, direction: -1 | 1): boolean => {
  const index = pool.matches.findIndex((match) => match.id === matchId);
  const nextIndex = index + direction;

  if (index < 0 || nextIndex < 0 || nextIndex >= pool.matches.length) {
    return false;
  }

  const matches = [...pool.matches];
  const [match] = matches.splice(index, 1);
  matches.splice(nextIndex, 0, match);
  pool.matches = matches;
  return true;
};
