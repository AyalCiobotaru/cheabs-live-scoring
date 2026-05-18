import { mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Rest } from 'ably';
import Tesseract from 'tesseract.js';

let ablyRest;

export async function handleApiRequest(request, response) {
  try {
    if (request.method === 'OPTIONS') {
      return empty(response, 204);
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
    const route = `${request.method} ${url.pathname}`;

    if (route === 'GET /api/health') {
      return json(response, { ok: true });
    }

    if (route === 'GET /api/outdoor-scoring/realtime-config') {
      return json(response, { enabled: Boolean(process.env.ABLY_API_KEY) });
    }

    if (route === 'GET /api/outdoor-scoring/ably-token') {
      return json(response, await createOutdoorScoringAblyTokenRequest());
    }

    if (route === 'POST /api/outdoor-scoring/scan-sheet') {
      return json(response, await scanOutdoorPoolSheet(await readJson(request)));
    }

    return json(response, { error: 'Not found' }, 404);
  } catch (error) {
    const status = error.statusCode ?? 500;
    console.error(`[${new Date().toISOString()}] ${request.method} ${request.url} failed`, {
      code: error.code,
      message: error.message
    });
    return json(response, {
      error: [400, 401, 403, 404, 409, 413].includes(status) ? error.message : 'Internal server error',
      code: error.code ?? 'ERR_INTERNAL',
      message: error.message
    }, status);
  }
}

async function createOutdoorScoringAblyTokenRequest() {
  const key = process.env.ABLY_API_KEY;

  if (!key) {
    throw httpError(503, 'Ably is not configured.', 'ERR_ABLY_NOT_CONFIGURED');
  }

  ablyRest ??= new Rest({ key });
  return ablyRest.auth.createTokenRequest({
    ttl: 60 * 60 * 1000,
    capability: JSON.stringify({
      'cheabs:live-scoring:global': ['publish', 'subscribe', 'history']
    })
  });
}

async function scanOutdoorPoolSheet(payload) {
  const imageDataUrl = typeof payload.imageDataUrl === 'string' ? payload.imageDataUrl : '';

  if (!imageDataUrl.startsWith('data:image/')) {
    throw httpError(400, 'A Pool Sheet image is required.', 'ERR_IMAGE_REQUIRED');
  }

  if (imageDataUrl.length > 8_000_000) {
    throw httpError(413, 'Pool Sheet image is too large. Retake the photo closer to the sheet.', 'ERR_IMAGE_TOO_LARGE');
  }

  const text = await recognizePoolSheetText(imageDataUrl);
  return normalizePoolSheetScan(parsePoolSheetText(text));
}

async function recognizePoolSheetText(imageDataUrl) {
  const image = imageDataUrlToBuffer(imageDataUrl);
  const cachePath = join(tmpdir(), 'cheabs-tesseract');
  await mkdir(cachePath, { recursive: true });
  const worker = await Tesseract.createWorker('eng', 1, { cachePath });

  try {
    await worker.setParameters({
      tessedit_pageseg_mode: Tesseract.PSM.AUTO
    });
    const { data } = await worker.recognize(image);
    return data.text ?? '';
  } finally {
    await worker.terminate();
  }
}

function imageDataUrlToBuffer(imageDataUrl) {
  const match = imageDataUrl.match(/^data:image\/[a-z0-9.+-]+;base64,(.+)$/i);

  if (!match) {
    throw httpError(400, 'Pool Sheet image must be a base64 data URL.', 'ERR_IMAGE_FORMAT');
  }

  return Buffer.from(match[1], 'base64');
}

function parsePoolSheetText(text) {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const joined = lines.join('\n');
  const teamCount = detectTeamCount(joined) ?? (detectTeamSeeds(lines).length || null);
  const gameFormat = detectGameFormat(joined);
  const teamTable = extractTeamTable(lines, teamCount);
  const teams = detectTeams(lines, teamCount, teamTable);
  const linesWithoutTeams = removeConsumedLines(lines, teamTable.consumedIndexes);
  const matches = detectMatches(linesWithoutTeams, teamCount);
  const notes = ['Parsed with local OCR. Review handwritten team names before scoring.'];

  if (matches.length === 0 && (teamCount === 4 || teamCount === 5)) {
    notes.push('Could not read the match rows clearly, so the default schedule for this pool size was used.');
  }

  return {
    title: detectTitle(lines, teamCount),
    teamCount,
    gamesPerMatch: gameFormat.gamesPerMatch,
    targetScore: gameFormat.targetScore,
    teams,
    matches: matches.length ? matches : defaultOutdoorSchedule(teamCount),
    notes
  };
}

function detectTitle(lines, teamCount) {
  const teamFormatLine = lines.find((line) => /\b[3-7]\s*[-\s]*teams?\b/i.test(line));

  if (teamFormatLine) {
    return teamFormatLine;
  }

  const poolLine = lines.find((line) => /\bpool\b/i.test(line) && !/\bteam\b/i.test(line));

  if (poolLine) {
    return poolLine;
  }

  return teamCount ? `${teamCount} Team Outdoor Pool` : null;
}

function detectTeamCount(text) {
  const match = text.match(/\b(three|four|five|six|seven|[3-7])[\s-]+teams?(?:[\s-]+(?:pool|net))?\b/i);

  if (!match) {
    return null;
  }

  return Number(match[1]) || numberWord(match[1]);
}

function detectGameFormat(text) {
  const lines = normalizePoolSheetText(text).split(/\r?\n/).filter(Boolean);
  const shorthandMatch = extractHandwrittenGameFormat(lines.join('\n'));
  const poolFormatLine = lines.find((line) => (
    /\b(?:competition|round robin|pool play)\b/i.test(line)
    && !/\bplayoffs?\b/i.test(line)
  ));
  const match = shorthandMatch
    ?? extractGameFormat(poolFormatLine)
    ?? extractGameFormat(lines.filter((line) => !/\bplayoffs?\b/i.test(line)).join('\n'));

  return {
    gamesPerMatch: match ? Number(match[1]) : null,
    targetScore: match ? Number(match[2]) : null
  };
}

function normalizePoolSheetText(text) {
  return text
    .replace(/\b(one|two|three|four|five)\b/gi, (word) => String(numberWord(word)))
    .replace(/\b(games?|sets?)\s*of\b/gi, '$1 of')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join('\n');
}

function extractGameFormat(text = '') {
  return text.match(/\b([1-5])\s*(?:games?|sets?|set)\s*(?:during pool play\s*)?(?:is|are)?\s*(?:to|of|using|x)\s*([0-9]{1,2})\b/i)
    ?? text.match(/\b([1-5])\s*(?:games?|sets?|set)\s*(?:to|of|x)\s*([0-9]{1,2})\b/i);
}

function extractHandwrittenGameFormat(text = '') {
  const normalized = text
    .replace(/\btwo\b/gi, '2')
    .replace(/\b(?:too|t0|t\s+o)\b/gi, 'to')
    .replace(/(?<=\d)\s*[|/\\-]\s*(?=\d)/g, ' to ');
  const match = normalized.match(/\b2\s*(?:to|x)\s*(11|1\s*1|ll|l1|i1|ii|15|1\s*5|l5|i5|is|1s)\b/i);

  if (!match) {
    return null;
  }

  const targetScore = normalizeHandwrittenTargetScore(match[1]);
  return targetScore ? [match[0], '2', String(targetScore)] : null;
}

function normalizeHandwrittenTargetScore(value) {
  const token = String(value).replace(/\s+/g, '').toLowerCase();

  if (['11', 'll', 'l1', 'i1', 'ii'].includes(token)) {
    return 11;
  }

  if (['15', 'l5', 'i5', 'is', '1s'].includes(token)) {
    return 15;
  }

  return null;
}

function detectTeamSeeds(lines) {
  const seeds = new Set();

  for (const line of lines) {
    const match = line.match(/^([1-7])(?:\s+|$)/);

    if (match) {
      seeds.add(Number(match[1]));
    }
  }

  return [...seeds].sort((a, b) => a - b);
}

function detectTeams(lines, teamCount, table = extractTeamTable(lines, teamCount)) {
  if (table.rows.length > 0) {
    return table.rows.map((line, index) => ({
      seed: index + 1,
      name: cleanTeamNameFromTableRow(line, table.hasLevelColumn)
    }));
  }

  return detectSeededTeamsFallback(lines, teamCount);
}

function extractTeamTable(lines, teamCount) {
  const headerIndex = lines.findIndex((line) => /\bteam\b.*\bteam\s+name\b/i.test(line));

  if (headerIndex < 0) {
    return {
      rows: [],
      hasLevelColumn: false,
      consumedIndexes: new Set()
    };
  }

  const header = lines[headerIndex];
  const rows = [];
  const consumedIndexes = new Set([headerIndex]);
  const maxRows = teamCount ?? 7;

  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    if (rows.length >= maxRows) {
      break;
    }

    const line = lines[index];

    if (isLikelyTeamTableRow(line)) {
      rows.push(line);
      consumedIndexes.add(index);
    }
  }

  return {
    rows,
    hasLevelColumn: /\blevel\b/i.test(header),
    consumedIndexes
  };
}

