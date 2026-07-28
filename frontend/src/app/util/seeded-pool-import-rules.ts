import { PoolState, SeededImportFormats, SeededImportPreview, Team } from '../models';
import { createPresetMatches, createTemplateMatches } from './pool-setup-rules';
import { createId } from './scoring-helpers';

interface ParsedSeededTeam extends Team {
  lineNumber: number;
  normalizedName: string;
}

export const DEFAULT_SEEDED_IMPORT_FORMATS: SeededImportFormats = {
  4: { gamesPerMatch: 2, targetScore: 15, pointCap: 17, schedulePresetId: '' },
  5: { gamesPerMatch: 2, targetScore: 11, pointCap: 13, schedulePresetId: '' },
  6: { gamesPerMatch: 1, targetScore: 15, pointCap: 17, schedulePresetId: '' },
  7: { gamesPerMatch: 1, targetScore: 15, pointCap: 17, schedulePresetId: '' }
};

export const buildSeededImportPreview = (
  fileText: string,
  category: string,
  division: string,
  formats: SeededImportFormats,
  startingPoolNumber: number,
  matchStartTimerMinutes: number,
  courtNumbers: number[],
  hidden: boolean,
  editable: boolean,
  prioritizeFiveTeamPools = false
): SeededImportPreview => {
  const { teams, errors, warnings } = parseSeededTeams(fileText);
  const sortedTeams = [...teams].sort((left, right) => left.seed - right.seed);
  const pools =
    errors.length === 0
      ? buildSeededPools(
          sortedTeams,
          category,
          division,
          formats,
          startingPoolNumber,
          matchStartTimerMinutes,
          courtNumbers,
          hidden,
          editable,
          prioritizeFiveTeamPools
        )
      : [];

  return {
    teams: sortedTeams.map(({ seed, name, lineNumber }) => ({ seed, name, lineNumber })),
    pools,
    errors,
    warnings
  };
};

export const buildSeededPools = (
  seededTeams: Team[],
  category: string,
  division: string,
  formats: SeededImportFormats,
  startingPoolNumber: number,
  matchStartTimerMinutes: number,
  courtNumbers: number[],
  hidden: boolean,
  editable: boolean,
  prioritizeFiveTeamPools = false
): PoolState[] => {
  const teamsBySeed = new Map(seededTeams.map((team) => [team.seed, team]));
  const pools = seedPoolsForCount(seededTeams.length, prioritizeFiveTeamPools);
  const normalizedMatchStartTimerMinutes = wholeNumber(matchStartTimerMinutes, 0, 99, 10);

  return pools.map((seeds, index) => {
    const teamCount = seeds.length as 4 | 5 | 6 | 7;
    const format = normalizeFormat(formats[teamCount]);
    const poolCourtNumbers = courtNumbers.length ? [courtNumbers[index % courtNumbers.length]] : [];

    return {
      id: createId(),
      title: `Pool ${startingPoolNumber + index}`,
      category,
      division,
      hidden,
      editable,
      teamCount,
      gamesPerMatch: format.gamesPerMatch,
      targetScore: format.targetScore,
      pointCap: format.pointCap,
      matchStartTimerMinutes: normalizedMatchStartTimerMinutes,
      courtNumbers: poolCourtNumbers,
      nextMatchStartAt: null,
      nextMatchStartSourceMatchId: null,
      teams: seeds.map((sourceSeed, teamIndex) => ({
        seed: teamIndex + 1,
        name: teamsBySeed.get(sourceSeed)?.name ?? `Team ${sourceSeed}`
      })),
      matches: format.schedulePresetId
        ? createPresetMatches(format.schedulePresetId, format.gamesPerMatch, poolCourtNumbers)
        : createTemplateMatches(teamCount, format.gamesPerMatch, poolCourtNumbers),
      imagePreview: null,
      updatedAt: new Date().toISOString()
    };
  });
};

const normalizeFormat = (format: {
  gamesPerMatch: unknown;
  targetScore: unknown;
  pointCap: unknown;
  schedulePresetId?: unknown;
}) => {
  const gamesPerMatch = wholeNumber(format.gamesPerMatch, 1, 5, 2);
  const targetScore = wholeNumber(format.targetScore, 1, 99, 11);
  const pointCap =
    format.pointCap === '' || format.pointCap == null
      ? null
      : Math.max(targetScore, wholeNumber(format.pointCap, 1, 99, targetScore));
  const schedulePresetId = typeof format.schedulePresetId === 'string' ? format.schedulePresetId : '';

  return { gamesPerMatch, targetScore, pointCap, schedulePresetId };
};

const wholeNumber = (value: unknown, min: number, max: number, fallback: number): number => {
  const number = Number(value);
  return Number.isInteger(number) && number >= min ? Math.min(max, number) : fallback;
};

