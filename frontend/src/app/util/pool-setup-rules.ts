import { GameScore, Match, PoolState } from '../models';
import { DIVISION_OPTIONS } from './division-rules';
import { SCHEDULE_PRESETS } from './schedule-presets';
import type { SchedulePreset } from './schedule-presets';
import { createId, seedOrNull } from './scoring-helpers';

export const TEAM_COUNT_OPTIONS = [3, 4, 5, 6, 7];

export const createDefaultPool = (title = 'Pool'): PoolState => ({
  id: createId(),
  title,
  category: 'Men',
  division: DIVISION_OPTIONS[0],
  hidden: true,
  editable: true,
  teamCount: 4,
  gamesPerMatch: 2,
  targetScore: defaultTargetScore(4),
  pointCap: defaultCap(4),
  matchStartTimerMinutes: 10,
  courtNumbers: [],
  nextMatchStartAt: null,
  nextMatchStartSourceMatchId: null,
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
  courtNumber: null,
  refSeed: seedOrNull(match.refSeed, teamCount),
  teamASeed: seedOrNull(match.teamASeed, teamCount),
  teamBSeed: seedOrNull(match.teamBSeed, teamCount),
  games: createGames(gamesPerMatch),
  final: false,
  updatedAt: new Date().toISOString()
});

export const createTemplateMatches = (teamCount: number, gamesPerMatch = 2, courtNumbers: number[] = []): Match[] => {
  const template = schedulePresetForTeamCount(teamCount)?.rows ?? [];

  return assignCourtNumbersToMatches(
    template.map((row) => ({
      id: createId(),
      courtNumber: null,
      refSeed: row.refSeed,
      teamASeed: row.teamASeed,
      teamBSeed: row.teamBSeed,
      games: createGames(gamesPerMatch),
      final: false,
      updatedAt: new Date().toISOString()
    })),
    courtNumbers
  );
};

export const createPresetMatches = (presetId: string, gamesPerMatch = 2, courtNumbers: number[] = []): Match[] => {
  const preset = SCHEDULE_PRESETS.find((candidate) => candidate.id === presetId);

  return assignCourtNumbersToMatches(
    (preset?.rows ?? []).map((row) => ({
      id: createId(),
      courtNumber: null,
      refSeed: row.refSeed,
      teamASeed: row.teamASeed,
      teamBSeed: row.teamBSeed,
      games: createGames(gamesPerMatch),
      final: false,
      updatedAt: new Date().toISOString()
    })),
    courtNumbers
  );
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

export const parseCourtNumbers = (value: string): number[] => {
  const numbers: number[] = [];
  const seen = new Set<number>();

  for (const segment of value.split(',')) {
    const trimmed = segment.trim();

    if (!trimmed) {
      continue;
    }

    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    const rangeStart = rangeMatch ? Number(rangeMatch[1]) : null;
    const rangeEnd = rangeMatch ? Number(rangeMatch[2]) : null;
    const values =
      rangeStart != null && rangeEnd != null
        ? Array.from(
            { length: Math.abs(rangeEnd - rangeStart) + 1 },
            (_, index) => Math.min(rangeStart, rangeEnd) + index
          )
        : /^\d+$/.test(trimmed)
          ? [Number(trimmed)]
          : [];

    for (const number of values) {
      if (number >= 1 && number <= 99 && !seen.has(number)) {
        seen.add(number);
        numbers.push(number);
      }
    }
  }

  return numbers;
};

export const courtNumbersText = (courtNumbers: number[]): string => courtNumbers.join(',');

export const assignCourtNumbersToMatches = (matches: Match[], courtNumbers: number[]): Match[] => {
  const normalizedCourtNumbers = courtNumbers.filter(
    (number) => Number.isInteger(number) && number >= 1 && number <= 99
  );

  return matches.map((match, index) => ({
    ...match,
    courtNumber: normalizedCourtNumbers.length ? normalizedCourtNumbers[index % normalizedCourtNumbers.length] : null
  }));
};
