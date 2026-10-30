import { clearedSessionCookie, deleteSession } from '../_lib/auth.js';
import { isSameOrigin, sendError, sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
  }
  if (!isSameOrigin(req)) return sendError(res, 403, 'ORIGIN_REJECTED', 'Origine de requête refusée.');

  await deleteSession(req);
  return sendJson(res, 200, { data: { authenticated: false } }, {
    'Set-Cookie': clearedSessionCookie(),
  });
}
