import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import handler from './scenarios.js';
import { setSqlForTests } from './_lib/db.js';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const itemId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const token = 'a'.repeat(64);
const key = 'scenario-retry-key-2026';
const responseData = { scenarioId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd', result: { applied: true } };

function installSqlMock({ prior = null, changeVersion = false, totals = {
  incomeXof: '200000', expensesXof: '0', plannedXof: '100000',
} } = {}) {
  const calls = [];
  let saved = prior;
  setSqlForTests(async (parts, ...values) => {
    const query = parts.join('?');
    calls.push({ query, values });
    if (query.includes('FROM auth_session')) return [{ owner_id: ownerId }];
    if (query.includes('FROM idempotency_record')) return saved ? [saved] : [];
    if (query.includes('WITH action_input AS MATERIALIZED')) {
      saved = {
        requestHash: values.find((value) => typeof value === 'string' && value === expectedRequestHash),
        response: responseData,
      };
      return [{ response: responseData }];
    }
    if (query.includes('FROM unexpected_event')) return [{
      id: eventId, title: 'Panne moto', amountXof: '30000', urgency: 5,
      version: changeVersion ? 2 : 1, status: 'open',
    }];
    if (query.includes('SELECT fi.id')) return [{
      id: itemId, name: 'Abonnement privé', plannedAmountXof: '50000', dueOn: '2026-11-18',
      cadence: 'monthly', priority: 2, deferralImpact: 'Pénalité contractuelle',
      status: 'active', version: 1,
    }];
    if (query.includes('AS "incomeXof"')) return [totals];
    if (query.includes('FROM financial_item')) return [];
    throw new Error(`Requête non simulée: ${query}`);
  });
  return calls;
}

function makeRequest(body, extraHeaders = {}) {
  return {
    method: 'POST',
    headers: {
      cookie: `budget_session=${token}`,
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
      ...extraHeaders,
    },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); },
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

let expectedRequestHash = '';

test('simule plusieurs impacts XOF sans muter de données financières', async () => {
  const calls = installSqlMock();
  const response = makeResponse();
  await handler(makeRequest({ action: 'simulate', eventId, month: '2026-11' }), response);
  assert.equal(response.statusCode, 200);
  const result = response.json().data;
  assert.ok(result.candidates.length > 1);
  assert.equal(result.availableBeforeXof, 100000);
  assert.equal(result.event.amountXof, 30000);
  assert.ok(result.candidates.some((candidate) => candidate.availableAfterXof === 70000));
  assert.ok(result.candidates.some((candidate) => candidate.actions.some((action) => action.consequence === 'Pénalité contractuelle')));
  assert.equal(calls.some(({ query }) => /\b(INSERT|UPDATE|DELETE)\s/i.test(query)), false);
  const budgetQuery = calls.find(({ query }) => query.includes('AS "incomeXof"'));
  assert.ok(budgetQuery.query.includes("status <> 'paid' AND financial_item_id IS NULL"));
});

test('rejette une simulation lorsque le montant du contexte dépasse la précision sûre', async () => {
  const calls = installSqlMock();
  setSqlForTests(async (parts, ...values) => {
    const query = parts.join('?');
    calls.push({ query, values });
    if (query.includes('FROM auth_session')) return [{ owner_id: ownerId }];
    if (query.includes('FROM unexpected_event')) return [{ id: eventId, amountXof: String(Number.MAX_SAFE_INTEGER + 2), status: 'open', version: 1 }];
    if (query.includes('AS "incomeXof"')) return [{ incomeXof: '0', expensesXof: '0', plannedXof: '0' }];
    if (query.includes('SELECT fi.id')) return [];
    return [];
  });
  const response = makeResponse();
  await handler(makeRequest({ action: 'simulate', eventId, month: '2026-11' }), response);
  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'AMOUNT_OUT_OF_RANGE');
});

