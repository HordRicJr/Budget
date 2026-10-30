import test from 'node:test';
import assert from 'node:assert/strict';
import { candidateHash, deterministicRecommendations, validateGroqRanking } from './recommendations.js';

const candidates = [
  { id: 'shortfall', actions: [], availableAfterXof: -100 },
  { id: 'covered', actions: [{ action: 'reduce', amountDeltaXof: 100 }], availableAfterXof: 0 },
];

test('classe les options couvrables avant les déficits', () => {
  const result = deterministicRecommendations(candidates);
  assert.equal(result[0].candidateId, 'covered');
  assert.equal(result[0].rank, 1);
});

test('refuse une réponse Groq incomplète, inconnue ou mal formée', () => {
  assert.equal(validateGroqRanking({ options: [{ candidateId: 'made-up', explanation: 'Choix' }] }, ['covered']), null);
  assert.equal(validateGroqRanking({ options: [{ candidateId: 'covered', explanation: 'Choix' }], metadata: 'extra' }, ['covered']), null);
  assert.equal(validateGroqRanking({ options: [{ candidateId: 'covered', explanation: 'Choix' }] }, ['covered', 'shortfall']), null);
  assert.equal(validateGroqRanking({ options: [{ candidateId: 'covered', explanation: 'Choix', amount: 10 }] }, ['covered']), null);
  assert.equal(validateGroqRanking({ options: [{ candidateId: 'covered', explanation: 'x'.repeat(241) }] }, ['covered']), null);
});

test('accepte uniquement une permutation complète des candidats', () => {
  const result = validateGroqRanking({ options: [
    { candidateId: 'covered', explanation: 'Option couvrable.' },
    { candidateId: 'shortfall', explanation: 'Reste à financer.' },
  ] }, ['covered', 'shortfall']);
  assert.deepEqual(result.map((option) => option.candidateId), ['covered', 'shortfall']);
});

test('calcule une empreinte stable des candidats', () => {
  assert.equal(candidateHash(candidates), candidateHash(candidates));
});
