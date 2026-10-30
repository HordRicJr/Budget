import { createHash, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { createSession, sessionCookie } from '../_lib/auth.js';
import { getSql } from '../_lib/db.js';
import { isSameOrigin, readJson, sendError, sendJson } from '../_lib/http.js';

const scrypt = promisify(scryptCallback);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
  }
  if (!isSameOrigin(req)) return sendError(res, 403, 'ORIGIN_REJECTED', 'Origine de requête refusée.');

  const input = await readJson(req, res);
  if (!input) return;
  const email = typeof input.email === 'string' ? input.email.trim().toLowerCase() : '';
  const password = typeof input.password === 'string' ? input.password : '';

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 1 || password.length > 200) {
    return sendError(res, 400, 'INVALID_CREDENTIALS', 'Adresse courriel ou mot de passe invalide.');
  }

  const identityHash = createHash('sha256').update(`email:${email}`).digest('hex');
  const sql = getSql();
  await sql`DELETE FROM auth_login_throttle WHERE updated_at < now() - interval '30 days'`;
  const [attempt] = await sql`
    INSERT INTO auth_login_throttle (identity_hash, window_started_at, attempt_count, updated_at)
    VALUES (${identityHash}, now(), 1, now())
    ON CONFLICT (identity_hash) DO UPDATE SET
      attempt_count = CASE
        WHEN auth_login_throttle.window_started_at <= now() - interval '15 minutes' THEN 1
        ELSE auth_login_throttle.attempt_count + 1
      END,
      window_started_at = CASE
        WHEN auth_login_throttle.window_started_at <= now() - interval '15 minutes' THEN now()
        ELSE auth_login_throttle.window_started_at
      END,
      updated_at = now()
    RETURNING attempt_count
  `;
  if (attempt.attempt_count > 10) {
    return sendError(res, 429, 'LOGIN_THROTTLED', 'Trop de tentatives. Réessayez dans quelques minutes.');
  }

  const [user] = await sql`SELECT id, password_hash FROM app_user WHERE email = ${email} LIMIT 1`;
  let valid = false;
  if (user?.password_hash) {
    const [salt, savedHash] = user.password_hash.split(':');
    if (salt && savedHash && /^[a-f0-9]{32}$/.test(salt) && /^[a-f0-9]{128}$/.test(savedHash)) {
      const derived = await scrypt(password, salt, 64);
      valid = timingSafeEqual(Buffer.from(savedHash, 'hex'), derived);
    }
  }

  if (!valid) {
    return sendError(res, 401, 'INVALID_CREDENTIALS', 'Adresse courriel ou mot de passe incorrect.');
  }

  await sql`DELETE FROM auth_login_throttle WHERE identity_hash = ${identityHash}`;
  const token = await createSession(user.id);
  return sendJson(res, 200, { data: { authenticated: true } }, {
    'Set-Cookie': sessionCookie(token),
  });
}
