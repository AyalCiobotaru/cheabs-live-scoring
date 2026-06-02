import { Rest } from 'ably';
import vision from '@google-cloud/vision';

const EVENT_TTL_SECONDS = 31 * 24 * 60 * 60;
const DIVISION_OPTIONS = ['Open', 'AA', 'A/AA', 'A', 'BB', 'B/BB', 'B'];

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

      pool.matches = pool.matches.map((candidate) => (candidate.id === match.id ? match : candidate));
      pool.updatedAt = match.updatedAt;
      event.updatedAt = match.updatedAt;
      await writeEvent(event);
      await publishMatch(event.code, pool.id, match);
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
  const pointCap = Math.max(
    targetScore,
    pool.pointCap == null ? defaultCap(teamCount) : clampWholeNumber(pool.pointCap, 1, 99)
  );
  const sourceTeams = Array.isArray(pool.teams) ? pool.teams : [];

  return {
    id,
    title: typeof pool.title === 'string' && pool.title.trim() ? pool.title.trim() : 'Pool',
    division: normalizeDivision(pool.division),
    teamCount,
    gamesPerMatch,
    targetScore,
    pointCap,
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

function sanitizeMatch(match, gamesPerMatch, pointCap = 99, teamCount = 7) {
  const sourceGames = Array.isArray(match?.games) ? match.games : [];

  return {
    id: typeof match?.id === 'string' && match.id.trim() ? match.id.trim() : createId(),
    refSeed: nullableInteger(match?.refSeed, 1, teamCount),
    teamASeed: nullableInteger(match?.teamASeed, 1, teamCount),
    teamBSeed: nullableInteger(match?.teamBSeed, 1, teamCount),
    games: Array.from({ length: gamesPerMatch }, (_, index) => ({
      scoreA: clampWholeNumber(sourceGames[index]?.scoreA, 0, pointCap),
      scoreB: clampWholeNumber(sourceGames[index]?.scoreB, 0, pointCap),
      final: Boolean(sourceGames[index]?.final)
    })),
    final: Boolean(match?.final),
    updatedAt: typeof match?.updatedAt === 'string' ? match.updatedAt : new Date().toISOString()
  };
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
    'access-control-allow-methods': 'GET,POST,PUT,OPTIONS',
    'access-control-allow-headers': 'content-type,x-admin-password'
  };
}
