import { PoolState, ScanSummary, SheetScanResult } from '../models';
import { createScannedMatch, createTemplateMatches, defaultCap, defaultTargetScore } from '../util/pool-setup-rules';
import { clampWholeNumber, seedOrNull, wholeNumber } from '../util/scoring-helpers';

export const applySheetScanToPool = (pool: PoolState, scan: SheetScanResult, title: string): PoolState => {
  const teamCount = sheetTeamCount(pool, scan);
  const scannedTeams = new Map(scan.teams.map((team) => [wholeNumber(team.seed), team.name?.trim() || null]));
  const gamesPerMatch = clampWholeNumber(scan.gamesPerMatch ?? pool.gamesPerMatch, 1, 5);

  const targetScore = scan.targetScore == null ? defaultTargetScore(teamCount) : clampWholeNumber(scan.targetScore, 1, 99);

  return {
    ...pool,
    title,
    teamCount,
    gamesPerMatch,
    targetScore,
    pointCap: scan.targetScore == null ? pool.pointCap : defaultCap(teamCount),
    teams: Array.from({ length: teamCount }, (_, index) => {
      const seed = index + 1;
      return {
        seed,
        name: scannedTeams.get(seed) || pool.teams.find((team) => team.seed === seed)?.name || `Team ${seed}`
      };
    }),
    matches: scan.matches.length
      ? scan.matches.map((match) => createScannedMatch(match, teamCount, gamesPerMatch))
      : createTemplateMatches(teamCount, gamesPerMatch)
  };
};

export const buildScanSummary = (pool: PoolState, scan: SheetScanResult): ScanSummary => {
  const teamCount = sheetTeamCount(pool, scan);
  const namedTeams = scan.teams.filter((team) => team.name?.trim()).length;
  const completeMatches = scan.matches.filter(
    (match) =>
      seedOrNull(match.refSeed, teamCount) != null &&
      seedOrNull(match.teamASeed, teamCount) != null &&
      seedOrNull(match.teamBSeed, teamCount) != null
  ).length;
  const defaultScheduleUsed =
    scan.matches.length === 0 && createTemplateMatches(teamCount, pool.gamesPerMatch).length > 0;
  const targetScore = scan.targetScore ?? defaultTargetScore(teamCount);
  const gamesPerMatch = scan.gamesPerMatch ?? pool.gamesPerMatch;

  return {
    read: [
      scan.title?.trim() ? `Title: ${scan.title.trim()}` : '',
      scan.teamCount != null ? `Team count: ${scan.teamCount}` : '',
      scan.gamesPerMatch != null && scan.targetScore != null
        ? `Format: ${scan.gamesPerMatch} games to ${scan.targetScore}`
        : '',
      namedTeams > 0 ? `Team names: ${namedTeams} of ${teamCount}` : '',
      completeMatches > 0 ? `Schedule rows: ${completeMatches}` : ''
    ].filter(Boolean),
    assumed: [
      scan.teamCount == null ? `Team count assumed from OCR context: ${teamCount}` : '',
      scan.gamesPerMatch == null || scan.targetScore == null
        ? `Format assumed: ${gamesPerMatch} games to ${targetScore}`
        : '',
      defaultScheduleUsed ? `Schedule assumed from the ${teamCount}-team default order` : '',
      ...scan.notes.filter((note) => !/review handwritten team names/i.test(note))
    ].filter(Boolean),
    manual: [
      namedTeams < teamCount
        ? `Fill or verify ${teamCount - namedTeams} team name${teamCount - namedTeams === 1 ? '' : 's'}`
        : 'Verify handwritten team names',
      completeMatches < pool.matches.length ? 'Review the match order and Work Team values' : '',
      'Confirm games per match and target score before scoring'
    ].filter(Boolean)
  };
};

const sheetTeamCount = (pool: PoolState, scan: SheetScanResult): number => {
  const maxSeed = Math.max(
    0,
    ...scan.teams.map((team) => wholeNumber(team.seed)),
    ...scan.matches.flatMap((match) => [
      wholeNumber(match.refSeed),
      wholeNumber(match.teamASeed),
      wholeNumber(match.teamBSeed)
    ])
  );

  return clampWholeNumber(scan.teamCount ?? (maxSeed || pool.teamCount), 3, 7);
};
