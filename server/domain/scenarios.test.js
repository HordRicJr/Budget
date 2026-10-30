import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScenario } from './scenarios.js';

const event = { id: 'event-1', title: 'Panne', amountXof: 50000, urgency: 5, version: 1 };
const summary = { incomeXof: 250000, expensesXof: 50000, plannedXof: 120000 };
const items = [
  { id: 'item-1', name: 'Abonnement', status: 'active', plannedAmountXof: 30000, version: 2, priority: 1, dueOn: '2026-11-15', cadence: 'monthly', deferralImpact: 'Perte de service' },
  { id: 'item-2', name: 'Dette', status: 'active', plannedAmountXof: 40000, version: 1, priority: 5, dueOn: '2026-11-20', cadence: 'once', deferralImpact: 'Frais de retard' },
];

test('simule plusieurs choix XOF sans muter les entrées', () => {
  const original = structuredClone(items);
  const result = buildScenario(event, summary, items, '2026-11');
  assert.equal(result.availableBeforeXof, 80000);
  assert.ok(result.candidates.length > 1);
  const noAction = result.candidates.find((candidate) => candidate.id === 'use-available-balance');
  assert.equal(noAction.eventAmountXof, 50000);
  assert.equal(noAction.availableAfterXof, 30000);
  assert.deepEqual(items, original);
  assert.equal(result.candidates.some((candidate) => candidate.actions.some((action) => action.action === 'pause')), true);
});

test('signale les options qui ne couvrent pas le coût sans les rendre admissibles', () => {
  const result = buildScenario(event, { incomeXof: 0, expensesXof: 0, plannedXof: 10000 }, [], '2026-11');
  assert.equal(result.candidates[0].availableAfterXof, -60000);
  assert.equal(result.candidates[0].admissible, false);
});

test('produit la même version pour un même instantané', () => {
  const first = buildScenario(event, summary, items, '2026-11');
  const second = buildScenario(event, summary, items, '2026-11');
  assert.equal(first.dataVersion, second.dataVersion);
});

test('rejette les montants invalides et les mois mal formés à la frontière du domaine', () => {
  assert.throws(() => buildScenario({ ...event, amountXof: -1 }, summary, items, '2026-11'), RangeError);
  assert.throws(() => buildScenario(event, { ...summary, plannedXof: 'mal-formé' }, items, '2026-11'), RangeError);
  assert.throws(() => buildScenario(event, summary, items, '2026-13'), TypeError);
});

test('préserve le solde exact lorsque les calculs intermédiaires dépasseraient la précision sûre', () => {
  const amount = Number.MAX_SAFE_INTEGER;
  const result = buildScenario(
    { ...event, amountXof: 2 },
    { incomeXof: amount, expensesXof: 0, plannedXof: 0 },
    [{ id: 'item-3', name: 'Projet', status: 'active', plannedAmountXof: 2, version: 1, priority: 3 }],
    '2026-11',
  );
  const reduction = result.candidates.find((candidate) => candidate.actions.some((action) => action.action === 'reduce'));
  assert.equal(reduction.availableAfterXof, amount);
});
