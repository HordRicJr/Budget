import { createHash } from 'node:crypto';
import { requireOwner } from './_lib/auth.js';
import { getSql } from './_lib/db.js';
import { isSameOrigin, readJson, sendError, sendJson } from './_lib/http.js';
import { isValidMonth, loadScenarioContext } from '../server/services/scenario-service.js';

const OPERATION = 'scenario-apply-v1';

export default async function handler(req, res) {
  const ownerId = await requireOwner(req, res);
  if (!ownerId) return;
  if (req.method === 'GET') return listScenarios(res, ownerId);
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
  }
  if (!isSameOrigin(req)) return sendError(res, 403, 'ORIGIN_REJECTED', 'Origine de requête refusée.');
  const input = await readJson(req, res);
  if (!input) return;
  if (input.action === 'simulate') return simulate(res, ownerId, input);
  if (input.action === 'confirm') return confirmScenario(res, req, ownerId, input);
  return sendError(res, 400, 'INVALID_ACTION', 'Choisissez une simulation ou une confirmation valide.');
}

async function simulate(res, ownerId, input) {
  if (!isUuid(input.eventId) || !isValidMonth(input.month)) {
    return sendError(res, 400, 'INVALID_SCENARIO', 'Un imprévu et un mois valides sont requis.');
  }
  const context = await loadScenarioContext(ownerId, input.eventId, input.month);
  if (context.error === 'EVENT_NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'Imprévu introuvable.');
  if (context.error === 'EVENT_NOT_OPEN') return sendError(res, 409, 'EVENT_CLOSED', 'Cet imprévu n’est plus ouvert à la simulation.');
  if (context.error === 'AMOUNT_OUT_OF_RANGE') return sendError(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Un montant dépasse la précision prise en charge.');
  return sendJson(res, 200, { data: context.result });
}

async function confirmScenario(res, req, ownerId, input) {
  const key = req.headers['idempotency-key'] ?? input.idempotencyKey;
  if (typeof key !== 'string' || key.length < 8 || key.length > 128 || !/^[A-Za-z0-9._:-]+$/.test(key)) {
    return sendError(res, 400, 'INVALID_IDEMPOTENCY_KEY', 'Une clé idempotente valide est requise.');
  }
  if (!isUuid(input.eventId) || !isValidMonth(input.month) || typeof input.candidateId !== 'string' || typeof input.dataVersion !== 'string') {
    return sendError(res, 400, 'INVALID_SCENARIO', 'Le scénario confirmé est incomplet.');
  }
  const request = { eventId: input.eventId, month: input.month, candidateId: input.candidateId, dataVersion: input.dataVersion };
  const requestHash = createHash('sha256').update(JSON.stringify(request)).digest('hex');
  const sql = getSql();
  const [prior] = await sql`
    SELECT request_hash AS "requestHash", response
    FROM idempotency_record
    WHERE owner_id = ${ownerId} AND operation = ${OPERATION} AND idempotency_key = ${key}
    LIMIT 1
  `;
  if (prior) {
    if (prior.requestHash !== requestHash) return sendError(res, 409, 'IDEMPOTENCY_KEY_REUSED', 'Cette clé a déjà servi pour un autre scénario.');
    return sendJson(res, 200, { data: prior.response, replayed: true });
  }

  const context = await loadScenarioContext(ownerId, input.eventId, input.month);
  if (context.error === 'EVENT_NOT_FOUND') return sendError(res, 404, 'NOT_FOUND', 'Imprévu introuvable.');
  if (context.error === 'EVENT_NOT_OPEN') return sendError(res, 409, 'EVENT_CLOSED', 'Cet imprévu est déjà résolu.');
  if (context.error === 'AMOUNT_OUT_OF_RANGE') return sendError(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Un montant dépasse la précision prise en charge.');
  if (context.result.dataVersion !== input.dataVersion) return sendError(res, 409, 'VERSION_CONFLICT', 'Le budget a changé depuis la simulation. Recommencez.');
  const candidate = context.result.candidates.find((option) => option.id === input.candidateId);
  if (!candidate) return sendError(res, 409, 'SCENARIO_NOT_ADMISSIBLE', 'Cette option ne fait plus partie des choix disponibles.');
  if (!candidate.admissible) return sendError(res, 409, 'SCENARIO_NOT_ADMISSIBLE', 'Cette option ne couvre pas entièrement l’imprévu.');

  const response = {
    eventId: input.eventId,
    month: input.month,
    candidateId: candidate.id,
    availableBeforeXof: candidate.availableBeforeXof,
    eventAmountXof: candidate.eventAmountXof,
    availableAfterXof: candidate.availableAfterXof,
    actions: candidate.actions,
    applied: true,
  };
  const actionRows = candidate.actions.map((action) => ({
    item_id: action.itemId,
    action: action.action,
    amount_delta_xof: action.amountDeltaXof,
    consequence: action.consequence,
    item_version: action.itemVersion,
  }));
  const resultJson = JSON.stringify(response);
  let saved;
  try {
    [saved] = await sql`
      WITH action_input AS MATERIALIZED (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(actionRows)}::jsonb)
          AS a(item_id uuid, action text, amount_delta_xof bigint, consequence text, item_version integer)
      ),
      locked_event AS MATERIALIZED (
        SELECT ev.id, ev.version, ev.status
        FROM unexpected_event ev
        WHERE ev.id = ${input.eventId} AND ev.owner_id = ${ownerId}
        FOR UPDATE OF ev
      ),
      locked_items AS MATERIALIZED (
        SELECT fi.id, fi.version, fi.status
        FROM financial_item fi
        JOIN action_input a ON a.item_id = fi.id
        WHERE fi.owner_id = ${ownerId}
        FOR UPDATE OF fi
      ),
      ready AS MATERIALIZED (
        SELECT ev.id
        FROM locked_event ev
        WHERE ev.version = ${Number(context.event.version)}
          AND ev.status IN ('open', 'planned')
          AND NOT EXISTS (
            SELECT 1 FROM action_input a
            LEFT JOIN locked_items fi
              ON fi.id = a.item_id AND fi.status = 'active' AND fi.version = a.item_version
            WHERE a.item_id IS NOT NULL AND fi.id IS NULL
          )
      ),
      updated_items AS (
        UPDATE financial_item fi SET
          planned_amount_xof = CASE
            WHEN a.action = 'reduce' THEN GREATEST(0, fi.planned_amount_xof - a.amount_delta_xof)
            ELSE fi.planned_amount_xof
          END,
          due_on = CASE
            WHEN a.action = 'defer' THEN GREATEST(COALESCE(fi.due_on, ${`${input.month}-01`}::date), ${`${input.month}-01`}::date) + interval '1 month'
            ELSE fi.due_on
          END,
          status = CASE WHEN a.action = 'pause' THEN 'paused' ELSE fi.status END,
          version = fi.version + 1,
          updated_at = now()
        FROM action_input a
        WHERE fi.id = a.item_id AND fi.owner_id = ${ownerId} AND fi.version = a.item_version
          AND EXISTS (SELECT 1 FROM ready)
        RETURNING fi.id
      ),
      updated_event AS (
        UPDATE unexpected_event ev
        SET status = 'resolved', version = ev.version + 1, updated_at = now()
        WHERE ev.id = ${input.eventId} AND ev.owner_id = ${ownerId}
          AND ev.version = ${Number(context.event.version)} AND EXISTS (SELECT 1 FROM ready)
          AND (SELECT COUNT(*) FROM updated_items) =
            (SELECT COUNT(*) FROM action_input WHERE item_id IS NOT NULL)
        RETURNING ev.id
      ),
      saved_scenario AS (
        INSERT INTO scenario (owner_id, name, budget_month, event_id, status, data_version, result, applied_at)
        SELECT ${ownerId}, 'Simulation confirmée', ${`${input.month}-01`}::date, ${input.eventId},
          'applied', ${input.dataVersion}, ${resultJson}::jsonb, now()
        FROM ready
        WHERE (SELECT COUNT(*) FROM updated_items) =
          (SELECT COUNT(*) FROM action_input WHERE item_id IS NOT NULL)
          AND EXISTS (SELECT 1 FROM updated_event)
        RETURNING id
      ),
      saved_actions AS (
        INSERT INTO scenario_action (owner_id, scenario_id, financial_item_id, action, amount_delta_xof, consequence)
        SELECT ${ownerId}, s.id, a.item_id, a.action, a.amount_delta_xof, a.consequence
        FROM saved_scenario s CROSS JOIN action_input a
        RETURNING id
      ),
      saved_idempotency AS (
        INSERT INTO idempotency_record (owner_id, operation, idempotency_key, request_hash, response)
        SELECT ${ownerId}, ${OPERATION}, ${key}, ${requestHash},
          jsonb_build_object('scenarioId', s.id, 'result', ${resultJson}::jsonb)
        FROM saved_scenario s
        ON CONFLICT (owner_id, operation, idempotency_key) DO NOTHING
        RETURNING response
      )
      SELECT response FROM saved_idempotency
    `;
  } catch {
    const [concurrent] = await sql`
      SELECT request_hash AS "requestHash", response
      FROM idempotency_record
      WHERE owner_id = ${ownerId} AND operation = ${OPERATION} AND idempotency_key = ${key}
      LIMIT 1
    `;
    if (concurrent?.requestHash === requestHash) return sendJson(res, 200, { data: concurrent.response, replayed: true });
    return sendError(res, 500, 'SCENARIO_APPLY_FAILED', 'L’application du scénario a échoué. Vérifiez le budget avant de réessayer.');
  }
  if (!saved) {
    const [concurrent] = await sql`
      SELECT request_hash AS "requestHash", response
      FROM idempotency_record
      WHERE owner_id = ${ownerId} AND operation = ${OPERATION} AND idempotency_key = ${key}
      LIMIT 1
    `;
    if (concurrent?.requestHash === requestHash) return sendJson(res, 200, { data: concurrent.response, replayed: true });
    return sendError(res, 409, 'VERSION_CONFLICT', 'Le budget a changé pendant la confirmation. Aucune modification n’a été appliquée.');
  }
  return sendJson(res, 200, { data: saved.response, replayed: false });
}

async function listScenarios(res, ownerId) {
  const sql = getSql();
  const rows = await sql`
    SELECT id, name, budget_month::text AS month, event_id AS "eventId", status,
      result, version, created_at AS "createdAt", applied_at AS "appliedAt"
    FROM scenario WHERE owner_id = ${ownerId}
    ORDER BY created_at DESC LIMIT 50
  `;
  return sendJson(res, 200, { data: rows });
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