const parseSeededTeams = (
  fileText: string
): { teams: ParsedSeededTeam[]; errors: SeededImportPreview['errors']; warnings: SeededImportPreview['warnings'] } => {
  const errors: SeededImportPreview['errors'] = [];
  const warnings: SeededImportPreview['warnings'] = [];
  const lines = fileText
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n');
  const teams: ParsedSeededTeam[] = [];
  const seenSeeds = new Set<number>();
  const seenNames = new Set<string>();
  let inferredSeed = 1;

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;

    if (!line.trim()) {
      continue;
    }

    const cells = parseCsvLine(line).map((cell) => cell.trim());

    if (
      teams.length === 0 &&
      cells.length >= 2 &&
      cells[0].toLowerCase() === 'seed' &&
      cells[1].toLowerCase() === 'team_name'
    ) {
      continue;
    }

    const seeded = cells.length >= 2 && /^\d+$/.test(cells[0]);
    const seed = seeded ? Number(cells[0]) : inferredSeed;
    const name = seeded ? cells[1] : cells[0];

    if (!name) {
      errors.push({ lineNumber, message: 'Missing team_name.' });
      continue;
    }

    if (seenSeeds.has(seed)) {
      errors.push({ lineNumber, message: `Duplicate seed ${seed}.` });
    }

    const normalizedName = name.replace(/\s+/g, ' ').trim().toLowerCase();

    if (seenNames.has(normalizedName)) {
      warnings.push({ lineNumber, message: `Duplicate team_name "${name}".` });
    }

    seenSeeds.add(seed);
    seenNames.add(normalizedName);
    teams.push({ seed, name, lineNumber, normalizedName });
    inferredSeed += 1;
  }

  if (teams.length === 0) {
    errors.push({ lineNumber: null, message: 'No teams found.' });
  }

  if (teams.length > 0 && teams.length < 6) {
    errors.push({ lineNumber: null, message: 'Seeded import requires at least 6 teams.' });
  }

  for (let seed = 1; seed <= teams.length; seed += 1) {
    if (!seenSeeds.has(seed)) {
      errors.push({ lineNumber: null, message: `Missing seed ${seed}.` });
    }
  }

  return { teams, errors, warnings };
};

const seedPoolsForCount = (teamCount: number, prioritizeFiveTeamPools: boolean): number[][] => {
  if (prioritizeFiveTeamPools) {
    const prioritizedPools = seedFiveTeamPoolsFirst(teamCount);

    if (prioritizedPools.length) {
      return prioritizedPools;
    }
  }

  if (teamCount === 6 || teamCount === 7) {
    return [Array.from({ length: teamCount }, (_, index) => index + 1)];
  }

  if (teamCount === 11) {
    return [
      [1, 4, 5, 8],
      [2, 3, 6, 7, 9, 10, 11]
    ];
  }

  const remainder = teamCount % 4;
  const baseCount = teamCount - remainder;
  const poolCount = baseCount / 4;
  const pools = Array.from({ length: poolCount }, () => [] as number[]);

  for (let seed = 1; seed <= baseCount; seed += 1) {
    const round = Math.floor((seed - 1) / poolCount);
    const indexInRound = (seed - 1) % poolCount;
    const poolIndex = round % 2 === 0 ? indexInRound : poolCount - 1 - indexInRound;
    pools[poolIndex].push(seed);
  }

  for (let offset = 0; offset < remainder; offset += 1) {
    pools[poolCount - 1 - offset].push(baseCount + offset + 1);
  }

  return pools;
};

const seedFiveTeamPoolsFirst = (teamCount: number): number[][] => {
  const poolSizes = fiveTeamPoolSizesForCount(teamCount);

  return poolSizes.length ? snakeSeedsIntoPoolSizes(poolSizes) : [];
};

const fiveTeamPoolSizesForCount = (teamCount: number): number[] => {
  for (let fiveTeamPools = Math.floor(teamCount / 5); fiveTeamPools >= 0; fiveTeamPools -= 1) {
    const remainingTeams = teamCount - fiveTeamPools * 5;

    if (remainingTeams % 4 === 0) {
      return [
        ...Array.from({ length: fiveTeamPools }, () => 5),
        ...Array.from({ length: remainingTeams / 4 }, () => 4)
      ];
    }
  }

  return [];
};

const snakeSeedsIntoPoolSizes = (poolSizes: number[]): number[][] => {
  const pools = poolSizes.map(() => [] as number[]);
  let seed = 1;
  let forward = true;

  while (pools.some((pool, index) => pool.length < poolSizes[index])) {
    const indexes = pools.map((_, index) => index);

    if (!forward) {
      indexes.reverse();
    }

    for (const poolIndex of indexes) {
      if (pools[poolIndex].length < poolSizes[poolIndex]) {
        pools[poolIndex].push(seed);
        seed += 1;
      }
    }

    forward = !forward;
  }

  return pools;
};

const parseCsvLine = (line: string): string[] => {
  const cells: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    const next = line[index + 1];

    if (quoted && character === '"' && next === '"') {
      cell += '"';
      index += 1;
      continue;
    }

    if (character === '"') {
      quoted = !quoted;
      continue;
    }

    if (!quoted && character === ',') {
      cells.push(cell);
      cell = '';
      continue;
    }

    cell += character;
  }

  cells.push(cell);
  return cells;
};
