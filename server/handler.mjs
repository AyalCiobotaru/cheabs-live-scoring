import { Rest } from 'ably';
import vision from '@google-cloud/vision';

const EVENT_TTL_SECONDS = 31 * 24 * 60 * 60;
const DIVISION_OPTIONS = ['Open', 'AA', 'A/AA', 'A', 'BB', 'B/BB', 'B'];
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
const STANDARD_SCHEDULES = {
  3: [
    [1, 2, 3],
    [2, 3, 1],
    [1, 3, 2],
    [1, 2, 3],
    [2, 3, 1],
    [1, 3, 2]
  ],
  4: [
    [2, 4, 1],
    [1, 3, 2],
    [1, 4, 3],
    [2, 3, 1],
    [3, 4, 2],
    [1, 2, 4]
  ],
  5: [
    [2, 5, 3],
    [1, 4, 2],
    [3, 5, 1],
    [2, 4, 5],
    [1, 3, 4],
    [4, 5, 1],
    [2, 3, 4],
    [1, 5, 2],
    [3, 4, 5],
    [1, 2, 3]
  ],
  6: [
    [3, 5, 1],
    [4, 6, 2],
    [1, 5, 3],
    [2, 6, 4],
    [1, 3, 5],
    [2, 4, 6],
    [3, 6, 1],
    [4, 5, 2],
    [1, 6, 4],
    [2, 5, 3],
    [1, 4, 6],
    [2, 3, 5],
    [3, 4, 1],
    [5, 6, 2],
    [1, 2, 3]
  ],
  7: [
    [2, 7, 1],
    [3, 5, 4],
    [1, 7, 2],
    [4, 6, 3],
    [2, 5, 1],
    [3, 6, 7],
    [1, 4, 5],
    [3, 7, 6],
    [1, 5, 4],
    [2, 6, 3],
    [4, 5, 7],
    [6, 7, 5],
    [1, 3, 2],
    [5, 7, 6],
    [2, 4, 3],
    [1, 6, 5],
    [2, 3, 4],
    [5, 6, 1],
    [4, 7, 2],
    [1, 2, 6],
    [3, 4, 7]
  ]
};

let ablyRest;
let visionClient;

