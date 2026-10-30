import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './unexpected-events.js';
import { setSqlForTests } from './_lib/db.js';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const token = 'a'.repeat(64);

function installSqlMock() {
  const calls = [];
  setSqlForTests(async (parts, ...values) => {
    const query = parts.join('?');
    calls.push({ query, values });
    if (query.includes('FROM auth_session')) return [{ owner_id: ownerId }];
    if (query.includes('INSERT INTO unexpected_event')) return [{
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Panne', amountXof: '25000',
      occurredOn: '2026-11-01', dueOn: '2026-11-03', urgency: 5, note: 'Privé',
      status: 'open', version: 1,
    }];
    if (query.includes('UPDATE unexpected_event SET')) return [{
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', title: 'Panne', amountXof: '25000',
      occurredOn: '2026-11-01', dueOn: '2026-11-03', urgency: 5, note: 'Privé',
      status: 'resolved', version: 2,
    }];
    if (query.includes('DELETE FROM unexpected_event')) return [{ id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }];
    throw new Error(`Requête non simulée: ${query}`);
  });
  return calls;
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

function request(body, origin = 'http://localhost:3000') {
  return {
    method: 'POST',
    headers: { cookie: `budget_session=${token}`, origin, host: 'localhost:3000' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
  };
}

function patchRequest(method, body) {
  return {
    method,
    headers: { cookie: `budget_session=${token}`, origin: 'http://localhost:3000', host: 'localhost:3000' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
  };
}

test('crée un imprévu avec montant XOF validé et session propriétaire', async () => {
  const calls = installSqlMock();
  const response = makeResponse();
  await handler(request({ title: 'Panne', amountXof: 25000, occurredOn: '2026-11-01', dueOn: '2026-11-03', urgency: 5, note: 'Privé' }), response);
  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.amountXof, 25000);
  const insert = calls.find(({ query }) => query.includes('INSERT INTO unexpected_event'));
  assert.ok(insert.values.includes(ownerId));
});

test('rejette une date impossible, un montant non entier et une origine étrangère', async () => {
  const calls = installSqlMock();
  const invalid = makeResponse();
  await handler(request({ title: 'Panne', amountXof: 2.5, occurredOn: '2026-02-30', urgency: 3 }), invalid);
  assert.equal(invalid.statusCode, 400);
  assert.equal(calls.some(({ query }) => query.includes('INSERT INTO unexpected_event')), false);
  const crossOrigin = makeResponse();
  await handler(request({ title: 'Panne', amountXof: 1, occurredOn: '2026-11-01', urgency: 2 }, 'https://other.invalid'), crossOrigin);
  assert.equal(crossOrigin.statusCode, 403);
});

test('met à jour ou supprime un imprévu avec sa version et son propriétaire', async () => {
  const calls = installSqlMock();
  const updated = makeResponse();
  await handler(patchRequest('PATCH', {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', version: 1, status: 'resolved',
  }), updated);
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().data.version, 2);
  const updateQuery = calls.find(({ query }) => query.includes('UPDATE unexpected_event SET'));
  assert.ok(updateQuery.values.includes(ownerId));
  assert.ok(updateQuery.values.includes(1));

  const deleted = makeResponse();
  await handler(patchRequest('DELETE', {
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', version: 1,
  }), deleted);
  assert.equal(deleted.statusCode, 200);
  assert.ok(calls.some(({ query }) => query.includes('NOT EXISTS (SELECT 1 FROM scenario')));
});
