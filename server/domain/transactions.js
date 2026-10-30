const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function validateTransaction(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, message: 'Les données de la transaction sont invalides.' };
  }

  const { kind, categoryId, amountXof, occurredOn, dueOn, payee, note, status, financialItemId } = input;

  if (kind !== 'income' && kind !== 'expense') {
    return { ok: false, message: 'Choisissez un type de mouvement valide.' };
  }
  if (typeof categoryId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(categoryId)) {
    return { ok: false, message: 'Choisissez une catégorie valide.' };
  }
  if (!Number.isSafeInteger(amountXof) || amountXof <= 0) {
    return { ok: false, message: 'Le montant doit être un nombre entier positif en XOF.' };
  }
  if (!isValidDate(occurredOn)) {
    return { ok: false, message: 'Saisissez une date de dépense valide.' };
  }
  if (dueOn !== undefined && dueOn !== null && dueOn !== '' && !isValidDate(dueOn)) {
    return { ok: false, message: 'Saisissez une échéance valide.' };
  }
  if (payee !== undefined && payee !== null && (typeof payee !== 'string' || payee.length > 120)) {
    return { ok: false, message: 'Le bénéficiaire ne peut pas dépasser 120 caractères.' };
  }
  if (note !== undefined && note !== null && (typeof note !== 'string' || note.length > 500)) {
    return { ok: false, message: 'La note ne peut pas dépasser 500 caractères.' };
  }
  if (status !== undefined && !['planned', 'paid', 'deferred'].includes(status)) {
    return { ok: false, message: 'Choisissez un statut valide.' };
  }
  if (financialItemId !== undefined && financialItemId !== null && financialItemId !== ''
      && (typeof financialItemId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(financialItemId))) {
    return { ok: false, message: 'Choisissez un engagement valide.' };
  }
  if (financialItemId && kind !== 'expense') {
    return { ok: false, message: 'Seule une dépense peut être liée à un engagement.' };
  }

  return { ok: true };
}

export function isValidDate(value) {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

export function monthRange(month) {
  if (typeof month !== 'string' || !/^\d{4}-\d{2}$/.test(month)) return null;
  const [year, monthNumber] = month.split('-').map(Number);
  if (year < 2000 || year > 2100 || monthNumber < 1 || monthNumber > 12) return null;
  const nextMonth = monthNumber === 12 ? `${year + 1}-01` : `${year}-${String(monthNumber + 1).padStart(2, '0')}`;
  return { start: `${month}-01`, end: `${nextMonth}-01` };
}