test('applique une option dans un unique statement atomique et retourne le même résultat au retry', async () => {
  const calls = installSqlMock();
  const simulated = makeResponse();
  await handler(makeRequest({ action: 'simulate', eventId, month: '2026-11' }), simulated);
  const proposal = simulated.json().data;
  const chosen = proposal.candidates.find((candidate) => candidate.actions.some((action) => action.action !== 'allocate') && candidate.admissible);
  assert.ok(chosen);
  const input = {
    eventId,
    month: '2026-11',
    candidateId: chosen.id,
    dataVersion: proposal.dataVersion,
  };
  expectedRequestHash = createHash('sha256').update(JSON.stringify(input)).digest('hex');
  const confirmation = { action: 'confirm', ...input, idempotencyKey: key };
  const response = makeResponse();
  await handler(makeRequest(confirmation, { 'idempotency-key': key }), response);
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data, responseData);
  const atomic = calls.find(({ query }) => query.includes('WITH action_input AS MATERIALIZED'));
  assert.ok(atomic);
  for (const statement of ['locked_event AS MATERIALIZED', 'locked_items AS MATERIALIZED', 'UPDATE financial_item', 'UPDATE unexpected_event', 'INSERT INTO scenario', 'INSERT INTO scenario_action', 'INSERT INTO idempotency_record']) {
    assert.ok(atomic.query.includes(statement), statement);
  }

  const retry = makeResponse();
  await handler(makeRequest(confirmation, { 'idempotency-key': key }), retry);
  assert.equal(retry.statusCode, 200);
  assert.equal(retry.json().replayed, true);
  assert.deepEqual(retry.json().data, responseData);
});

test('rejette un scénario périmé sans exécuter le statement d’application', async () => {
  const calls = installSqlMock({ changeVersion: true });
  const response = makeResponse();
  await handler(makeRequest({
    action: 'confirm',
    eventId,
    month: '2026-11',
    candidateId: 'use-available-balance',
    dataVersion: 'b'.repeat(64),
    idempotencyKey: key,
  }), response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'VERSION_CONFLICT');
  assert.equal(calls.some(({ query }) => query.includes('WITH action_input AS MATERIALIZED')), false);
});

test('confirme atomiquement une affectation du solde sans modifier un engagement', async () => {
  const calls = installSqlMock();
  const input = {
    eventId,
    month: '2026-11',
    candidateId: 'use-available-balance',
  };
  const simulated = makeResponse();
  await handler(makeRequest({ action: 'simulate', eventId, month: input.month }), simulated);
  const proposal = simulated.json().data;
  assert.ok(proposal.candidates.some((candidate) => candidate.id === input.candidateId));
  expectedRequestHash = createHash('sha256').update(JSON.stringify({ ...input, dataVersion: proposal.dataVersion })).digest('hex');
  const response = makeResponse();
  await handler(makeRequest({
    action: 'confirm',
    ...input,
    dataVersion: proposal.dataVersion,
    idempotencyKey: `${key}-allocate`,
  }, { 'idempotency-key': `${key}-allocate` }), response);
  assert.equal(response.statusCode, 200);
  const atomic = calls.find(({ query }) => query.includes('WITH action_input AS MATERIALIZED'));
  assert.ok(atomic);
  assert.match(atomic.query, /COUNT\(\*\) FROM action_input WHERE item_id IS NOT NULL/);
});

test('refuse côté serveur une option qui laisserait un solde négatif', async () => {
  const calls = installSqlMock({ totals: { incomeXof: '0', expensesXof: '100000', plannedXof: '100000' } });
  const simulated = makeResponse();
  await handler(makeRequest({ action: 'simulate', eventId, month: '2026-11' }), simulated);
  const proposal = simulated.json().data;
  const candidate = proposal.candidates.find((option) => !option.admissible);
  assert.ok(candidate);
  const response = makeResponse();
  await handler(makeRequest({
    action: 'confirm', eventId, month: '2026-11', candidateId: candidate.id,
    dataVersion: proposal.dataVersion, idempotencyKey: key,
  }, { 'idempotency-key': key }), response);
  assert.equal(response.statusCode, 409);
  assert.equal(response.json().error.code, 'SCENARIO_NOT_ADMISSIBLE');
  assert.equal(calls.some(({ query }) => query.includes('WITH action_input AS MATERIALIZED')), false);
});
