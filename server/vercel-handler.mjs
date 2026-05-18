import { Readable } from 'node:stream';
import { handleApiRequest } from './handler.mjs';

export async function handleApiFetch(request) {
  const url = new URL(request.url);
  const body = request.body ? Readable.fromWeb(request.body) : Readable.from([]);
  const nodeRequest = Object.assign(body, {
    method: request.method,
    url: `${url.pathname}${url.search}`,
    headers: {
      ...Object.fromEntries(request.headers.entries()),
      host: request.headers.get('host') ?? url.host
    }
  });
  const nodeResponse = createBufferedResponse();

  await handleApiRequest(nodeRequest, nodeResponse);
  return nodeResponse.toResponse();
}

function createBufferedResponse() {
  let status = 200;
  const headers = {};
  const chunks = [];

  return {
    writeHead(nextStatus, nextHeaders = {}) {
      status = nextStatus;
      Object.assign(headers, nextHeaders);
    },
    end(body) {
      if (body !== undefined && body !== null) {
        chunks.push(Buffer.isBuffer(body) ? body : Buffer.from(String(body)));
      }
    },
    toResponse() {
      const body = status === 204 || status === 304 ? null : Buffer.concat(chunks);

      return new Response(body, {
        status,
        headers
      });
    }
  };
}
