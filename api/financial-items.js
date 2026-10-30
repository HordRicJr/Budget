import { requireOwner } from './_lib/auth.js';
import { getSql } from './_lib/db.js';
import { isSameOrigin, readJson, sendError, sendJson } from './_lib/http.js';
import { validateFinancialItem } from '../server/domain/obligations.js';

const columns = `id, kind, name, target_amount_xof AS "targetAmountXof",
  remaining_amount_xof AS "remainingAmountXof", planned_amount_xof AS "plannedAmountXof",
  due_on::text AS "dueOn", cadence, priority, deferral_impact AS "deferralImpact",
  status, version, created_at AS "createdAt", updated_at AS "updatedAt"`;

export default async function handler(req, res) {
  const ownerId = await requireOwner(req, res);
  if (!ownerId) return;
  if (req.method === 'GET') return listItems(res, ownerId);
  if (!isSameOrigin(req)) return sendError(res, 403, 'ORIGIN_REJECTED', 'Origine de requête refusée.');
  if (req.method === 'POST') return createItem(req, res, ownerId);
  if (req.method === 'PATCH') return updateItem(req, res, ownerId);
  if (req.method === 'DELETE') return deleteItem(req, res, ownerId);
  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
}

async function listItems(res, ownerId) {
  const sql = getSql();
  const rows = await sql`
    SELECT ${sql.unsafe(columns)}
    FROM financial_item
    WHERE owner_id = ${ownerId}
    ORDER BY priority DESC, due_on NULLS LAST, created_at DESC
  `;
  if (rows.some((item) => [item.targetAmountXof, item.remainingAmountXof, item.plannedAmountXof]
    .some((value) => value != null && !Number.isSafeInteger(Number(value))))) {
    return sendError(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Un montant d’engagement dépasse la précision prise en charge.');
  }
  return sendJson(res, 200, { data: rows.map(serializeItem) });
}

async function createItem(req, res, ownerId) {
  const input = await readJson(req, res);
  if (!input) return;
  const validation = validateFinancialItem(input);
  if (!validation.ok) return sendError(res, 400, 'INVALID_FINANCIAL_ITEM', validation.message);
  const item = validation.value;
  const sql = getSql();
  const [created] = await sql`
    INSERT INTO financial_item (
      owner_id, kind, name, target_amount_xof, remaining_amount_xof,
      planned_amount_xof, due_on, cadence, priority, deferral_impact, status
    ) VALUES (
      ${ownerId}, ${item.kind}, ${item.name}, ${item.targetAmountXof ?? null},
      ${item.remainingAmountXof ?? null}, ${item.plannedAmountXof}, ${item.dueOn ?? null},
      ${item.cadence ?? null}, ${item.priority}, ${item.deferralImpact ?? ''}, ${item.status ?? 'active'}
    )
    RETURNING ${sql.unsafe(columns)}
  `;
  return sendJson(res, 201, { data: serializeItem(created) });
}

async function updateItem(req, res, ownerId) {
  const input = await readJson(req, res);
  if (!input) return;
  const { id, version, ...changes } = input;
  if (!isUuid(id) || !Number.isSafeInteger(version) || version < 1) {
    return sendError(res, 400, 'INVALID_VERSION', 'L’identifiant et la version actuelle sont requis.');
  }
  const validation = validateFinancialItem(changes, { partial: true });
  if (!validation.ok || Object.keys(validation.value).length === 0) {
    return sendError(res, 400, 'INVALID_FINANCIAL_ITEM', validation.message ?? 'Aucune modification valide.');
  }
  const item = validation.value;
  const sql = getSql();
  const [current] = await sql`
    SELECT id, kind, name, target_amount_xof AS "targetAmountXof",
      remaining_amount_xof AS "remainingAmountXof", planned_amount_xof AS "plannedAmountXof",
      due_on::text AS "dueOn", cadence, priority, deferral_impact AS "deferralImpact",
      status, version
    FROM financial_item WHERE id = ${id} AND owner_id = ${ownerId} AND version = ${version}
    LIMIT 1
  `;
  if (!current) {
    const [existing] = await sql`SELECT id FROM financial_item WHERE id = ${id} AND owner_id = ${ownerId}`;
    return sendError(res, existing ? 409 : 404, existing ? 'VERSION_CONFLICT' : 'NOT_FOUND', existing ? 'L’engagement a changé. Rechargez les données.' : 'Engagement introuvable.');
  }
  const mergedValidation = validateFinancialItem({
    kind: current.kind,
    name: current.name,
    targetAmountXof: current.targetAmountXof == null ? null : Number(current.targetAmountXof),
    remainingAmountXof: current.remainingAmountXof == null ? null : Number(current.remainingAmountXof),
    plannedAmountXof: Number(current.plannedAmountXof),
    dueOn: current.dueOn,
    cadence: current.cadence,
    priority: Number(current.priority),
    deferralImpact: current.deferralImpact,
    status: current.status,
    ...item,
  });
  if (!mergedValidation.ok) return sendError(res, 400, 'INVALID_FINANCIAL_ITEM', mergedValidation.message);
  const has = (key) => Object.hasOwn(item, key);
  const [updated] = await sql`
    UPDATE financial_item SET
      kind = CASE WHEN ${has('kind')} THEN ${item.kind ?? null}::text ELSE kind END,
      name = CASE WHEN ${has('name')} THEN ${item.name ?? null}::text ELSE name END,
      target_amount_xof = CASE WHEN ${has('targetAmountXof')} THEN ${item.targetAmountXof ?? null}::bigint ELSE target_amount_xof END,
      remaining_amount_xof = CASE WHEN ${has('remainingAmountXof')} THEN ${item.remainingAmountXof ?? null}::bigint ELSE remaining_amount_xof END,
      planned_amount_xof = CASE WHEN ${has('plannedAmountXof')} THEN ${item.plannedAmountXof ?? null}::bigint ELSE planned_amount_xof END,
      due_on = CASE WHEN ${has('dueOn')} THEN ${item.dueOn ?? null}::date ELSE due_on END,
      cadence = CASE WHEN ${has('cadence')} THEN ${item.cadence ?? null}::text ELSE cadence END,
      priority = CASE WHEN ${has('priority')} THEN ${item.priority ?? null}::smallint ELSE priority END,
      deferral_impact = CASE WHEN ${has('deferralImpact')} THEN ${item.deferralImpact ?? null}::text ELSE deferral_impact END,
      status = CASE WHEN ${has('status')} THEN ${item.status ?? null}::text ELSE status END,
      version = version + 1,
      updated_at = now()
    WHERE id = ${id} AND owner_id = ${ownerId} AND version = ${version}
    RETURNING ${sql.unsafe(columns)}
  `;
  if (!updated) return sendError(res, 409, 'VERSION_CONFLICT', 'L’engagement a changé. Rechargez les données.');
  return sendJson(res, 200, { data: serializeItem(updated) });
}

async function deleteItem(req, res, ownerId) {
  const input = await readJson(req, res);
  if (!input) return;
  if (!isUuid(input.id) || !Number.isSafeInteger(input.version) || input.version < 1) {
    return sendError(res, 400, 'INVALID_VERSION', 'L’identifiant et la version actuelle sont requis.');
  }
  const sql = getSql();
  const [deleted] = await sql`
    DELETE FROM financial_item fi
    WHERE fi.id = ${input.id} AND fi.owner_id = ${ownerId} AND fi.version = ${input.version}
      AND NOT EXISTS (
        SELECT 1 FROM financial_transaction t
        WHERE t.financial_item_id = fi.id AND t.owner_id = fi.owner_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM scenario_action a
        WHERE a.financial_item_id = fi.id AND a.owner_id = fi.owner_id
      )
    RETURNING id
  `;
  if (!deleted) return sendError(res, 409, 'VERSION_CONFLICT', 'L’engagement est introuvable, a changé ou est lié à un mouvement.');
  return sendJson(res, 200, { data: { id: deleted.id, deleted: true } });
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function serializeItem(item) {
  return {
    ...item,
    targetAmountXof: item.targetAmountXof == null ? null : Number(item.targetAmountXof),
    remainingAmountXof: item.remainingAmountXof == null ? null : Number(item.remainingAmountXof),
    plannedAmountXof: Number(item.plannedAmountXof),
    priority: Number(item.priority),
    version: Number(item.version),
  };
}