function removeConsumedLines(lines, consumedIndexes) {
  return lines.filter((_, index) => !consumedIndexes.has(index));
}

function isScheduleHeader(line) {
  return /^match\b/i.test(line)
    || /^court\b/i.test(line);
}

function isLikelyTeamTableRow(line) {
  return !/\b(?:vs|v5|ws)\b/i.test(line)
    && !/\b(?:competition|playoffs?)\b/i.test(line);
}

function cleanTeamNameFromTableRow(line, hasLevelColumn) {
  const withoutSeedColumn = line.replace(/^\S+\s+/, '');
  const withoutLevelColumn = hasLevelColumn
    ? withoutSeedColumn.replace(/\s+\S+$/, '')
    : withoutSeedColumn;

  return cleanTeamName(withoutLevelColumn);
}

function detectSeededTeamsFallback(lines, teamCount) {
  const teams = new Map();
  const maxSeed = teamCount ?? 7;
  let inTeamsSection = false;

  for (const line of lines) {
    if (/^teams?\b/i.test(line) && !/\bvs\b/i.test(line)) {
      inTeamsSection = true;
      continue;
    }

    if (isScheduleHeader(line)) {
      inTeamsSection = false;
    }

    const match = line.match(/^([1-7])\s+(.+)$/);

    if (!match || !inTeamsSection) {
      continue;
    }

    const seed = Number(match[1]);
    const name = cleanTeamName(match[2]);

    if (seed >= 1 && seed <= maxSeed) {
      teams.set(seed, name || null);
    }
  }

  return Array.from({ length: teamCount ?? teams.size }, (_, index) => {
    const seed = index + 1;
    return {
      seed,
      name: teams.get(seed) ?? null
    };
  });
}

