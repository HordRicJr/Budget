import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './export.js';
import { setSqlForTests } from './_lib/db.js';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'a'.repeat(64);

function installSqlMock({ fail = false } = {}) {
  const calls = [];
  setSqlForTests(async (parts, ...values) => {
    const query = parts.join('?');
    calls.push({ query, values });
    if (query.includes('FROM auth_session')) return [{ owner_id: ownerId }];
    if (fail && query.includes('FROM recommendation')) throw new Error('database unavailable');
    return [];
  });
  return calls;
}

function request(body) {
  return {
    method: 'POST',
    headers: { cookie: `budget_session=${token}`, origin: 'http://localhost:3000', host: 'localhost:3000' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
  };
}

function response() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body = body; },
    json() { return JSON.parse(this.body); },
  };
}

test('requiert une confirmation explicite avant un export', async () => {
  const calls = installSqlMock();
  const result = response();
  await handler(request({ confirm: false }), result);
  assert.equal(result.statusCode, 400);
  assert.equal(calls.filter(({ query }) => query.includes('FROM auth_session')).length, 1);
});

test('exporte uniquement les lignes du propriétaire et ne met pas le contenu en cache', async () => {
  const calls = installSqlMock();
  const result = response();
  await handler(request({ confirm: true }), result);
  assert.equal(result.statusCode, 200);
  assert.equal(result.headers['Content-Disposition'], 'attachment; filename="budget-export.json"');
  assert.equal(result.headers['Cache-Control'], 'no-store');
  assert.equal(calls.length, 7);
  for (const call of calls.slice(1)) assert.ok(call.values.includes(ownerId));
  assert.deepEqual(Object.keys(result.json()).sort(), [
    'categories', 'currencyCode', 'exportedAt', 'financialItems', 'recommendations',
    'scenarios', 'timezone', 'transactions', 'unexpectedEvents',
  ].sort());
});

test('renvoie un refus explicite si une partie des données ne peut pas être exportée', async () => {
  installSqlMock({ fail: true });
  const result = response();
  await handler(request({ confirm: true }), result);
  assert.equal(result.statusCode, 503);
  assert.equal(result.json().error.code, 'EXPORT_FAILED');
});
