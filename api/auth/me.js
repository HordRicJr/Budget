import { requireOwner } from '../_lib/auth.js';
import { sendJson } from '../_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    return res.end(JSON.stringify({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Méthode non autorisée.' } }));
  }

  const ownerId = await requireOwner(req, res);
  if (!ownerId) return;
  return sendJson(res, 200, { data: { authenticated: true } });
}
