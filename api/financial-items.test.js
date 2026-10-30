import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './financial-items.js';
import { setSqlForTests } from './_lib/db.js';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token = 'a'.repeat(64);

function installSqlMock({ updated = true } = {}) {
  const calls = [];
  const mock = async (parts, ...values) => {
    const query = parts.join('?');
    calls.push({ query, values });
    if (query.includes('FROM auth_session')) return [{ owner_id: ownerId }];
    if (query.includes('FROM financial_item') && query.includes('version = ?')) return [{
      id: itemId, kind: 'debt', name: 'Moto', targetAmountXof: '90000',
      remainingAmountXof: '60000', plannedAmountXof: '12000', dueOn: '2026-11-15',
      cadence: 'monthly', priority: 4, deferralImpact: 'Frais de retard', status: 'active', version: 1,
    }];
    if (query.includes('INSERT INTO financial_item')) return [{
      id: itemId, kind: 'debt', name: 'Moto', targetAmountXof: '90000',
      remainingAmountXof: '60000', plannedAmountXof: '12000', dueOn: '2026-11-15',
      cadence: 'monthly', priority: 4, deferralImpact: 'Frais de retard', status: 'active', version: 1,
    }];
    if (query.includes('UPDATE financial_item SET')) return updated ? [{
      id: itemId, kind: 'debt', name: 'Moto', targetAmountXof: '90000',
      remainingAmountXof: '60000', plannedAmountXof: '15000', dueOn: '2026-11-20',
      cadence: 'monthly', priority: 5, deferralImpact: 'Frais', status: 'active', version: 2,
    }] : [];
    if (query.includes('SELECT id FROM financial_item')) return [{ id: itemId }];
    if (query.includes('DELETE FROM financial_item')) return [{ id: itemId }];
    throw new Error(`Requête non simulée: ${query}`);
  };
  mock.unsafe = (value) => value;
  setSqlForTests(mock);
  return calls;
}

function makeRequest({ method = 'POST', body = {}, cookie = `budget_session=${token}` } = {}) {
  return {
    method,
    headers: { cookie, origin: 'http://localhost:3000', host: 'localhost:3000' },
    async *[Symbol.asyncIterator]() {
      if (method !== 'GET') yield Buffer.from(JSON.stringify(body));
    },
  };
}

function makeResponse() {
  return {
    statusCode: 0, headers: {}, body: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers; },
    setHeader(name, value) { this.headers[name] = value; },
    end(body = '') { this.body = body; },
    json() { return JSON.parse(this.body); },
  };
}

test('crée un engagement validé sous le propriétaire de la session', async () => {
  const calls = installSqlMock();
  const response = makeResponse();
  await handler(makeRequest({ body: {
    kind: 'debt', name: 'Moto', plannedAmountXof: 12000, targetAmountXof: 90000,
    remainingAmountXof: 60000, dueOn: '2026-11-15', cadence: 'monthly',
    priority: 4, deferralImpact: 'Frais de retard', ownerId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  } }), response);
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.plannedAmountXof, 12000);
  const insert = calls.find(({ query }) => query.includes('INSERT INTO financial_item'));
  assert.ok(insert.values.includes(ownerId));
  assert.equal(insert.values.includes('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'), false);
});

test('rejette un montant ou une date invalide avant toute écriture', async () => {
  const calls = installSqlMock();
  const response = makeResponse();
  await handler(makeRequest({ body: { kind: 'debt', name: 'Moto', plannedAmountXof: -2, priority: 2, dueOn: '2026-13-40' } }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(calls.some(({ query }) => query.includes('INSERT INTO financial_item')), false);
});

test('met à jour une version attendue et refuse une version périmée', async () => {
  const calls = installSqlMock();
  const response = makeResponse();
  await handler(makeRequest({ method: 'PATCH', body: { id: itemId, version: 1, priority: 5, plannedAmountXof: 15000, dueOn: '2026-11-20' } }), response);
  assert.equal(response.statusCode, 200);
  const update = calls.find(({ query }) => query.includes('UPDATE financial_item SET'));
  assert.ok(update.values.includes(ownerId));
  assert.ok(update.values.includes(1));

  installSqlMock({ updated: false });
  const stale = makeResponse();
  await handler(makeRequest({ method: 'PATCH', body: { id: itemId, version: 1, priority: 5 } }), stale);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().error.code, 'VERSION_CONFLICT');
});

test('rejette un champ inconnu dans une mise à jour avant toute lecture ou écriture', async () => {
  const calls = installSqlMock();
  const response = makeResponse();
  await handler(makeRequest({
    method: 'PATCH',
    body: { id: itemId, version: 1, priority: 5, unexpectedField: true },
  }), response);
  assert.equal(response.statusCode, 400);
  assert.equal(calls.some(({ query }) => query.includes('FROM financial_item')), false);
  assert.equal(calls.some(({ query }) => query.includes('UPDATE financial_item SET')), false);
});

test('exige une session avant de lire les engagements', async () => {
  const calls = installSqlMock();
  const response = makeResponse();
  await handler(makeRequest({ cookie: '' }), response);
  assert.equal(response.statusCode, 401);
  assert.equal(calls.length, 0);
});
