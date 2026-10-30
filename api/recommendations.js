import { requireOwner } from './_lib/auth.js';
import { getSql } from './_lib/db.js';
import { isSameOrigin, readJson, sendError, sendJson } from './_lib/http.js';
import { candidateHash, deterministicRecommendations, validateGroqRanking } from '../server/domain/recommendations.js';
import { rankWithGroq } from '../server/providers/groq.js';
import { isValidMonth, loadScenarioContext } from '../server/services/scenario-service.js';

export default async function handler(req, res) {
  const ownerId = await requireOwner(req, res);
  if (!ownerId) return;
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
  }
  if (!isSameOrigin(req)) return sendError(res, 403, 'ORIGIN_REJECTED', 'Origine de requête refusée.');
  const input = await readJson(req, res);
  if (!input) return;
  if (typeof input.eventId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.eventId)
      || !isValidMonth(input.month)) {
    return sendError(res, 400, 'INVALID_RECOMMENDATION', 'Un imprévu et un mois valides sont requis.');
  }
  const context = await loadScenarioContext(ownerId, input.eventId, input.month);
  if (context.error === 'EVENT_NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'Imprévu introuvable.');
  if (context.error === 'EVENT_NOT_OPEN') return sendError(res, 409, 'EVENT_CLOSED', 'Cet imprévu n’est plus ouvert.');
  if (context.error === 'AMOUNT_OUT_OF_RANGE') return sendError(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Un montant dépasse la précision prise en charge.');

  const candidates = context.result.candidates;
  const fallback = deterministicRecommendations(candidates);
  const admissibleCandidates = candidates.filter((candidate) => candidate.admissible);
  let recommendations = fallback;
  let provider = 'rules';
  let aiStatus = process.env.GROQ_API_KEY
    ? (admissibleCandidates.length > 0 ? 'unavailable' : 'no_admissible_options')
    : 'disabled';
  let model = null;
  if (process.env.GROQ_API_KEY && admissibleCandidates.length > 0) {
    const sql = getSql();
    const [throttle] = await sql`
      INSERT INTO groq_request_throttle (owner_id, window_started_at, request_count)
      VALUES (${ownerId}, now(), 1)
      ON CONFLICT (owner_id) DO UPDATE SET
        request_count = CASE
          WHEN groq_request_throttle.window_started_at <= now() - interval '1 minute' THEN 1
          ELSE groq_request_throttle.request_count + 1
        END,
        window_started_at = CASE
          WHEN groq_request_throttle.window_started_at <= now() - interval '1 minute' THEN now()
          ELSE groq_request_throttle.window_started_at
        END
      RETURNING request_count AS "requestCount"
    `;
    if (Number(throttle.requestCount) <= 10) {
      const ai = await rankWithGroq({
        version: 1,
        month: input.month,
        budget: {
          availableBeforeXof: context.result.availableBeforeXof,
          unexpectedAmountXof: context.result.event.amountXof,
          urgency: context.result.event.urgency,
        },
        options: admissibleCandidates.map((candidate) => ({
          candidateId: candidate.id,
          actions: candidate.actions.map(({ action, amountDeltaXof, priority, dueOn, consequence }) => ({
            action, amountDeltaXof, priority, dueOn, consequence,
          })),
          availableAfterXof: candidate.availableAfterXof,
        })),
      });
      const validated = ai && validateGroqRanking(
        { options: ai.options },
        admissibleCandidates.map((candidate) => candidate.id),
      );
      if (validated) {
        const byId = new Map(admissibleCandidates.map((candidate) => [candidate.id, candidate]));
        recommendations = validated.map((option, index) => ({
          candidateId: option.candidateId,
          rank: index + 1,
          explanation: byId.get(option.candidateId).explanation,
          availableAfterXof: byId.get(option.candidateId).availableAfterXof,
        }));
        provider = 'groq';
        model = ai.model;
        aiStatus = 'available';
      }
    } else {
      aiStatus = 'rate_limited';
    }
  }

  const minimalSnapshot = {
    version: 1,
    month: input.month,
    budget: {
      availableBeforeXof: context.result.availableBeforeXof,
      unexpectedAmountXof: context.result.event.amountXof,
      urgency: context.result.event.urgency,
    },
    candidates: candidates.map((candidate) => ({
      id: candidate.id,
      actions: candidate.actions.map(({ action, amountDeltaXof, priority, dueOn, consequence }) => ({
        action, amountDeltaXof, priority, dueOn, consequence,
      })),
      availableAfterXof: candidate.availableAfterXof,
    })),
  };
  const result = { recommendations, source: provider, aiStatus, dataVersion: context.result.dataVersion };
  const sql = getSql();
  await sql`
    INSERT INTO recommendation (owner_id, input_snapshot, result, provider, model, candidate_hash)
    VALUES (
      ${ownerId}, ${JSON.stringify(minimalSnapshot)}::jsonb, ${JSON.stringify(result)}::jsonb,
      ${provider}, ${model}, ${candidateHash(candidates)}
    )
  `;
  return sendJson(res, 200, { data: result });
}
