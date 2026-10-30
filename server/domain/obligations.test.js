import test from 'node:test';
import assert from 'node:assert/strict';
import { rankObligations, validateFinancialItem } from './obligations.js';

const valid = {
  kind: 'debt',
  name: 'Moto',
  plannedAmountXof: 15000,
  remainingAmountXof: 100000,
  targetAmountXof: 200000,
  dueOn: '2026-11-15',
  cadence: 'monthly',
  priority: 4,
  deferralImpact: 'Pénalité après échéance',
};

test('valide un engagement et conserve ses champs significatifs', () => {
  const result = validateFinancialItem(valid);
  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'Moto');
  assert.equal(result.value.plannedAmountXof, 15000);
  assert.equal(result.value.dueOn, '2026-11-15');
});

test('rejette un type, montant, priorité ou échéance invalide', () => {
  assert.equal(validateFinancialItem({ ...valid, kind: 'loan' }).ok, false);
  assert.equal(validateFinancialItem({ ...valid, plannedAmountXof: 1.5 }).ok, false);
  assert.equal(validateFinancialItem({ ...valid, targetAmountXof: 0 }).ok, false);
  assert.equal(validateFinancialItem({ ...valid, priority: 6 }).ok, false);
  assert.equal(validateFinancialItem({ ...valid, dueOn: '2026-02-30' }).ok, false);
  assert.equal(validateFinancialItem({ ...valid, remainingAmountXof: 300000 }).ok, false);
});

test('classe les engagements par priorité, échéance puis libellé de façon stable', () => {
  const result = rankObligations([
    { id: 'later', priority: 3, dueOn: '2026-12-01', name: 'Z' },
    { id: 'urgent', priority: 4, dueOn: '2026-12-31', name: 'B' },
    { id: 'first', priority: 3, dueOn: '2026-11-01', name: 'C' },
  ]);
  assert.deepEqual(result.map((item) => item.id), ['urgent', 'first', 'later']);
});
