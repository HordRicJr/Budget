import test from 'node:test';
import assert from 'node:assert/strict';
import handler from './recommendations.js';
import { setSqlForTests } from './_lib/db.js';

const ownerId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const eventId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const token = 'a'.repeat(64);

function installSqlMock({ totals = { incomeXof: '100000', expensesXof: '0', plannedXof: '20000' } } = {}) {
  const calls = [];
  setSqlForTests(async (parts, ...values) => {
    const query = parts.join('?');
    calls.push({ query, values });
    if (query.includes('FROM auth_session')) return [{ owner_id: ownerId }];
    if (query.includes('FROM unexpected_event')) return [{
      id: eventId, title: 'Panne secrète', amountXof: '25000', urgency: 4, version: 1, status: 'open',
    }];
    if (query.includes('SELECT fi.id')) return [{
      id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', name: 'Nom privé',
      plannedAmountXof: '20000', dueOn: '2026-11-15', cadence: 'monthly', priority: 2,
      deferralImpact: 'Frais de retard', status: 'active', version: 1,
    }];
    if (query.includes('AS "incomeXof"')) return [totals];
    if (query.includes('INSERT INTO recommendation')) return [];
    if (query.includes('INSERT INTO groq_request_throttle')) return [{ requestCount: 1 }];
    throw new Error(`Requête non simulée: ${query}`);
  });
  return calls;
}

function makeRequest() {
  return {
    method: 'POST',
    headers: { cookie: `budget_session=${token}`, origin: 'http://localhost:3000', host: 'localhost:3000' },
    async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify({ eventId, month: '2026-11' })); },
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

function jsonResponse(body) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
  });
}

test('sans clé Groq, retourne le classement déterministe et stocke un contexte minimisé', async () => {
  const oldKey = process.env.GROQ_API_KEY;
  delete process.env.GROQ_API_KEY;
  const calls = installSqlMock();
  const response = makeResponse();
  try {
    await handler(makeRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.source, 'rules');
    assert.equal(response.json().data.aiStatus, 'disabled');
    const insert = calls.find(({ query }) => query.includes('INSERT INTO recommendation'));
    assert.ok(insert.values.includes(ownerId));
    const snapshot = insert.values.find((value) => typeof value === 'string' && value.includes('"budget"'));
    assert.ok(snapshot);
    assert.equal(snapshot.includes('Panne secrète'), false);
    assert.equal(snapshot.includes('Nom privé'), false);
    assert.equal(snapshot.includes('Note à exclure'), false);
    assert.equal(snapshot.includes('cccccccc-cccc-4ccc-8ccc-cccccccccccc'), false);
  } finally {
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  }
});

test('Groq timeout ou réponse invalide garde le secours déterministe sans inventer de succès', async () => {
  const oldKey = process.env.GROQ_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  const calls = installSqlMock();
  globalThis.fetch = async () => jsonResponse({
    choices: [{ message: { content: '{"options":[{"candidateId":"unknown","explanation":"inventé"}]}' } }],
  });
  const response = makeResponse();
  try {
    await handler(makeRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.source, 'rules');
    assert.equal(response.json().data.aiStatus, 'unavailable');
    assert.equal(calls.some(({ query }) => query.includes('INSERT INTO recommendation')), true);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  }
});

test('n’envoie jamais à Groq une option de déficit non admissible', async () => {
  const oldKey = process.env.GROQ_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  let sentOptions = [];
  let sentModel;
  installSqlMock({ totals: { incomeXof: '50000', expensesXof: '0', plannedXof: '30000' } });
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    sentModel = body.model;
    sentOptions = JSON.parse(body.messages[1].content).options;
    return jsonResponse({
      choices: [{ message: { content: JSON.stringify({
        options: sentOptions.map(({ candidateId }) => ({ candidateId, explanation: 'Option analysée.' })),
      }) } }],
    });
  };
  const response = makeResponse();
  try {
    await handler(makeRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.source, 'groq');
    assert.equal(sentModel, 'openai/gpt-oss-20b');
    assert.ok(sentOptions.length > 0);
    assert.equal(sentOptions.some(({ candidateId }) => candidateId === 'use-available-balance'), false);
    assert.equal(response.json().data.recommendations.length, sentOptions.length);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  }
});

test('rejette une réponse Groq trop volumineuse avant de la parser', async () => {
  const oldKey = process.env.GROQ_API_KEY;
  const oldFetch = globalThis.fetch;
  process.env.GROQ_API_KEY = 'test-key-not-a-real-secret';
  installSqlMock();
  globalThis.fetch = async () => new Response(' '.repeat(32 * 1024 + 1));
  const response = makeResponse();
  try {
    await handler(makeRequest(), response);
    assert.equal(response.statusCode, 200);
    assert.equal(response.json().data.source, 'rules');
    assert.equal(response.json().data.aiStatus, 'unavailable');
  } finally {
    globalThis.fetch = oldFetch;
    if (oldKey === undefined) delete process.env.GROQ_API_KEY;
    else process.env.GROQ_API_KEY = oldKey;
  }
});
