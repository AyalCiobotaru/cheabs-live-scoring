import { Rest } from 'ably';

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
    'access-control-allow-methods': 'GET,POST,OPTIONS',
    'access-control-allow-headers': 'content-type'
  };
}