export async function handleApiRequest(request, response) {
  try {
    if (request.method === 'OPTIONS') {
      return empty(response, 204);
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const route = `${request.method} ${url.pathname}`;
    const eventMatch = url.pathname.match(/^\/api\/scoring\/events\/([A-Z0-9-]+)$/);
    const poolMatch = url.pathname.match(/^\/api\/scoring\/events\/([A-Z0-9-]+)\/pools\/([^/]+)$/);
    const matchMatch = url.pathname.match(/^\/api\/scoring\/events\/([A-Z0-9-]+)\/pools\/([^/]+)\/matches\/([^/]+)$/);
    const finalMatch = url.pathname.match(
      /^\/api\/scoring\/events\/([A-Z0-9-]+)\/pools\/([^/]+)\/matches\/([^/]+)\/final$/
    );

    if (route === 'GET /api/health') {
      return json(response, { ok: true });
    }

    if (route === 'GET /api/scoring/realtime-config') {
      return json(response, {
        enabled: Boolean(process.env.ABLY_API_KEY),
        persistenceEnabled: isRedisConfigured()
      });
    }

    if (route === 'POST /api/scoring/admin-login') {
      requireAdmin(request);
      return json(response, { ok: true });
    }

    if (route === 'GET /api/scoring/ably-token') {
      return json(response, await createScoringAblyTokenRequest());
    }

    if (route === 'POST /api/scoring/sheet-ocr') {
      requireAdmin(request);
      const payload = await readJson(request);
      return json(response, await readPoolSheetOcr(payload.imageDataUrl));
    }

    if (route === 'POST /api/scoring/events') {
      requireAdmin(request);
      const payload = await readJson(request);
      const code = normalizeEventCode(payload.code);
      const now = new Date().toISOString();
      const existing = await readEvent(code);

      if (existing) {
        throw httpError(409, 'An event with that code already exists.', 'ERR_EVENT_EXISTS');
      }

      const event = sanitizeEvent(
        {
          code,
          name: typeof payload.name === 'string' && payload.name.trim() ? payload.name.trim() : code,
          pools: [],
          activePoolId: null,
          updatedAt: now
        },
        code
      );
      await writeEvent(event);
      await publishEvent(event, 'event-updated');
      return json(response, { event }, 201);
    }

    if (route === 'POST /api/scoring/events/import') {
      requireAdmin(request);
      const payload = await readJson(request);
      const result = await buildCsvImportEvent(payload);

      if (result.errors.length > 0) {
        return json(response, { errors: result.errors, warnings: result.warnings }, 400);
      }

      const existing = await readEvent(result.event.code);

      if (existing) {
        return json(
          response,
          {
            errors: [{ lineNumber: null, message: 'An event with that code already exists.' }],
            warnings: result.warnings
          },
          409
        );
      }

      await writeEvent(result.event);
      await publishEvent(result.event, 'event-updated');
      return json(response, { event: result.event, warnings: result.warnings }, 201);
    }

    if (eventMatch && request.method === 'GET') {
      const code = normalizeEventCode(eventMatch[1]);
      const event = await readEvent(code);

      if (!event) {
        throw httpError(404, 'Event not found.', 'ERR_EVENT_NOT_FOUND');
      }

      return json(response, { event });
    }

    if (poolMatch && request.method === 'PUT') {
      requireAdmin(request);
      const code = normalizeEventCode(poolMatch[1]);
      const poolId = decodeURIComponent(poolMatch[2]);
      const payload = await readJson(request);
      const existingEvent = await readEvent(code);
      const event =
        existingEvent ??
        sanitizeEvent(
          {
            code,
            name: typeof payload.eventName === 'string' && payload.eventName.trim() ? payload.eventName.trim() : code,
            pools: [],
            activePoolId: null,
            updatedAt: new Date().toISOString()
          },
          code
        );

      const pool = sanitizePool({
        ...payload.pool,
        id: poolId,
        imagePreview: null,
        updatedAt: new Date().toISOString()
      });
      const existingIndex = event.pools.findIndex((candidate) => candidate.id === pool.id);
      event.pools =
        existingIndex >= 0
          ? event.pools.map((candidate) => (candidate.id === pool.id ? pool : candidate))
          : [...event.pools, pool];
      event.activePoolId = pool.id;
      event.updatedAt = new Date().toISOString();
      await writeEvent(event);
      await publishPoolSetup(event.code, pool);
      return json(response, { event });
    }

    if (poolMatch && request.method === 'DELETE') {
      requireAdmin(request);
      const code = normalizeEventCode(poolMatch[1]);
      const poolId = decodeURIComponent(poolMatch[2]);
      const event = await readEvent(code);

      if (!event) {
        throw httpError(404, 'Event not found.', 'ERR_EVENT_NOT_FOUND');
      }

      if (!event.pools.some((candidate) => candidate.id === poolId)) {
        throw httpError(404, 'Pool not found.', 'ERR_POOL_NOT_FOUND');
      }

      event.pools = event.pools.filter((candidate) => candidate.id !== poolId);
      event.activePoolId = event.activePoolId === poolId ? (event.pools[0]?.id ?? null) : event.activePoolId;
      event.updatedAt = new Date().toISOString();
      await writeEvent(event);
      await publishPoolDeleted(event.code, poolId);
      return json(response, { event });
    }

    if ((matchMatch || finalMatch) && request.method === 'PUT') {
      const routeMatch = matchMatch ?? finalMatch;
      const code = normalizeEventCode(routeMatch[1]);
      const poolId = decodeURIComponent(routeMatch[2]);
      const matchId = decodeURIComponent(routeMatch[3]);
      const payload = await readJson(request);
      const event = await readEvent(code);

      if (!event) {
        throw httpError(404, 'Event not found.', 'ERR_EVENT_NOT_FOUND');
      }

      const pool = event.pools.find((candidate) => candidate.id === poolId);

      if (!pool) {
        throw httpError(404, 'Pool not found.', 'ERR_POOL_NOT_FOUND');
      }

      const match = sanitizeMatch(
        {
          ...payload.match,
          id: matchId,
          final: finalMatch ? true : Boolean(payload.match?.final),
          updatedAt: new Date().toISOString()
        },
        pool.gamesPerMatch,
        pool.pointCap,
        pool.teamCount
      );
      const existingIndex = pool.matches.findIndex((candidate) => candidate.id === match.id);

      if (existingIndex < 0) {
        throw httpError(404, 'Match not found.', 'ERR_MATCH_NOT_FOUND');
      }

      const timerBefore = poolTimerUpdate(pool);
      pool.matches = pool.matches.map((candidate) => (candidate.id === match.id ? match : candidate));
      applyMatchTimerAction(pool, match, payload.timerAction);
      pool.updatedAt = match.updatedAt;
      event.updatedAt = match.updatedAt;
      await writeEvent(event);
      await publishMatch(event.code, pool.id, match);
      if (!sameTimerUpdate(timerBefore, poolTimerUpdate(pool))) {
        await publishPoolTimer(event.code, pool.id, poolTimerUpdate(pool));
      }
      return json(response, { event, match });
    }

    return json(response, { error: 'Not found' }, 404);
  } catch (error) {
    const status = error.statusCode ?? 500;
    console.error(`[${new Date().toISOString()}] ${request.method} ${request.url} failed`, {
      code: error.code,
      message: error.message
    });
    return json(
      response,
      {
        error: [400, 401, 403, 404, 409, 413].includes(status) ? error.message : 'Internal server error',
        code: error.code ?? 'ERR_INTERNAL',
        message: error.message
      },
      status
    );
  }
}

async function createScoringAblyTokenRequest() {
  const key = process.env.ABLY_API_KEY;

  if (!key) {
    throw httpError(503, 'Ably is not configured.', 'ERR_ABLY_NOT_CONFIGURED');
  }

  ablyRest ??= new Rest({ key });
  return ablyRest.auth.createTokenRequest({
    ttl: 60 * 60 * 1000,
    capability: JSON.stringify({
      'cheabs:live-scoring:*': ['publish', 'subscribe', 'history']
    })
  });
}

async function publishEvent(event, kind) {
  if (!process.env.ABLY_API_KEY) {
    return;
  }

  ablyRest ??= new Rest({ key: process.env.ABLY_API_KEY });
  const channel = ablyRest.channels.get(eventChannelName(event.code));
  await channel.publish('event-update', {
    clientId: 'server',
    eventCode: event.code,
    kind,
    message: 'Scoring event update.',
    updatedAt: new Date().toISOString(),
    event: stripEventImages(event)
  });
}

async function publishPoolSetup(eventCode, pool) {
  if (!process.env.ABLY_API_KEY) {
    return;
  }

  ablyRest ??= new Rest({ key: process.env.ABLY_API_KEY });
  const channel = ablyRest.channels.get(eventChannelName(eventCode));
  await channel.publish('event-update', {
    clientId: 'server',
    eventCode,
    kind: 'pool-setup-updated',
    message: 'Scoring pool setup update.',
    updatedAt: new Date().toISOString(),
    pool: stripPoolImage(pool)
  });
}

async function publishPoolDeleted(eventCode, poolId) {
  if (!process.env.ABLY_API_KEY) {
    return;
  }

  ablyRest ??= new Rest({ key: process.env.ABLY_API_KEY });
  const channel = ablyRest.channels.get(eventChannelName(eventCode));
  await channel.publish('event-update', {
    clientId: 'server',
    eventCode,
    kind: 'pool-deleted',
    message: 'Scoring pool deleted.',
    updatedAt: new Date().toISOString(),
    poolId
  });
}

async function publishMatch(eventCode, poolId, match) {
  if (!process.env.ABLY_API_KEY) {
    return;
  }

  ablyRest ??= new Rest({ key: process.env.ABLY_API_KEY });
  const channel = ablyRest.channels.get(eventChannelName(eventCode));
  await channel.publish('event-update', {
    clientId: 'server',
    eventCode,
    kind: 'match-updated',
    message: 'Scoring match update.',
    updatedAt: new Date().toISOString(),
    poolId,
    match
  });
}

async function publishPoolTimer(eventCode, poolId, timer) {
  if (!process.env.ABLY_API_KEY) {
    return;
  }

  ablyRest ??= new Rest({ key: process.env.ABLY_API_KEY });
  const channel = ablyRest.channels.get(eventChannelName(eventCode));
  await channel.publish('event-update', {
    clientId: 'server',
    eventCode,
    kind: 'pool-timer-updated',
    message: 'Scoring pool timer update.',
    updatedAt: new Date().toISOString(),
    poolId,
    timer
  });
}

async function readEvent(code) {
  const result = await redisCommand(['GET', eventKey(code)]);

  if (!result) {
    return null;
  }

  return sanitizeEvent(JSON.parse(result), code);
}

async function writeEvent(event) {
  await redisCommand([
    'SET',
    eventKey(event.code),
    JSON.stringify(stripEventImages(event)),
    'EX',
    String(EVENT_TTL_SECONDS)
  ]);
}

async function redisCommand(command) {
  if (!isRedisConfigured()) {
    throw httpError(503, 'Upstash Redis is not configured.', 'ERR_REDIS_NOT_CONFIGURED');
  }

  const response = await fetch(process.env.UPSTASH_REDIS_REST_URL, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${process.env.UPSTASH_REDIS_REST_TOKEN}`,
      'content-type': 'application/json'
    },
    body: JSON.stringify(command)
  });

  const body = await response.json().catch(() => ({}));

  if (!response.ok || body.error) {
    throw httpError(502, body.error || 'Unable to reach Upstash Redis.', 'ERR_REDIS');
  }

  return body.result;
}

function isRedisConfigured() {
  return Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN);
}

function eventKey(code) {
  return `event:${code}`;
}

function eventChannelName(code) {
  return `cheabs:live-scoring:event:${code}`;
}

function normalizeEventCode(value) {
  const code = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);

  if (!/^[A-Z0-9][A-Z0-9-]{1,31}$/.test(code)) {
    throw httpError(400, 'Use an event code with letters, numbers, or hyphens.', 'ERR_EVENT_CODE');
  }

  return code;
}

function normalizeDivision(value) {
  const division = typeof value === 'string' ? value.trim() : '';
  return DIVISION_OPTIONS.includes(division) ? division : DIVISION_OPTIONS[0];
}

function sanitizeEvent(event, code) {
  const pools = Array.isArray(event?.pools) ? event.pools.map(sanitizePool).filter(Boolean) : [];
  const activePoolId =
    typeof event?.activePoolId === 'string' && pools.some((pool) => pool.id === event.activePoolId)
      ? event.activePoolId
      : (pools[0]?.id ?? null);

  return {
    code,
    name: typeof event?.name === 'string' && event.name.trim() ? event.name.trim() : code,
    pools,
    activePoolId,
    updatedAt: typeof event?.updatedAt === 'string' ? event.updatedAt : new Date().toISOString()
  };
}

function sanitizePool(pool) {
  if (!pool || typeof pool !== 'object') {
    return null;
  }

  const id = typeof pool.id === 'string' && pool.id.trim() ? pool.id.trim() : createId();
  const teamCount = clampWholeNumber(pool.teamCount, 3, 7);
  const gamesPerMatch = clampWholeNumber(pool.gamesPerMatch, 1, 5);
  const targetScore = pool.targetScore == null ? defaultTargetScore(teamCount) : clampWholeNumber(pool.targetScore, 1, 99);
  const pointCap = pool.pointCap == null ? null : Math.max(targetScore, clampWholeNumber(pool.pointCap, 1, 99));
  const matchStartTimerMinutes = clampWholeNumber(pool.matchStartTimerMinutes ?? 10, 0, 99);
  const sourceTeams = Array.isArray(pool.teams) ? pool.teams : [];
  const nextMatchStartAt =
    matchStartTimerMinutes > 0 && typeof pool.nextMatchStartAt === 'string' ? pool.nextMatchStartAt : null;
  const nextMatchStartSourceMatchId =
    nextMatchStartAt && typeof pool.nextMatchStartSourceMatchId === 'string' ? pool.nextMatchStartSourceMatchId : null;

  return {
    id,
    title: typeof pool.title === 'string' && pool.title.trim() ? pool.title.trim() : 'Pool',
    division: normalizeDivision(pool.division),
    teamCount,
    gamesPerMatch,
    targetScore,
    pointCap,
    matchStartTimerMinutes,
    nextMatchStartAt,
    nextMatchStartSourceMatchId,
    teams: Array.from({ length: teamCount }, (_, index) => {
      const seed = index + 1;
      const team = sourceTeams.find((candidate) => Number(candidate?.seed) === seed);

      return {
        seed,
        name: typeof team?.name === 'string' && team.name.trim() ? team.name.trim() : `Team ${seed}`
      };
    }),
    matches: Array.isArray(pool.matches)
      ? pool.matches.map((match) => sanitizeMatch(match, gamesPerMatch, pointCap, teamCount))
      : [],
    imagePreview: null,
    updatedAt: typeof pool.updatedAt === 'string' ? pool.updatedAt : new Date().toISOString()
  };
}

function applyMatchTimerAction(pool, match, timerAction) {
  if (timerAction === 'clear') {
    clearPoolTimer(pool);
    return;
  }

  if (timerAction !== 'start' || !match.final || pool.matchStartTimerMinutes <= 0) {
    return;
  }

  const matchIndex = pool.matches.findIndex((candidate) => candidate.id === match.id);

  if (matchIndex < 0 || matchIndex === pool.matches.length - 1) {
    return;
  }

  const now = Date.now();
  pool.nextMatchStartAt = new Date(now + pool.matchStartTimerMinutes * 60_000).toISOString();
  pool.nextMatchStartSourceMatchId = match.id;
}

function clearPoolTimer(pool) {
  pool.nextMatchStartAt = null;
  pool.nextMatchStartSourceMatchId = null;
}

function poolTimerUpdate(pool) {
  return {
    nextMatchStartAt: pool.nextMatchStartAt ?? null,
    nextMatchStartSourceMatchId: pool.nextMatchStartSourceMatchId ?? null
  };
}

function sameTimerUpdate(left, right) {
  return (
    left.nextMatchStartAt === right.nextMatchStartAt &&
    left.nextMatchStartSourceMatchId === right.nextMatchStartSourceMatchId
  );
}

function sanitizeMatch(match, gamesPerMatch, pointCap = 99, teamCount = 7) {
  const sourceGames = Array.isArray(match?.games) ? match.games : [];
  const scoreCap = pointCap == null ? 99 : pointCap;

  return {
    id: typeof match?.id === 'string' && match.id.trim() ? match.id.trim() : createId(),
    refSeed: nullableInteger(match?.refSeed, 1, teamCount),
    teamASeed: nullableInteger(match?.teamASeed, 1, teamCount),
    teamBSeed: nullableInteger(match?.teamBSeed, 1, teamCount),
    games: Array.from({ length: gamesPerMatch }, (_, index) => ({
      scoreA: clampWholeNumber(sourceGames[index]?.scoreA, 0, scoreCap),
      scoreB: clampWholeNumber(sourceGames[index]?.scoreB, 0, scoreCap),
      final: Boolean(sourceGames[index]?.final)
    })),
    final: Boolean(match?.final),
    updatedAt: typeof match?.updatedAt === 'string' ? match.updatedAt : new Date().toISOString()
  };
}

async function buildCsvImportEvent(payload) {
  const rows = Array.isArray(payload?.rows) ? payload.rows.map(normalizeImportRow).filter(Boolean) : [];
  const errors = [];
  const warnings = [];
  const fileName = typeof payload?.fileName === 'string' ? payload.fileName : '';
  const eventCodes = uniqueNonEmpty(rows.map((row) => row.values.event_code)).map((code) => normalizeImportCode(code, errors));
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

  const eventPools = [...pools.values()].map((pool) => buildImportedPool(pool, now, errors, warnings));
  const event = sanitizeEvent(
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

function normalizeImportCode(value, errors) {
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

function buildImportedPool(pool, now, errors, warnings) {
  const teamCount = integerOrNull(pool.settings.team_count) ?? 0;
  const gamesPerMatch = integerOrNull(pool.settings.games_per_match) ?? 2;
  const targetScore = integerOrNull(pool.settings.target_score) ?? defaultTargetScore(teamCount);
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
    errors.push({ lineNumber: pool.firstLineNumber, message: '"point_cap" must be greater than or equal to target_score.' });
  }

  if (!pool.settings.games_per_match) {
    warnings.push({ lineNumber: pool.firstLineNumber, message: 'Blank games_per_match will default to 2.' });
  }

  if (!pool.settings.target_score) {
    warnings.push({
      lineNumber: pool.firstLineNumber,
      message: `Blank target_score will default to ${defaultTargetScore(teamCount)}.`
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
    errors.push({ lineNumber: pool.firstLineNumber, message: `More than ${teamCount} teams in pool_key "${pool.key}".` });
  }

  if (pool.teams.length < teamCount) {
    errors.push({ lineNumber: pool.firstLineNumber, message: `Fewer than ${teamCount} teams in pool_key "${pool.key}".` });
  }

  return {
    id: createId(),
    title: pool.settings.pool_title || 'Pool',
    division: pool.settings.division,
    teamCount,
    gamesPerMatch,
    targetScore,
    pointCap,
    teams: pool.teams
      .map(({ seed, name }) => ({ seed, name }))
      .sort((left, right) => left.seed - right.seed),
    matches: createTemplateMatches(teamCount, gamesPerMatch, now),
    imagePreview: null,
    updatedAt: now
  };
}

function createTemplateMatches(teamCount, gamesPerMatch, now) {
  const rows = STANDARD_SCHEDULES[teamCount] ?? [];

  return rows.map(([teamASeed, teamBSeed, refSeed]) => ({
    id: createId(),
    refSeed,
    teamASeed,
    teamBSeed,
    games: Array.from({ length: gamesPerMatch }, () => ({
      scoreA: 0,
      scoreB: 0,
      final: false
    })),
    final: false,
    updatedAt: now
  }));
}

function integerOrNull(value) {
  return typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null;
}

function uniqueNonEmpty(values) {
  return [...new Set(values.map((value) => (typeof value === 'string' ? value.trim() : '')).filter(Boolean))];
}

function stripEventImages(event) {
  return {
    ...event,
    pools: event.pools.map((pool) => ({
      ...pool,
      imagePreview: null
    }))
  };
}

function stripPoolImage(pool) {
  return {
    ...pool,
    imagePreview: null
  };
}

function requireAdmin(request) {
  const configured = process.env.ADMIN_PASSWORD;

  if (!configured) {
    throw httpError(503, 'Admin password is not configured.', 'ERR_ADMIN_NOT_CONFIGURED');
  }

  if (request.headers['x-admin-password'] !== configured) {
    throw httpError(401, 'Admin sign-in required.', 'ERR_ADMIN_REQUIRED');
  }
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function clampWholeNumber(value, min, max) {
  return Math.min(max, Math.max(min, wholeNumber(value)));
}

async function readPoolSheetOcr(imageDataUrl) {
  const content = dataUrlToBase64(imageDataUrl);
  const client = googleVisionClient();
  const [result] = await client.documentTextDetection({
    image: { content }
  });
  const text = result.fullTextAnnotation?.text ?? result.textAnnotations?.[0]?.description ?? '';

  return {
    text,
    lines: extractOcrLines(result.fullTextAnnotation)
  };
}

function extractOcrLines(fullTextAnnotation) {
  const lines = [];

  for (const page of fullTextAnnotation?.pages ?? []) {
    for (const block of page.blocks ?? []) {
      for (const paragraph of block.paragraphs ?? []) {
        const words = (paragraph.words ?? []).map(normalizeVisionWord).filter(Boolean);

        if (words.length === 0) {
          continue;
        }

        lines.push(...groupWordsIntoLines(words));
      }
    }
  }

  return lines.sort((left, right) => left.bounds.y - right.bounds.y || left.bounds.x - right.bounds.x);
}

function normalizeVisionWord(word) {
  const text = (word.symbols ?? []).map((symbol) => symbol.text ?? '').join('');
  const bounds = boundsFromVertices(word.boundingBox?.vertices ?? []);

  if (!text.trim() || !bounds) {
    return null;
  }

  return {
    text,
    bounds,
    confidence: typeof word.confidence === 'number' ? word.confidence : null
  };
}

function groupWordsIntoLines(words) {
  const sortedWords = [...words].sort((left, right) => lineCenter(left) - lineCenter(right) || left.bounds.x - right.bounds.x);
  const groups = [];

  for (const word of sortedWords) {
    const center = lineCenter(word);
    const existing = groups.find((group) => Math.abs(group.center - center) <= Math.max(8, group.height * 0.6));

    if (existing) {
      existing.words.push(word);
      existing.center = (existing.center + center) / 2;
      existing.height = Math.max(existing.height, word.bounds.height);
    } else {
      groups.push({
        center,
        height: word.bounds.height,
        words: [word]
      });
    }
  }

  return groups.map((group) => {
    const lineWords = group.words.sort((left, right) => left.bounds.x - right.bounds.x);
    const bounds = mergeBounds(lineWords.map((word) => word.bounds));

    return {
      text: lineWords.map((word) => word.text).join(' '),
      bounds,
      confidence: averageConfidence(lineWords)
    };
  });
}

function lineCenter(word) {
  return word.bounds.y + word.bounds.height / 2;
}

function boundsFromVertices(vertices) {
  const xs = vertices.map((vertex) => vertex.x).filter((value) => typeof value === 'number');
  const ys = vertices.map((vertex) => vertex.y).filter((value) => typeof value === 'number');

  if (xs.length === 0 || ys.length === 0) {
    return null;
  }

  const left = Math.min(...xs);
  const top = Math.min(...ys);
  const right = Math.max(...xs);
  const bottom = Math.max(...ys);

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function mergeBounds(boundsList) {
  const left = Math.min(...boundsList.map((bounds) => bounds.x));
  const top = Math.min(...boundsList.map((bounds) => bounds.y));
  const right = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
  const bottom = Math.max(...boundsList.map((bounds) => bounds.y + bounds.height));

  return {
    x: left,
    y: top,
    width: right - left,
    height: bottom - top
  };
}

function averageConfidence(words) {
  const confidences = words
    .map((word) => word.confidence)
    .filter((confidence) => typeof confidence === 'number');

  if (confidences.length === 0) {
    return null;
  }

  return confidences.reduce((sum, confidence) => sum + confidence, 0) / confidences.length;
}

function googleVisionClient() {
  if (visionClient) {
    return visionClient;
  }

  const credentialsJson = process.env.GOOGLE_CLOUD_VISION_CREDENTIALS_JSON ?? process.env.GOOGLE_APPLICATION_CREDENTIALS_JSON;
  const options = {};

  if (credentialsJson) {
    try {
      options.credentials = JSON.parse(credentialsJson);
      options.projectId = process.env.GOOGLE_CLOUD_PROJECT_ID ?? options.credentials.project_id;
    } catch {
      throw httpError(503, 'Google Cloud Vision credentials JSON is invalid.', 'ERR_GOOGLE_VISION_CONFIG');
    }
  }

  visionClient = new vision.ImageAnnotatorClient(options);
  return visionClient;
}

function dataUrlToBase64(imageDataUrl) {
  if (typeof imageDataUrl !== 'string' || !imageDataUrl.trim()) {
    throw httpError(400, 'Pool Sheet image is required.', 'ERR_IMAGE_REQUIRED');
  }

  const match = imageDataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);
  const base64 = match?.[1] ?? imageDataUrl;

  if (!/^[a-z0-9+/=\s]+$/i.test(base64)) {
    throw httpError(400, 'Pool Sheet image must be base64 encoded.', 'ERR_IMAGE_INVALID');
  }

  return base64.replace(/\s+/g, '');
}

function defaultTargetScore(teamCount) {
  return teamCount === 4 ? 15 : 11;
}

function defaultCap(teamCount) {
  return defaultTargetScore(teamCount) === 11 ? 13 : 17;
}

function nullableInteger(value, min, max) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : null;
}

function wholeNumber(value) {
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : 0;
}

function createId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function empty(response, status = 204) {
  response.writeHead(status, corsHeaders());
  response.end();
}

function json(response, body, status = 200, extraHeaders = {}) {
  response.writeHead(status, {
    ...corsHeaders(),
    'content-type': 'application/json',
    ...extraHeaders
  });
  response.end(JSON.stringify(body, null, 2));
}

function corsHeaders() {
  return {
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'access-control-allow-headers': 'content-type,x-admin-password'
  };
}
