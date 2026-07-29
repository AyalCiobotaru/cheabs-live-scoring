import { CsvImportIssue, CsvImportPreview, CsvImportRow } from '../models';
import { DIVISION_OPTIONS } from './division-rules';
import { createTemplateMatches, defaultTargetScore } from './pool-setup-rules';

export const CSV_IMPORT_HEADERS = [
  'event_code',
  'event_name',
  'pool_key',
  'pool_title',
  'pool_order',
  'division',
  'team_count',
  'games_per_match',
  'target_score',
  'point_cap',
  'schedule_preset',
  'seed',
  'team_name'
] as const;

const REQUIRED_HEADERS = [
  'event_code',
  'event_name',
  'pool_key',
  'pool_title',
  'division',
  'team_count',
  'seed',
  'team_name'
];
const REQUIRED_VALUES = new Set(REQUIRED_HEADERS);
const NUMERIC_COLUMNS = new Set(['pool_order', 'team_count', 'games_per_match', 'target_score', 'point_cap', 'seed']);
const POOL_SETTING_COLUMNS = [
  'pool_title',
  'pool_order',
  'division',
  'team_count',
  'games_per_match',
  'target_score',
  'point_cap',
  'schedule_preset'
];
const SUPPORTED_TEAM_COUNTS = new Set([3, 4, 5, 6, 7]);

interface ParsedCsv {
  headers: string[];
  rows: CsvImportRow[];
  errors: CsvImportIssue[];
  warnings: CsvImportIssue[];
}

interface PoolAccumulator {
  key: string;
  firstLineNumber: number;
  settings: Record<string, string>;
  teams: { seed: number; name: string; normalizedName: string; lineNumber: number }[];
}

export const csvImportTemplate = (): string => `${CSV_IMPORT_HEADERS.join(',')}\n`;

export const parseCsvImportFile = (fileName: string, text: string): CsvImportPreview => {
  const parsed = parseCsv(fileName, text);
  return buildPreview(fileName, parsed);
};

const parseCsv = (fileName: string, text: string): ParsedCsv => {
  const errors: CsvImportIssue[] = [];
  const warnings: CsvImportIssue[] = [];
  const hasBom = text.startsWith('\uFEFF');
  const source = hasBom ? text.slice(1) : text;
  const lines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');

  if (!fileName.toLowerCase().endsWith('.csv')) {
    errors.push({ lineNumber: null, message: 'Selected file does not use a .csv extension.' });
  }

  if (hasBom) {
    warnings.push({ lineNumber: 1, message: 'UTF-8 BOM detected.' });
  }

  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }

  if (lines.length === 0) {
    errors.push({ lineNumber: null, message: 'CSV file is empty.' });
    return { headers: [], rows: [], errors, warnings };
  }

  const headerCells = parseCsvLine(lines[0]);
  const headers = normalizeHeaders(headerCells);
  const seenHeaders = new Set<string>();

  for (const header of headers.filter(Boolean)) {
    if (seenHeaders.has(header)) {
      errors.push({ lineNumber: 1, message: `Duplicate header "${header}".` });
    }

    seenHeaders.add(header);
  }

  for (const required of REQUIRED_HEADERS) {
    if (!seenHeaders.has(required)) {
      errors.push({ lineNumber: 1, message: `Missing required header "${required}".` });
    }
  }

  for (const header of headers) {
    if (header && !CSV_IMPORT_HEADERS.includes(header as (typeof CSV_IMPORT_HEADERS)[number])) {
      warnings.push({ lineNumber: 1, message: `Unknown extra CSV column "${header}".` });
    }
  }

  const rows = lines.slice(1).map((line, index) => {
    const lineNumber = index + 2;

    if (!line.trim()) {
      errors.push({ lineNumber, message: 'Completely blank lines are not allowed.' });
    }

    const cells = parseCsvLine(line);
    const values = headers.reduce<Record<string, string>>((result, header, cellIndex) => {
      if (header && CSV_IMPORT_HEADERS.includes(header as (typeof CSV_IMPORT_HEADERS)[number])) {
        result[header] = (cells[cellIndex] ?? '').trim();
      }

      return result;
    }, {});

    for (const required of REQUIRED_VALUES) {
      if (!values[required]) {
        errors.push({ lineNumber, message: `Missing required value "${required}".` });
      }
    }

    for (const column of NUMERIC_COLUMNS) {
      const value = values[column];

      if (value && !/^\d+$/.test(value)) {
        errors.push({ lineNumber, message: `"${column}" must be a whole number.` });
      }
    }

    return { lineNumber, values };
  });

  return { headers, rows, errors, warnings };
};

