import { requireOwner } from './_lib/auth.js';
import { getSql } from './_lib/db.js';
import { sendError, sendJson } from './_lib/http.js';

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
  }

  const ownerId = await requireOwner(req, res);
  if (!ownerId) return;

  const sql = getSql();
  const categories = await sql`
    SELECT id, name, kind
    FROM category
    WHERE owner_id = ${ownerId}
    ORDER BY kind, name
  `;
  return sendJson(res, 200, { data: categories });
}