function detectMatches(lines, teamCount) {
  const matches = [];

  for (const line of lines) {
    const match = parseScheduleRow(line, teamCount, matches.length);

    if (match) {
      matches.push(match);
    }
  }

  return matches;
}

function parseScheduleRow(line, teamCount, orderIndex) {
  const normalized = normalizeScheduleRow(line);
  const playMatch = normalized.match(/\b([1-7])\s*(?:vs|v5|ws|w5|wz|v)\s*([1-7])\b/i);

  if (!playMatch) {
    return null;
  }

  const teamASeed = Number(playMatch[1]);
  const teamBSeed = Number(playMatch[2]);
  const afterPlay = normalized.slice((playMatch.index ?? 0) + playMatch[0].length);
  const defaultMatch = defaultOutdoorSchedule(teamCount)[orderIndex];
  const inferredRefSeed = sameMatchTeams(defaultMatch, teamASeed, teamBSeed) ? defaultMatch.refSeed : null;

  return {
    refSeed: detectWorkSeed(afterPlay, teamCount) ?? inferredRefSeed,
    teamASeed,
    teamBSeed
  };
}

function normalizeScheduleRow(line) {
  return line
    .replace(/\bV5\b/gi, 'vs')
    .replace(/\bW5\b/gi, 'ws')
    .replace(/\bVS\b/g, 'vs')
    .replace(/\bWS\b/g, 'ws');
}

function detectWorkSeed(value, teamCount) {
  const maxSeed = teamCount ?? 7;
  const tokens = value.split(/[\s|,;:*()[\]{}]+/).filter(Boolean);

  for (const token of tokens) {
    const seed = ocrSeedTokenToNumber(token);

    if (seed >= 1 && seed <= maxSeed) {
      return seed;
    }
  }

  return null;
}

