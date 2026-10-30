import { requireOwner } from './_lib/auth.js';
import { getSql } from './_lib/db.js';
import { isSameOrigin, readJson, sendError, sendJson } from './_lib/http.js';
import { isValidDate } from '../server/domain/transactions.js';

export default async function handler(req, res) {
  const ownerId = await requireOwner(req, res);
  if (!ownerId) return;
  if (req.method === 'GET') return listEvents(res, ownerId);
  if (!isSameOrigin(req)) return sendError(res, 403, 'ORIGIN_REJECTED', 'Origine de requête refusée.');
  if (req.method === 'POST') return createEvent(req, res, ownerId);
  if (req.method === 'PATCH') return updateEvent(req, res, ownerId);
  if (req.method === 'DELETE') return deleteEvent(req, res, ownerId);
  res.setHeader('Allow', 'GET, POST, PATCH, DELETE');
  return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
}

async function listEvents(res, ownerId) {
  const sql = getSql();
  const rows = await sql`
    SELECT id, title, amount_xof AS "amountXof", occurred_on::text AS "occurredOn",
      due_on::text AS "dueOn", urgency, note, status, version
    FROM unexpected_event WHERE owner_id = ${ownerId}
    ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, due_on NULLS LAST, created_at DESC
  `;
  if (rows.some((event) => !Number.isSafeInteger(Number(event.amountXof)) || Number(event.amountXof) <= 0)) {
    return sendError(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Un montant d’imprévu dépasse la précision prise en charge.');
  }
  return sendJson(res, 200, { data: rows.map(serializeEvent) });
}

async function createEvent(req, res, ownerId) {
  const input = await readJson(req, res);
  if (!input) return;
  const invalid = validateEvent(input);
  if (invalid) return sendError(res, 400, 'INVALID_EVENT', invalid);
  const sql = getSql();
  const [created] = await sql`
    INSERT INTO unexpected_event (owner_id, title, amount_xof, occurred_on, due_on, urgency, note)
    VALUES (${ownerId}, ${input.title.trim()}, ${input.amountXof}, ${input.occurredOn}, ${input.dueOn || null}, ${input.urgency}, ${input.note?.trim() ?? ''})
    RETURNING id, title, amount_xof AS "amountXof", occurred_on::text AS "occurredOn",
      due_on::text AS "dueOn", urgency, note, status, version
  `;
  return sendJson(res, 201, { data: serializeEvent(created) });
}

async function updateEvent(req, res, ownerId) {
  const input = await readJson(req, res);
  if (!input) return;
  const { id, version, ...changes } = input;
  if (!isUuid(id) || !Number.isSafeInteger(version) || version < 1 || Object.keys(changes).length === 0) {
    return sendError(res, 400, 'INVALID_EVENT', 'L’identifiant, la version et au moins un champ sont requis.');
  }
  const invalid = validateEventUpdate(changes);
  if (invalid) return sendError(res, 400, 'INVALID_EVENT', invalid);
  const has = (key) => Object.hasOwn(changes, key);
  const sql = getSql();
  const [updated] = await sql`
    UPDATE unexpected_event SET
      title = CASE WHEN ${has('title')} THEN ${changes.title?.trim() ?? null}::text ELSE title END,
      amount_xof = CASE WHEN ${has('amountXof')} THEN ${changes.amountXof ?? null}::bigint ELSE amount_xof END,
      occurred_on = CASE WHEN ${has('occurredOn')} THEN ${changes.occurredOn ?? null}::date ELSE occurred_on END,
      due_on = CASE WHEN ${has('dueOn')} THEN ${changes.dueOn || null}::date ELSE due_on END,
      urgency = CASE WHEN ${has('urgency')} THEN ${changes.urgency ?? null}::smallint ELSE urgency END,
      note = CASE WHEN ${has('note')} THEN ${changes.note?.trim() ?? null}::text ELSE note END,
      status = CASE WHEN ${has('status')} THEN ${changes.status ?? null}::text ELSE status END,
      version = version + 1,
      updated_at = now()
    WHERE id = ${id} AND owner_id = ${ownerId} AND version = ${version}
    RETURNING id, title, amount_xof AS "amountXof", occurred_on::text AS "occurredOn",
      due_on::text AS "dueOn", urgency, note, status, version
  `;
  if (!updated) return sendError(res, 409, 'VERSION_CONFLICT', 'L’imprévu a changé ou n’existe plus.');
  return sendJson(res, 200, { data: serializeEvent(updated) });
}

async function deleteEvent(req, res, ownerId) {
  const input = await readJson(req, res);
  if (!input) return;
  if (!isUuid(input.id) || !Number.isSafeInteger(input.version) || input.version < 1) {
    return sendError(res, 400, 'INVALID_EVENT', 'L’identifiant et la version actuelle sont requis.');
  }
  const sql = getSql();
  const [deleted] = await sql`
    DELETE FROM unexpected_event ev
    WHERE ev.id = ${input.id} AND ev.owner_id = ${ownerId} AND ev.version = ${input.version}
      AND NOT EXISTS (SELECT 1 FROM scenario s WHERE s.event_id = ev.id AND s.owner_id = ev.owner_id)
    RETURNING id
  `;
  if (!deleted) return sendError(res, 409, 'VERSION_CONFLICT', 'L’imprévu a changé, n’existe plus ou est lié à un scénario.');
  return sendJson(res, 200, { data: { id: deleted.id, deleted: true } });
}

function validateEvent(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return 'Les données de l’imprévu sont invalides.';
  if (typeof input.title !== 'string' || input.title.trim().length < 1 || input.title.trim().length > 120) return 'Le titre doit contenir de 1 à 120 caractères.';
  if (!Number.isSafeInteger(input.amountXof) || input.amountXof <= 0) return 'Le montant doit être un nombre entier positif en XOF.';
  if (!isValidDate(input.occurredOn)) return 'Saisissez une date valide.';
  if (input.dueOn != null && input.dueOn !== '' && !isValidDate(input.dueOn)) return 'Saisissez une échéance valide.';
  if (!Number.isInteger(input.urgency) || input.urgency < 1 || input.urgency > 5) return 'L’urgence doit être comprise entre 1 et 5.';
  if (input.note != null && (typeof input.note !== 'string' || input.note.length > 500)) return 'La note ne peut pas dépasser 500 caractères.';
  return null;
}

function validateEventUpdate(input) {
  if (Object.hasOwn(input, 'title') && (typeof input.title !== 'string' || input.title.trim().length < 1 || input.title.trim().length > 120)) return 'Le titre doit contenir de 1 à 120 caractères.';
  if (Object.hasOwn(input, 'amountXof') && (!Number.isSafeInteger(input.amountXof) || input.amountXof <= 0)) return 'Le montant doit être un nombre entier positif en XOF.';
  if (Object.hasOwn(input, 'occurredOn') && !isValidDate(input.occurredOn)) return 'Saisissez une date valide.';
  if (Object.hasOwn(input, 'dueOn') && input.dueOn != null && input.dueOn !== '' && !isValidDate(input.dueOn)) return 'Saisissez une échéance valide.';
  if (Object.hasOwn(input, 'urgency') && (!Number.isInteger(input.urgency) || input.urgency < 1 || input.urgency > 5)) return 'L’urgence doit être comprise entre 1 et 5.';
  if (Object.hasOwn(input, 'note') && (typeof input.note !== 'string' || input.note.length > 500)) return 'La note ne peut pas dépasser 500 caractères.';
  if (Object.hasOwn(input, 'status') && !['open', 'planned', 'resolved'].includes(input.status)) return 'Choisissez un statut valide.';
  if (Object.keys(input).some((key) => !['title', 'amountXof', 'occurredOn', 'dueOn', 'urgency', 'note', 'status'].includes(key))) return 'Un champ de l’imprévu est inconnu.';
  return null;
}

function isUuid(value) {
  return typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function serializeEvent(event) {
  return { ...event, amountXof: Number(event.amountXof), urgency: Number(event.urgency), version: Number(event.version) };
}
