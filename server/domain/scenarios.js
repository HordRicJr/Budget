import { createHash } from 'node:crypto';

const safeInteger = (value) => Number.isSafeInteger(Number(value));

export function buildScenario(event, summary, items, month) {
  if (!event || !summary || !Array.isArray(items) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
    throw new TypeError('Contexte de simulation invalide.');
  }
  const amounts = [event.amountXof, summary.incomeXof, summary.expensesXof, summary.plannedXof];
  if (amounts.some((amount) => !Number.isSafeInteger(amount) || amount < 0) || event.amountXof === 0
      || items.some((item) => !Number.isSafeInteger(Number(item.plannedAmountXof)) || Number(item.plannedAmountXof) < 0)) {
    throw new RangeError('Les montants de simulation doivent être des entiers XOF positifs et sûrs.');
  }
  const total = BigInt(summary.incomeXof) - BigInt(summary.expensesXof) - BigInt(summary.plannedXof);
  if (total > BigInt(Number.MAX_SAFE_INTEGER) || total < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Le solde dépasse la précision prise en charge.');
  }
  const availableXof = Number(total);
  const activeItems = items.filter((item) => item.status === 'active')
    .map((item) => ({ ...item, plannedAmountXof: Number(item.plannedAmountXof) }))
    .filter((item) => Number.isSafeInteger(item.plannedAmountXof) && item.plannedAmountXof > 0);

  const candidateActions = activeItems.flatMap((item) => {
    const release = Math.min(item.plannedAmountXof, Number(event.amountXof));
    const actions = [{
      itemId: item.id,
      itemName: item.name,
      action: 'reduce',
      amountDeltaXof: release,
      consequence: item.deferralImpact || 'Réduire le montant prévu.',
      itemVersion: Number(item.version),
      priority: Number(item.priority),
      dueOn: item.dueOn,
    }];
    if (item.dueOn || item.cadence === 'once') {
      actions.push({
        itemId: item.id,
        itemName: item.name,
        action: 'defer',
        amountDeltaXof: item.plannedAmountXof,
        consequence: item.deferralImpact || 'Reporter la prochaine échéance.',
        itemVersion: Number(item.version),
        priority: Number(item.priority),
        dueOn: item.dueOn,
      });
    }
    actions.push({
      itemId: item.id,
      itemName: item.name,
      action: 'pause',
      amountDeltaXof: item.plannedAmountXof,
      consequence: item.deferralImpact || 'Mettre temporairement en pause cet engagement.',
      itemVersion: Number(item.version),
      priority: Number(item.priority),
      dueOn: item.dueOn,
    });
    return actions;
  });

  const baselineAfter = availableXof - Number(event.amountXof);
  if (!Number.isSafeInteger(baselineAfter)) throw new RangeError('Le solde dépasse la précision prise en charge.');
  const candidates = [{
    id: 'use-available-balance',
    actions: [{
      itemId: null,
      itemName: 'Solde disponible',
      action: 'allocate',
      amountDeltaXof: Number(event.amountXof),
      consequence: 'Affecter le solde disponible à cet imprévu.',
      itemVersion: 0,
      priority: 5,
      dueOn: event.dueOn ?? null,
    }],
    availableBeforeXof: availableXof,
    eventAmountXof: Number(event.amountXof),
    availableAfterXof: baselineAfter,
    explanation: 'Financer l’imprévu avec le solde disponible, sans modifier les engagements.',
    priorityScore: 0,
    admissible: baselineAfter >= 0,
  }];
  for (const action of candidateActions) {
    candidates.push(makeCandidate([action], availableXof, Number(event.amountXof)));
  }
  const orderedActions = [...candidateActions].sort((a, b) =>
    b.amountDeltaXof - a.amountDeltaXof || a.itemId.localeCompare(b.itemId) || a.action.localeCompare(b.action),
  );
  for (let first = 0; first < orderedActions.length && candidates.length < 48; first += 1) {
    for (let second = first + 1; second < orderedActions.length && candidates.length < 48; second += 1) {
      if (orderedActions[first].itemId === orderedActions[second].itemId) continue;
      candidates.push(makeCandidate([orderedActions[first], orderedActions[second]], availableXof, Number(event.amountXof)));
    }
  }
  const unique = [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()];
  const ranked = unique.sort((a, b) =>
    (b.availableAfterXof >= 0) - (a.availableAfterXof >= 0)
    || b.priorityScore - a.priorityScore
    || a.actions.length - b.actions.length
    || a.id.localeCompare(b.id),
  );
  const selected = ranked.slice(0, 12);
  if (!selected.some((candidate) => candidate.id === 'use-available-balance')) selected[selected.length - 1] = candidates[0];

  const dataVersion = createHash('sha256').update(JSON.stringify({
    event: { id: event.id, version: Number(event.version), amountXof: Number(event.amountXof) },
    month,
    summary: [summary.incomeXof, summary.expensesXof, summary.plannedXof],
    items: activeItems.map(({ id, version, plannedAmountXof, status }) => [id, Number(version), plannedAmountXof, status]).sort(),
  })).digest('hex');
  return {
    dataVersion,
    availableBeforeXof: availableXof,
    event: { id: event.id, title: event.title, amountXof: Number(event.amountXof), urgency: Number(event.urgency) },
    candidates: selected,
  };
}

function makeCandidate(actions, available, eventAmount) {
  const freed = actions.reduce((sum, action) => sum + BigInt(action.action === 'allocate' ? 0 : action.amountDeltaXof), 0n);
  const after = BigInt(available) + freed - BigInt(eventAmount);
  if (after > BigInt(Number.MAX_SAFE_INTEGER) || after < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new RangeError('Le solde dépasse la précision prise en charge.');
  }
  const availableAfterXof = Number(after);
  const normalized = [...actions].sort((a, b) => a.itemId.localeCompare(b.itemId) || a.action.localeCompare(b.action));
  const id = createHash('sha256').update(JSON.stringify(normalized.map(({ itemId, action, amountDeltaXof, itemVersion }) => [itemId, action, amountDeltaXof, itemVersion]))).digest('hex').slice(0, 24);
  return {
    id,
    actions: normalized,
    availableBeforeXof: available,
    eventAmountXof: eventAmount,
    availableAfterXof,
    explanation: normalized.map((action) => `${action.action}: ${action.consequence}`).join(' '),
    priorityScore: normalized.reduce((score, action) => score + (6 - action.priority) * 1000, 0),
    admissible: availableAfterXof >= 0,
  };
}
