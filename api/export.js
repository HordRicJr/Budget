import { requireOwner } from './_lib/auth.js';
import { getSql } from './_lib/db.js';
import { isSameOrigin, readJson, sendError, sendJson } from './_lib/http.js';

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
  if (input.confirm !== true) return sendError(res, 400, 'CONFIRMATION_REQUIRED', 'Confirmez explicitement la création de l’export.');

  const sql = getSql();
  let exportedRows;
  try {
    exportedRows = await Promise.all([
      sql`SELECT id, name, kind, is_default AS "isDefault", created_at AS "createdAt" FROM category WHERE owner_id = ${ownerId} ORDER BY kind, name`,
      sql`SELECT id, kind, category_id AS "categoryId", financial_item_id AS "financialItemId",
        amount_xof AS "amountXof", currency_code AS "currencyCode", occurred_on::text AS "occurredOn",
        due_on::text AS "dueOn", payee, note, status, version, created_at AS "createdAt", updated_at AS "updatedAt"
        FROM financial_transaction WHERE owner_id = ${ownerId} ORDER BY occurred_on, created_at`,
      sql`SELECT id, kind, name, target_amount_xof AS "targetAmountXof",
        remaining_amount_xof AS "remainingAmountXof", planned_amount_xof AS "plannedAmountXof",
        due_on::text AS "dueOn", cadence, priority, deferral_impact AS "deferralImpact", status, version,
        created_at AS "createdAt", updated_at AS "updatedAt"
        FROM financial_item WHERE owner_id = ${ownerId} ORDER BY created_at`,
      sql`SELECT id, title, amount_xof AS "amountXof", occurred_on::text AS "occurredOn",
        due_on::text AS "dueOn", urgency, note, status, version, created_at AS "createdAt"
        FROM unexpected_event WHERE owner_id = ${ownerId} ORDER BY created_at`,
      sql`SELECT s.id, s.name, s.budget_month::text AS month, s.event_id AS "eventId", s.status,
        s.result, s.version, s.created_at AS "createdAt", s.applied_at AS "appliedAt",
        COALESCE(jsonb_agg(jsonb_build_object(
          'financialItemId', a.financial_item_id, 'action', a.action,
          'amountDeltaXof', a.amount_delta_xof, 'consequence', a.consequence
        )) FILTER (WHERE a.id IS NOT NULL), '[]'::jsonb) AS actions
        FROM scenario s LEFT JOIN scenario_action a ON a.scenario_id = s.id AND a.owner_id = s.owner_id
        WHERE s.owner_id = ${ownerId} GROUP BY s.id ORDER BY s.created_at`,
      sql`SELECT id, scenario_id AS "scenarioId", input_snapshot AS "inputSnapshot", result, provider,
        model, schema_version AS "schemaVersion", prompt_version AS "promptVersion",
        candidate_hash AS "candidateHash", created_at AS "createdAt"
        FROM recommendation WHERE owner_id = ${ownerId} ORDER BY created_at`,
    ]);
  } catch {
    return sendError(res, 503, 'EXPORT_FAILED', 'L’export est indisponible pour le moment. Aucune copie n’a été créée.');
  }
  const [categories, transactions, financialItems, unexpectedEvents, scenarios, recommendations] = exportedRows;
  return sendJson(res, 200, {
    exportedAt: new Date().toISOString(),
    currencyCode: 'XOF',
    timezone: 'Africa/Abidjan',
    categories,
    transactions,
    financialItems,
    unexpectedEvents,
    scenarios,
    recommendations,
  }, { 'Content-Disposition': 'attachment; filename="budget-export.json"' });
}
