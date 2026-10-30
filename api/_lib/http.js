export function sendJson(res, status, body, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  });
  res.end(JSON.stringify(body));
}

export function sendError(res, status, code, message) {
  sendJson(res, status, { error: { code, message } });
}

export async function readJson(req, res) {
  let raw = '';
  let bytes = 0;
  for await (const chunk of req) {
    bytes += Buffer.byteLength(chunk);
    if (bytes > 16_384) {
      sendError(res, 413, 'PAYLOAD_TOO_LARGE', 'La requête est trop volumineuse.');
      return null;
    }
    raw += chunk;
  }

  try {
    return JSON.parse(raw || '{}');
  } catch {
    sendError(res, 400, 'INVALID_JSON', 'Le format de la requête est invalide.');
    return null;
  }
}

export function isSameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;

  try {
    return new URL(origin).host === req.headers.host;
  } catch {
    return false;
  }
}

export function parseCookies(header = '') {
  return Object.fromEntries(
    header
      .split(';')
      .map((item) => item.trim().split(/=(.*)/s, 2))
      .filter(([name, value]) => name && value !== undefined)
      .map(([name, value]) => {
        try {
          return [name, decodeURIComponent(value)];
        } catch {
          return [name, ''];
        }
      }),
  );
}