const buildPreview = (fileName: string, parsed: ParsedCsv): CsvImportPreview => {
  const errors = [...parsed.errors];
  const warnings = [...parsed.warnings];
  const eventCodes = uniqueNonEmpty(parsed.rows.map((row) => row.values['event_code']?.toUpperCase()));
  const eventNames = uniqueNonEmpty(parsed.rows.map((row) => row.values['event_name']));
  const pools = new Map<string, PoolAccumulator>();

  if (eventCodes.length === 0) {
    errors.push({ lineNumber: null, message: 'Missing event_code.' });
  } else if (eventCodes.length > 1) {
    errors.push({ lineNumber: null, message: 'More than one event_code found.' });
  }

  if (eventNames.length === 0) {
    errors.push({ lineNumber: null, message: 'Missing event_name.' });
  } else if (eventNames.length > 1) {
    errors.push({ lineNumber: null, message: 'More than one event_name found.' });
  }

  for (const row of parsed.rows) {
    const key = row.values['pool_key'];

    if (!key) {
      continue;
    }

    const existing = pools.get(key);

    if (!existing) {
      pools.set(key, {
        key,
        firstLineNumber: row.lineNumber,
        settings: settingsFor(row),
        teams: teamFor(row)
      });
      continue;
    }

    const settings = settingsFor(row);

    for (const column of POOL_SETTING_COLUMNS) {
      if ((existing.settings[column] ?? '') !== (settings[column] ?? '')) {
        errors.push({
          lineNumber: row.lineNumber,
          message: `"${column}" conflicts with row ${existing.firstLineNumber} for pool_key "${key}".`
        });
      }
    }

    existing.teams.push(...teamFor(row));
  }

  const previews = [...pools.values()].map((pool) => {
    const teamCount = integerOrNull(pool.settings['team_count']) ?? 0;
    const gamesPerMatch = integerOrNull(pool.settings['games_per_match']) ?? 2;
    const targetScore = integerOrNull(pool.settings['target_score']) ?? defaultTargetScore(teamCount);
    const pointCap = pool.settings['point_cap'] ? integerOrNull(pool.settings['point_cap']) : null;
    const seeds = new Set<number>();
    const names = new Set<string>();

    if (!DIVISION_OPTIONS.includes(pool.settings['division'])) {
      errors.push({ lineNumber: pool.firstLineNumber, message: `Unknown division "${pool.settings['division']}".` });
    }

    if (!SUPPORTED_TEAM_COUNTS.has(teamCount)) {
      errors.push({ lineNumber: pool.firstLineNumber, message: `"team_count" must be one of 3, 4, 5, 6, or 7.` });
    }

    if (pointCap != null && pointCap < targetScore) {
      errors.push({
        lineNumber: pool.firstLineNumber,
        message: '"point_cap" must be greater than or equal to target_score.'
      });
    }

    if (!pool.settings['games_per_match']) {
      warnings.push({ lineNumber: pool.firstLineNumber, message: 'Blank games_per_match will default to 2.' });
    }

    if (!pool.settings['target_score']) {
      warnings.push({
        lineNumber: pool.firstLineNumber,
        message: `Blank target_score will default to ${defaultTargetScore(teamCount)}.`
      });
    }

    if (!pool.settings['point_cap']) {
      warnings.push({ lineNumber: pool.firstLineNumber, message: 'Blank point_cap means no cap.' });
    }

    for (const team of pool.teams) {
      if (seeds.has(team.seed)) {
        errors.push({ lineNumber: team.lineNumber, message: `Duplicate seed ${team.seed} in pool_key "${pool.key}".` });
      }

      seeds.add(team.seed);

      if (names.has(team.normalizedName)) {
        warnings.push({ lineNumber: team.lineNumber, message: `Duplicate team_name "${team.name}".` });
      }

      names.add(team.normalizedName);
    }

    for (let seed = 1; seed <= teamCount; seed += 1) {
      if (!seeds.has(seed)) {
        errors.push({ lineNumber: pool.firstLineNumber, message: `Missing seed ${seed} in pool_key "${pool.key}".` });
      }
    }

    if (pool.teams.length > teamCount) {
      errors.push({
        lineNumber: pool.firstLineNumber,
        message: `More than ${teamCount} teams in pool_key "${pool.key}".`
      });
    }

    if (pool.teams.length < teamCount) {
      errors.push({
        lineNumber: pool.firstLineNumber,
        message: `Fewer than ${teamCount} teams in pool_key "${pool.key}".`
      });
    }

    if (pool.settings['schedule_preset'] && pool.settings['schedule_preset'] !== 'default') {
      errors.push({ lineNumber: pool.firstLineNumber, message: 'Only schedule_preset "default" is supported in v1.' });
    }

    return {
      key: pool.key,
      title: pool.settings['pool_title'] || 'Pool',
      category: 'Men',
      division: pool.settings['division'],
      teamCount,
      gamesPerMatch,
      targetScore,
      pointCap,
      teams: pool.teams
        .map(({ seed, name, lineNumber }) => ({ seed, name, lineNumber }))
        .sort((left, right) => left.seed - right.seed),
      matches: createTemplateMatches(teamCount, gamesPerMatch),
      seededPoolSource: null
    };
  });

  return {
    fileName,
    eventCode: eventCodes[0] ?? '',
    eventName: eventNames[0] ?? '',
    rows: parsed.rows,
    pools: previews,
    errors,
    warnings
  };
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

const normalizeHeaders = (cells: string[]): string[] => {
  const headers = cells.map((cell) => cell.trim().toLowerCase());
  return headers[headers.length - 1] === '' ? headers.slice(0, -1) : headers;
};

const settingsFor = (row: CsvImportRow): Record<string, string> =>
  POOL_SETTING_COLUMNS.reduce<Record<string, string>>((settings, column) => {
    settings[column] = row.values[column] ?? '';
    return settings;
  }, {});

const teamFor = (row: CsvImportRow): PoolAccumulator['teams'] => {
  const seed = integerOrNull(row.values['seed']);
  const name = row.values['team_name'] ?? '';

  return seed == null
    ? []
    : [
        {
          seed,
          name,
          normalizedName: name.trim().replace(/\s+/g, ' ').toLowerCase(),
          lineNumber: row.lineNumber
        }
      ];
};

const integerOrNull = (value: string | undefined): number | null => {
  if (!value || !/^\d+$/.test(value)) {
    return null;
  }

  return Number(value);
};

const uniqueNonEmpty = (values: (string | undefined)[]): string[] => [
  ...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))
];
