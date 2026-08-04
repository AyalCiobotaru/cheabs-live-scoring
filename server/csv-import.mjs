const CSV_IMPORT_HEADERS = [
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
];
const REQUIRED_IMPORT_VALUES = new Set([
  'event_code',
  'event_name',
  'pool_key',
  'pool_title',
  'division',
  'team_count',
  'seed',
  'team_name'
]);
const IMPORT_POOL_SETTING_COLUMNS = [
  'pool_title',
  'pool_order',
  'division',
  'team_count',
  'games_per_match',
  'target_score',
  'point_cap',
  'schedule_preset'
];
const IMPORT_NUMERIC_COLUMNS = new Set([
  'pool_order',
  'team_count',
  'games_per_match',
  'target_score',
  'point_cap',
  'seed'
]);
const SUPPORTED_TEAM_COUNTS = new Set([3, 4, 5, 6, 7]);
const DIVISION_OPTIONS = ['Open', 'AA', 'A/AA', 'A', 'BB', 'B/BB', 'B'];

export async function buildCsvImportEvent(payload, dependencies) {
  const rows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeImportRow).filter(Boolean) : [];
  const errors = [];
  const warnings = [];
  const fileName = typeof payload?.fileName === 'string' ? payload.fileName : '';
  const eventCodes = uniqueNonEmpty(rows.map((row) => row.values.event_code)).map((code) =>
    normalizeImportCode(code, errors, dependencies.normalizeEventCode)
  );
  const eventNames = uniqueNonEmpty(rows.map((row) => row.values.event_name));
  const pools = new Map();
  const now = new Date().toISOString();

  if (!fileName.toLowerCase().endsWith('.csv')) {
    errors.push({ lineNumber: null, message: 'Selected file does not use a .csv extension.' });
  }

  if (rows.length === 0) {
    errors.push({ lineNumber: null, message: 'CSV import has no rows.' });
  }

  for (const row of rows) {
    for (const required of REQUIRED_IMPORT_VALUES) {
      if (!row.values[required]) {
        errors.push({ lineNumber: row.lineNumber, message: `Missing required value "${required}".` });
      }
    }

    for (const column of IMPORT_NUMERIC_COLUMNS) {
      if (row.values[column] && !/^\d+$/.test(row.values[column])) {
        errors.push({ lineNumber: row.lineNumber, message: `"${column}" must be a whole number.` });
      }
    }
  }

  if (eventCodes.length === 0 || !eventCodes[0]) {
    errors.push({ lineNumber: null, message: 'Missing event_code.' });
  } else if (new Set(eventCodes).size > 1) {
    errors.push({ lineNumber: null, message: 'More than one event_code found.' });
  }

  if (eventNames.length === 0) {
    errors.push({ lineNumber: null, message: 'Missing event_name.' });
  } else if (eventNames.length > 1) {
    errors.push({ lineNumber: null, message: 'More than one event_name found.' });
  }

  for (const row of rows) {
    const key = row.values.pool_key;

    if (!key) {
      continue;
    }

    const settings = importSettingsFor(row);
    const team = importTeamFor(row);
    const existing = pools.get(key);

    if (!existing) {
      pools.set(key, {
        key,
        firstLineNumber: row.lineNumber,
        settings,
        teams: team ? [team] : []
      });
      continue;
    }

    for (const column of IMPORT_POOL_SETTING_COLUMNS) {
      if ((existing.settings[column] ?? '') !== (settings[column] ?? '')) {
        errors.push({
          lineNumber: row.lineNumber,
          message: `"${column}" conflicts with row ${existing.firstLineNumber} for pool_key "${key}".`
        });
      }
    }

    if (team) {
      existing.teams.push(team);
    }
  }

  const eventPools = [...pools.values()].map((pool) => buildImportedPool(pool, now, errors, warnings, dependencies));
  const event = dependencies.sanitizeEvent(
    {
      code: eventCodes[0] ?? '',
      name: eventNames[0] ?? eventCodes[0] ?? '',
      pools: eventPools,
      activePoolId: eventPools[0]?.id ?? null,
      updatedAt: now
    },
    eventCodes[0] || 'IMPORT-ERROR'
  );

  event.activePoolId = eventPools[0]?.id ?? null;

  return { event, errors, warnings };
}

function normalizeImportRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }

  const values = {};
  const source = row.values && typeof row.values === 'object' ? row.values : {};

  for (const header of CSV_IMPORT_HEADERS) {
    values[header] = typeof source[header] === 'string' ? source[header].trim() : '';
  }

  return {
    lineNumber: Number.isInteger(row.lineNumber) && row.lineNumber > 0 ? row.lineNumber : null,
    values
  };
}

function normalizeImportCode(value, errors, normalizeEventCode) {
  try {
    return normalizeEventCode(value);
  } catch (error) {
    errors.push({ lineNumber: null, message: error.message });
    return '';
  }
}

function importSettingsFor(row) {
  return IMPORT_POOL_SETTING_COLUMNS.reduce((settings, column) => {
    settings[column] = row.values[column] ?? '';
    return settings;
  }, {});
}

function importTeamFor(row) {
  const seed = integerOrNull(row.values.seed);

  if (seed == null) {
    return null;
  }

  const name = row.values.team_name ?? '';

  return {
    seed,
    name,
    normalizedName: name.trim().replace(/\s+/g, ' ').toLowerCase(),
    lineNumber: row.lineNumber
  };
}

function buildImportedPool(pool, now, errors, warnings, dependencies) {
  const teamCount = integerOrNull(pool.settings.team_count) ?? 0;
  const gamesPerMatch = integerOrNull(pool.settings.games_per_match) ?? 2;
  const targetScore = integerOrNull(pool.settings.target_score) ?? dependencies.defaultTargetScore(teamCount);
  const pointCap = pool.settings.point_cap ? integerOrNull(pool.settings.point_cap) : null;
  const seeds = new Set();
  const names = new Set();

  if (!DIVISION_OPTIONS.includes(pool.settings.division)) {
    errors.push({ lineNumber: pool.firstLineNumber, message: `Unknown division "${pool.settings.division}".` });
  }

  if (!SUPPORTED_TEAM_COUNTS.has(teamCount)) {
    errors.push({ lineNumber: pool.firstLineNumber, message: '"team_count" must be one of 3, 4, 5, 6, or 7.' });
  }

  if (pointCap != null && pointCap < targetScore) {
    errors.push({
      lineNumber: pool.firstLineNumber,
      message: '"point_cap" must be greater than or equal to target_score.'
    });
  }

  if (!pool.settings.games_per_match) {
    warnings.push({ lineNumber: pool.firstLineNumber, message: 'Blank games_per_match will default to 2.' });
  }

  if (!pool.settings.target_score) {
    warnings.push({
      lineNumber: pool.firstLineNumber,
      message: `Blank target_score will default to ${dependencies.defaultTargetScore(teamCount)}.`
    });
  }

  if (!pool.settings.point_cap) {
    warnings.push({ lineNumber: pool.firstLineNumber, message: 'Blank point_cap means no cap.' });
  }

  if (pool.settings.schedule_preset && pool.settings.schedule_preset !== 'default') {
    errors.push({ lineNumber: pool.firstLineNumber, message: 'Only schedule_preset "default" is supported in v1.' });
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

  return {
    id: dependencies.createId(),
    title: pool.settings.pool_title || 'Pool',
    category: 'Men',
    division: pool.settings.division,
    teamCount,
    gamesPerMatch,
    targetScore,
    pointCap,
    editable: true,
    matchStartTimerMinutes: 10,
    courtNumbers: [],
    nextMatchStartAt: null,
    nextMatchStartSourceMatchId: null,
    teams: pool.teams.map(({ seed, name }) => ({ seed, name })).sort((left, right) => left.seed - right.seed),
    matches: dependencies.createTemplateMatches(teamCount, gamesPerMatch, now),
    seededPoolSource: null,
    imagePreview: null,
    updatedAt: now
  };
}

function integerOrNull(value) {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean))];
}
