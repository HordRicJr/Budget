import test from 'node:test';
import assert from 'node:assert/strict';
import { isSameOrigin, parseCookies, readJson } from './http.js';

function makeResponse() {
  return {
    statusCode: 0,
    headers: {},
    body: '',
    writeHead(status, headers) {
      this.statusCode = status;
      this.headers = headers;
    },
    end(body = '') {
      this.body = body;
    },
    json() {
      return JSON.parse(this.body);
    },
  };
}

test('ignore un cookie mal encodé sans faire échouer le parsing', () => {
  assert.deepEqual(parseCookies('budget_session=%E0%A4%A; theme=dark'), {
    budget_session: '',
    theme: 'dark',
  });
});

test('ne laisse pas un en-tête transféré remplacer l’hôte de la requête', () => {
  assert.equal(isSameOrigin({
    headers: {
      origin: 'https://attacker.example',
      host: 'budget.example',
      'x-forwarded-host': 'attacker.example',
    },
  }), false);
});

test('limite la taille du JSON en octets UTF-8', async () => {
  const req = {
    async *[Symbol.asyncIterator]() {
      yield Buffer.from(JSON.stringify({ value: 'é'.repeat(9_000) }));
    },
  };
  const res = makeResponse();

  const result = await readJson(req, res);

  assert.equal(result, null);
  assert.equal(res.statusCode, 413);
  assert.equal(res.json().error.code, 'PAYLOAD_TOO_LARGE');
});
