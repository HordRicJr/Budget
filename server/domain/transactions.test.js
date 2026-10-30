import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidDate, monthRange, validateTransaction } from './transactions.js';

const validInput = {
  kind: 'expense',
  categoryId: '01234567-89ab-4def-8123-456789abcdef',
  amountXof: 2500,
  occurredOn: '2026-10-29',
  dueOn: '2026-10-31',
  payee: 'Marché',
  note: 'Courses',
  status: 'paid',
};

test('accepte une transaction XOF valide', () => {
  assert.deepEqual(validateTransaction(validInput), { ok: true });
});

test('refuse les montants nuls, négatifs, décimaux et non sûrs', () => {
  for (const amountXof of [0, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(validateTransaction({ ...validInput, amountXof }).ok, false);
  }
});

test('refuse une date impossible mais accepte un paiement effectué après échéance', () => {
  assert.equal(isValidDate('2026-02-29'), false);
  assert.equal(validateTransaction({ ...validInput, occurredOn: '2026-02-30' }).ok, false);
  assert.equal(validateTransaction({ ...validInput, dueOn: '2026-10-01' }).ok, true);
});

test('calcule les bornes du mois sans décalage GMT', () => {
  assert.deepEqual(monthRange('2026-12'), {
    start: '2026-12-01',
    end: '2027-01-01',
  });
  assert.equal(monthRange('2026-13'), null);
});
