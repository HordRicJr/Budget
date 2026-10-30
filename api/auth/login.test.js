import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import handler from './login.js';
import { setSqlForTests } from '../_lib/db.js';

const scrypt = promisify(scryptCallback);

function makeRequest(body) {
  return {
    method: 'POST',
    headers: {
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      'x-forwarded-for': '203.0.113.1, 198.51.100.8',
    },
    socket: { remoteAddress: '127.0.0.1' },
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify(body));
    },
  };
}

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    setHeader(name, value) {
      this.headers[name] = value;
    },
    end(body = '') {
      this.body = body;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

test('authentifie le propriétaire, crée une session et renvoie un cookie protégé', async () => {
  const password = 'un-mot-de-passe-test';
  const email = 'assoun@example.com';
  const salt = randomBytes(16).toString('hex');
  const passwordHash = Buffer.from(await scrypt(password, salt, 64)).toString('hex');
  const calls = [];
  setSqlForTests(async (parts, ...values) => {
    const query = parts.join('?');
    calls.push({ query, values });
    if (query.includes('DELETE FROM auth_login_throttle')) return [];
    if (query.includes('INSERT INTO auth_login_throttle')) return [{ attempt_count: 1 }];
    if (query.includes('SELECT id, password_hash FROM app_user')) {
      return [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', password_hash: `${salt}:${passwordHash}` }];
    }
    if (query.includes('DELETE FROM auth_session')) return [];
    if (query.includes('INSERT INTO auth_session')) return [];
    throw new Error(`Requête non simulée dans ce test: ${query}`);
  });
  const response = makeResponse();

  await handler(makeRequest({ email, password }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), { data: { authenticated: true } });
  assert.match(response.headers['Set-Cookie'], /^budget_session=[a-f0-9]{64}; HttpOnly; Path=\/; SameSite=Strict; Max-Age=/);
  assert.ok(calls.some(({ query }) => query.includes('DELETE FROM auth_session')));
  assert.ok(calls.some(({ query }) => query.includes('INSERT INTO auth_session')));
  const throttleQuery = calls.find(({ query }) => query.includes('INSERT INTO auth_login_throttle'));
  assert.ok(throttleQuery);
  assert.equal(
    throttleQuery.values[0],
    createHash('sha256').update(`email:${email}`).digest('hex'),
  );
  assert.ok(calls.some(({ query }) => query.includes('DELETE FROM auth_login_throttle WHERE identity_hash')));
});
