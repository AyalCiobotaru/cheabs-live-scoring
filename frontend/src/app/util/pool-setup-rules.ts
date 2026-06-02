import { GameScore, Match, PoolState } from '../models';
import { DIVISION_OPTIONS } from './division-rules';
import { SCHEDULE_PRESETS } from './schedule-presets';
import type { SchedulePreset } from './schedule-presets';
import { createId, seedOrNull } from './scoring-helpers';

export const TEAM_COUNT_OPTIONS = [3, 4, 5, 6, 7];

export const createDefaultPool = (title = 'Pool'): PoolState => ({
  id: createId(),
  title,
  division: DIVISION_OPTIONS[0],
  teamCount: 4,
  gamesPerMatch: 2,
  targetScore: defaultTargetScore(4),
  pointCap: defaultCap(4),
  teams: [1, 2, 3, 4].map((seed) => ({ seed, name: `Team ${seed}` })),
  matches: createTemplateMatches(4, 2),
  imagePreview: null,
  updatedAt: new Date().toISOString()
});

export const createScannedMatch = (
  match: { refSeed: number | null; teamASeed: number | null; teamBSeed: number | null },
  teamCount: number,
  gamesPerMatch: number
): Match => ({
  id: createId(),
  refSeed: seedOrNull(match.refSeed, teamCount),
  teamASeed: seedOrNull(match.teamASeed, teamCount),
  teamBSeed: seedOrNull(match.teamBSeed, teamCount),
  games: createGames(gamesPerMatch),
  final: false,
  updatedAt: new Date().toISOString()
});

export const createTemplateMatches = (teamCount: number, gamesPerMatch = 2): Match[] => {
  const template = schedulePresetForTeamCount(teamCount)?.rows ?? [];

  return template.map((row) => ({
    id: createId(),
    refSeed: row.refSeed,
    teamASeed: row.teamASeed,
    teamBSeed: row.teamBSeed,
    games: createGames(gamesPerMatch),
    final: false,
    updatedAt: new Date().toISOString()
  }));
};

export const createPresetMatches = (presetId: string, gamesPerMatch = 2): Match[] => {
  const preset = SCHEDULE_PRESETS.find((candidate) => candidate.id === presetId);

  return (preset?.rows ?? []).map((row) => ({
    id: createId(),
    refSeed: row.refSeed,
    teamASeed: row.teamASeed,
    teamBSeed: row.teamBSeed,
    games: createGames(gamesPerMatch),
    final: false,
    updatedAt: new Date().toISOString()
  }));
};

export const schedulePresetForTeamCount = (teamCount: number): SchedulePreset | null =>
  SCHEDULE_PRESETS.find((preset) => preset.teamCount === teamCount) ?? null;

export const createGames = (gamesPerMatch = 2): GameScore[] =>
  Array.from({ length: gamesPerMatch }, () => ({
    scoreA: 0,
    scoreB: 0,
    final: false
  }));

export const defaultTargetScore = (teamCount: number): number => (teamCount === 4 ? 15 : 11);
export const defaultCap = (teamCount: number): number => (defaultTargetScore(teamCount) === 11 ? 13 : 17);