function ocrSeedTokenToNumber(token) {
  const cleaned = token.replace(/[^a-z0-9|!]/gi, '').toLowerCase();

  if (/^[1-7]$/.test(cleaned)) {
    return Number(cleaned);
  }

  if (['i', 'l', '|', '!', 'ji', 'j1'].includes(cleaned)) {
    return cleaned.startsWith('j') ? 3 : 1;
  }

  if (['j', 'ja'].includes(cleaned)) {
    return 3;
  }

  return null;
}

function sameMatchTeams(match, teamASeed, teamBSeed) {
  return Boolean(match)
    && ((match.teamASeed === teamASeed && match.teamBSeed === teamBSeed)
      || (match.teamASeed === teamBSeed && match.teamBSeed === teamASeed));
}

function defaultOutdoorSchedule(teamCount) {
  if (teamCount === 4) {
    return [
      { refSeed: 1, teamASeed: 2, teamBSeed: 4 },
      { refSeed: 2, teamASeed: 1, teamBSeed: 3 },
      { refSeed: 3, teamASeed: 1, teamBSeed: 4 },
      { refSeed: 1, teamASeed: 2, teamBSeed: 3 },
      { refSeed: 2, teamASeed: 3, teamBSeed: 4 },
      { refSeed: 4, teamASeed: 1, teamBSeed: 2 }
    ];
  }

  if (teamCount === 5) {
    return [
      { refSeed: 3, teamASeed: 2, teamBSeed: 5 },
      { refSeed: 2, teamASeed: 1, teamBSeed: 4 },
      { refSeed: 1, teamASeed: 3, teamBSeed: 5 },
      { refSeed: 5, teamASeed: 2, teamBSeed: 4 },
      { refSeed: 4, teamASeed: 1, teamBSeed: 3 },
      { refSeed: 1, teamASeed: 4, teamBSeed: 5 },
      { refSeed: 4, teamASeed: 2, teamBSeed: 3 },
      { refSeed: 2, teamASeed: 1, teamBSeed: 5 },
      { refSeed: 5, teamASeed: 3, teamBSeed: 4 },
      { refSeed: 3, teamASeed: 1, teamBSeed: 2 }
    ];
  }

  return [];
}

function cleanTeamName(value) {
  const cleaned = value
    .replace(/\bmatches?\s+won\b.*$/i, '')
    .replace(/\bgames?\s+won\b.*$/i, '')
    .replace(/\bvs\b.*$/i, '')
    .replace(/\bwinner\b.*$/i, '')
    .trim();

  return cleaned && !/^[|_\-.]+$/.test(cleaned) ? cleaned : null;
}

function numberWord(value) {
  return {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7
  }[String(value).toLowerCase()] ?? null;
}

function normalizePoolSheetScan(scan) {
  const teamCount = nullableInteger(scan.teamCount, 3, 7);
  const teams = Array.isArray(scan.teams)
    ? scan.teams.map((team) => ({
      seed: nullableInteger(team.seed, 1, 7),
      name: typeof team.name === 'string' && team.name.trim() ? team.name.trim() : null
    })).filter((team) => team.seed != null)
    : [];
  const matches = Array.isArray(scan.matches)
    ? scan.matches.map((match) => ({
      refSeed: nullableInteger(match.refSeed, 1, 7),
      teamASeed: nullableInteger(match.teamASeed, 1, 7),
      teamBSeed: nullableInteger(match.teamBSeed, 1, 7)
    }))
    : [];
  const notes = Array.isArray(scan.notes)
    ? scan.notes.filter((note) => typeof note === 'string' && note.trim()).map((note) => note.trim())
    : [];

  return {
    title: typeof scan.title === 'string' && scan.title.trim() ? scan.title.trim() : null,
    teamCount,
    gamesPerMatch: nullableInteger(scan.gamesPerMatch, 1, 5),
    targetScore: nullableInteger(scan.targetScore, 1, 99),
    teams,
    matches,
    notes
  };
}

function nullableInteger(value, min, max) {
  const number = Number(value);

  if (!Number.isInteger(number) || number < min || number > max) {
    return null;
  }

  return number;
}

function httpError(statusCode, message, code) {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

async function readJson(request) {
  const chunks = [];

  for await (const chunk of request) {
    chunks.push(chunk);
  }

  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
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
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}
