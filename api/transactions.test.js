import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './transactions.js';
import { setSqlForTests } from './_lib/db.js';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const otherOwnerId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const categoryId = '01234567-89ab-4def-8123-456789abcdef';
const sessionToken = 'a'.repeat(64);

function installSqlMock({
  category = { id: categoryId },
  financialItem = { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' },
  transactions = [],
  totals = { incomeXof: '10000', plannedIncomeXof: '3000', expensesXof: '2500', plannedXof: '1000' },
} = {}) {
  const calls = [];
  setSqlForTests(async (parts, ...values) => {
    const query = parts.join('?');
    calls.push({ query, values });
    if (query.includes('FROM auth_session')) return [{ owner_id: ownerId }];
    if (query.includes('SUM(amount_xof)')) return [totals];
    if (query.includes('FROM financial_item')) return financialItem ? [financialItem] : [];
    if (query.includes('FROM category')) return category ? [category] : [];
    if (query.includes('INSERT INTO financial_transaction')) {
      return [{
        id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        kind: 'expense',
        categoryId,
        amountXof: 2500,
        occurredOn: '2026-10-29',
        dueOn: null,
        payee: 'Marché',
        note: null,
        status: 'paid',
      }];
    }
    if (query.includes('FROM financial_transaction t')) return transactions;
    if (query.includes('FROM financial_transaction')) {
      return [totals];
    }
    throw new Error(`Requête non simulée dans ce test: ${query}`);
  });
  return calls;
}

function makeRequest({ method = 'POST', body = {}, cookie = `budget_session=${sessionToken}`, query = {} } = {}) {
  return {
    method,
    query,
    headers: {
      cookie,
      origin: 'http://localhost:3000',
      host: 'localhost:3000',
    },
    async *[Symbol.asyncIterator]() {
      if (method === 'POST') yield Buffer.from(JSON.stringify(body));
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

const validPayload = {
  kind: 'expense',
  categoryId,
  amountXof: 2500,
  occurredOn: '2026-10-29',
  payee: 'Marché',
  status: 'paid',
};

test('refuse une session absente sans consulter les données', async () => {
  const calls = installSqlMock();
  const response = makeResponse();

  await handler(makeRequest({ cookie: '' }), response);

  assert.equal(response.statusCode, 401);
  assert.equal(response.json().error.code, 'UNAUTHENTICATED');
  assert.equal(calls.length, 0);
});

test('rejette un montant invalide sans écrire en base', async () => {
  const calls = installSqlMock();
  const response = makeResponse();

  await handler(makeRequest({ body: { ...validPayload, amountXof: 0 } }), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'INVALID_TRANSACTION');
  assert.equal(calls.some(({ query }) => query.includes('INSERT INTO financial_transaction')), false);
});

test('crée une transaction et lie le propriétaire issu de la session', async () => {
  const calls = installSqlMock();
  const response = makeResponse();

  await handler(makeRequest({ body: { ...validPayload, ownerId: otherOwnerId } }), response);

  assert.equal(response.statusCode, 201);
  assert.equal(response.json().data.amountXof, 2500);
  const insert = calls.find(({ query }) => query.includes('INSERT INTO financial_transaction'));
  assert.ok(insert);
  assert.ok(insert.values.includes(ownerId));
  assert.equal(insert.values.includes(otherOwnerId), false);
});

test('refuse la catégorie qui ne correspond pas au propriétaire authentifié', async () => {
  const calls = installSqlMock({ category: null });
  const response = makeResponse();

  await handler(makeRequest({ body: validPayload }), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'INVALID_CATEGORY');
  const categoryQuery = calls.find(({ query }) => query.includes('FROM category'));
  assert.ok(categoryQuery.query.includes('owner_id = ? AND kind = ?'));
  assert.ok(categoryQuery.values.includes(ownerId));
  assert.ok(categoryQuery.values.includes(validPayload.kind));
});

test('lie uniquement une dépense à un engagement actif du même propriétaire', async () => {
  const linkedId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const calls = installSqlMock();
  const response = makeResponse();
  await handler(makeRequest({ body: { ...validPayload, financialItemId: linkedId } }), response);
  assert.equal(response.statusCode, 201);
  const insert = calls.find(({ query }) => query.includes('INSERT INTO financial_transaction'));
  assert.ok(insert.values.includes(linkedId));

  const unauthorizedCalls = installSqlMock({ financialItem: null });
  const unauthorized = makeResponse();
  await handler(makeRequest({ body: { ...validPayload, financialItemId: linkedId } }), unauthorized);
  assert.equal(unauthorized.statusCode, 400);
  assert.equal(unauthorized.json().error.code, 'INVALID_FINANCIAL_ITEM');
  assert.equal(unauthorizedCalls.some(({ query }) => query.includes('INSERT INTO financial_transaction')), false);
});

test('renvoie le total mensuel complet calculé côté serveur', async () => {
  const calls = installSqlMock();
  const response = makeResponse();

  await handler(makeRequest({ method: 'GET', query: { month: '2026-10' } }), response);

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json().data.summary, {
    incomeXof: 10000,
    plannedIncomeXof: 3000,
    expensesXof: 2500,
    plannedXof: 1000,
    availableXof: 6500,
  });
  const rangeQueries = calls.filter(({ query }) => query.includes('FROM financial_transaction'));
  assert.equal(rangeQueries.length, 2);
  for (const { values } of rangeQueries) {
    assert.ok(values.includes('2026-10-01'));
    assert.ok(values.includes('2026-11-01'));
  }
  const aggregateQuery = rangeQueries.find(({ query }) => query.includes('SUM(amount_xof)'));
  assert.ok(aggregateQuery);
  assert.match(aggregateQuery.query, /kind = 'income' AND status = 'paid'/);
  assert.match(aggregateQuery.query, /kind = 'income' AND status <> 'paid'/);
  assert.match(aggregateQuery.query, /kind = 'expense' AND status = 'paid'/);
  assert.match(aggregateQuery.query, /kind = 'expense' AND status <> 'paid'/);
  assert.match(aggregateQuery.query, /COALESCE\(due_on, occurred_on\)/);
  assert.match(aggregateQuery.query, /status <> 'paid' AND financial_item_id IS NULL/);
  assert.match(rangeQueries[0].query, /ORDER BY\s+CASE WHEN t\.status = 'paid'/);
});

test('refuse un solde agrégé hors de la plage entière sûre', async () => {
  installSqlMock({
    totals: {
      incomeXof: '0',
      plannedIncomeXof: '0',
      expensesXof: String(Number.MAX_SAFE_INTEGER),
      plannedXof: '1',
    },
  });
  const response = makeResponse();

  await handler(makeRequest({ method: 'GET', query: { month: '2026-10' } }), response);

  assert.equal(response.statusCode, 422);
  assert.equal(response.json().error.code, 'AMOUNT_OUT_OF_RANGE');
});

test('expose la pagination et limite chaque page à 100 mouvements', async () => {
  const transactions = Array.from({ length: 101 }, (_, index) => ({ id: `row-${index}`, amountXof: '100' }));
  installSqlMock({ transactions });
  const response = makeResponse();

  await handler(makeRequest({ method: 'GET', query: { month: '2026-10', offset: '0' } }), response);

  assert.equal(response.statusCode, 200);
  assert.equal(response.json().data.transactions.length, 100);
  assert.deepEqual(response.json().data.pagination, {
    offset: 0,
    limit: 100,
    hasMore: true,
    nextOffset: 100,
  });
});

test('rejette un décalage invalide avant toute requête de liste', async () => {
  const calls = installSqlMock();
  const response = makeResponse();

  await handler(makeRequest({ method: 'GET', query: { month: '2026-10', offset: '-1' } }), response);

  assert.equal(response.statusCode, 400);
  assert.equal(response.json().error.code, 'INVALID_OFFSET');
  assert.equal(calls.some(({ query }) => query.includes('FROM financial_transaction')), false);
});
