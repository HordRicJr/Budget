import { isValidDate } from './transactions.js';

const kinds = new Set(['debt', 'subscription', 'project', 'custom']);
const cadences = new Set(['once', 'weekly', 'monthly', 'yearly']);
const statuses = new Set(['active', 'paused', 'completed', 'cancelled']);
const fields = new Set([
  'kind', 'name', 'targetAmountXof', 'remainingAmountXof', 'plannedAmountXof',
  'dueOn', 'cadence', 'priority', 'deferralImpact', 'status', 'ownerId',
]);

export function validateFinancialItem(input, { partial = false } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return invalid('Les données de l’engagement sont invalides.');
  if (Object.keys(input).some((key) => !fields.has(key))) return invalid('Un champ de l’engagement est inconnu.');
  const required = ['kind', 'name', 'plannedAmountXof', 'priority'];
  if (!partial && required.some((key) => !(key in input))) return invalid('Complétez les champs requis de l’engagement.');
  const result = {};

  if ('kind' in input) {
    if (!kinds.has(input.kind)) return invalid('Choisissez un type d’engagement valide.');
    result.kind = input.kind;
  }
  if ('name' in input) {
    if (typeof input.name !== 'string' || input.name.trim().length < 1 || input.name.trim().length > 120) {
      return invalid('Le nom doit contenir de 1 à 120 caractères.');
    }
    result.name = input.name.trim();
  }
  for (const [key, output] of [
    ['targetAmountXof', 'targetAmountXof'],
    ['remainingAmountXof', 'remainingAmountXof'],
    ['plannedAmountXof', 'plannedAmountXof'],
  ]) {
    if (!(key in input)) continue;
    const value = input[key];
    const minimum = key === 'targetAmountXof' ? 1 : 0;
    if (value !== null && (!Number.isSafeInteger(value) || value < minimum)) {
      return invalid(key === 'targetAmountXof'
        ? 'Le montant total doit être un nombre entier positif en XOF.'
        : 'Les montants doivent être des nombres entiers XOF positifs ou nuls.');
    }
    result[output] = value;
  }
  if ('priority' in input) {
    if (!Number.isInteger(input.priority) || input.priority < 1 || input.priority > 5) return invalid('La priorité doit être comprise entre 1 et 5.');
    result.priority = input.priority;
  }
  if ('dueOn' in input) {
    if (input.dueOn !== null && input.dueOn !== '' && !isValidDate(input.dueOn)) return invalid('Saisissez une échéance valide.');
    result.dueOn = input.dueOn || null;
  }
  if ('cadence' in input) {
    if (input.cadence !== null && !cadences.has(input.cadence)) return invalid('Choisissez une périodicité valide.');
    result.cadence = input.cadence;
  }
  if ('deferralImpact' in input) {
    if (typeof input.deferralImpact !== 'string' || input.deferralImpact.length > 500) return invalid('La conséquence du report ne peut pas dépasser 500 caractères.');
    result.deferralImpact = input.deferralImpact.trim();
  }
  if ('status' in input) {
    if (!statuses.has(input.status)) return invalid('Choisissez un statut valide.');
    result.status = input.status;
  }
  if (result.targetAmountXof != null && result.remainingAmountXof != null && result.remainingAmountXof > result.targetAmountXof) {
    return invalid('Le solde restant ne peut pas dépasser le montant total.');
  }
  return { ok: true, value: result };
}

function invalid(message) {
  return { ok: false, message };
}

export function rankObligations(items) {
  return [...items].sort((a, b) =>
    Number(b.priority) - Number(a.priority)
    || (a.dueOn ?? '9999-12-31').localeCompare(b.dueOn ?? '9999-12-31')
    || a.name.localeCompare(b.name, 'fr'),
  );
}
