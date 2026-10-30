import { createHash } from 'node:crypto';

export function deterministicRecommendations(candidates) {
  if (!Array.isArray(candidates)) throw new TypeError('Les options de recommandation sont invalides.');
  const ranked = [...candidates].sort((a, b) =>
    (b.availableAfterXof >= 0) - (a.availableAfterXof >= 0)
    || a.actions.length - b.actions.length
    || b.availableAfterXof - a.availableAfterXof
    || a.id.localeCompare(b.id),
  );
  return ranked.map((candidate, index) => ({
    candidateId: candidate.id,
    rank: index + 1,
    explanation: candidate.explanation,
    availableAfterXof: candidate.availableAfterXof,
  }));
}

export function candidateHash(candidates) {
  return createHash('sha256').update(JSON.stringify(candidates.map(({ id, actions, availableAfterXof }) => [id, actions, availableAfterXof]))).digest('hex');
}

export function validateGroqRanking(payload, candidateIds) {
  if (!payload || Object.keys(payload).length !== 1 || !Array.isArray(payload.options) || payload.options.length !== candidateIds.length) return null;
  const permitted = new Set(candidateIds);
  const seen = new Set();
  const result = [];
  for (const option of payload.options) {
    if (!option || Object.keys(option).some((key) => !['candidateId', 'explanation'].includes(key))
        || Object.keys(option).length !== 2) return null;
    if (!option || typeof option.candidateId !== 'string' || !permitted.has(option.candidateId) || seen.has(option.candidateId)) return null;
    if (typeof option.explanation !== 'string' || option.explanation.trim().length < 1 || option.explanation.length > 240) return null;
    seen.add(option.candidateId);
    result.push({ candidateId: option.candidateId, explanation: option.explanation.trim() });
  }
  return seen.size === permitted.size ? result : null;
}
