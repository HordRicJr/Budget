import { createHash, randomBytes } from 'node:crypto';
import { getSql } from './db.js';
import { parseCookies, sendError } from './http.js';

const SESSION_COOKIE = 'budget_session';
const SESSION_DAYS = 7;

export async function requireOwner(req, res) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Connectez-vous pour accéder à votre budget.');
    return null;
  }

  const sql = getSql();
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const [session] = await sql`
    SELECT owner_id
    FROM auth_session
    WHERE token_hash = ${tokenHash} AND expires_at > now()
    LIMIT 1
  `;

  if (!session) {
    sendError(res, 401, 'UNAUTHENTICATED', 'Votre session a expiré. Reconnectez-vous.');
    return null;
  }

  return session.owner_id;
}

export async function createSession(ownerId) {
  const token = randomBytes(32).toString('hex');
  const tokenHash = createHash('sha256').update(token).digest('hex');
  const sql = getSql();
  await sql`DELETE FROM auth_session WHERE expires_at <= now()`;
  await sql`
    INSERT INTO auth_session (token_hash, owner_id, expires_at)
    VALUES (${tokenHash}, ${ownerId}, now() + (${SESSION_DAYS} * interval '1 day'))
  `;
  return token;
}

export async function deleteSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token || !/^[a-f0-9]{64}$/.test(token)) return;

  const tokenHash = createHash('sha256').update(token).digest('hex');
  const sql = getSql();
  await sql`DELETE FROM auth_session WHERE token_hash = ${tokenHash}`;
}

export function sessionCookie(token, secure = process.env.NODE_ENV === 'production') {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict; Max-Age=${SESSION_DAYS * 86400}${secure ? '; Secure' : ''}`;
}

export function clearedSessionCookie(secure = process.env.NODE_ENV === 'production') {
  return `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
}
