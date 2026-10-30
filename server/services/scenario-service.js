import { getSql } from '../../api/_lib/db.js';
import { buildScenario } from '../domain/scenarios.js';

export async function loadScenarioContext(ownerId, eventId, month) {
  const firstDay = `${month}-01`;
  const nextMonth = nextMonthStart(month);
  const sql = getSql();
  const [[event], [totals], items] = await Promise.all([
    sql`
      SELECT id, title, amount_xof AS "amountXof", urgency, version, status
      FROM unexpected_event
      WHERE id = ${eventId} AND owner_id = ${ownerId}
      LIMIT 1
    `,
    sql`
      SELECT
        COALESCE(SUM(amount_xof) FILTER (WHERE kind = 'income' AND status = 'paid'), 0)::bigint AS "incomeXof",
        COALESCE(SUM(amount_xof) FILTER (WHERE kind = 'expense' AND status = 'paid'), 0)::bigint AS "expensesXof",
        COALESCE(SUM(amount_xof) FILTER (
          WHERE kind = 'expense' AND status <> 'paid' AND financial_item_id IS NULL
        ), 0)::bigint
        + COALESCE((
          SELECT SUM(GREATEST(0, fi.planned_amount_xof - COALESCE(paid.amount_xof, 0)))
          FROM financial_item fi
          LEFT JOIN LATERAL (
            SELECT SUM(t.amount_xof)::bigint AS amount_xof
            FROM financial_transaction t
            WHERE t.financial_item_id = fi.id AND t.owner_id = fi.owner_id
              AND t.kind = 'expense' AND t.status = 'paid'
              AND t.occurred_on >= ${firstDay}::date AND t.occurred_on < ${nextMonth}::date
          ) paid ON true
          WHERE fi.owner_id = ${ownerId} AND fi.status = 'active'
            AND (fi.due_on IS NULL OR fi.due_on < ${nextMonth}::date)
        ), 0)::bigint AS "plannedXof"
      FROM financial_transaction
      WHERE owner_id = ${ownerId}
        AND (CASE WHEN status = 'paid' THEN occurred_on ELSE COALESCE(due_on, occurred_on) END) >= ${firstDay}::date
        AND (CASE WHEN status = 'paid' THEN occurred_on ELSE COALESCE(due_on, occurred_on) END) < ${nextMonth}::date
    `,
    sql`
      SELECT fi.id, fi.name,
        GREATEST(0, fi.planned_amount_xof - COALESCE(paid.amount_xof, 0))::bigint AS "plannedAmountXof",
        fi.due_on::text AS "dueOn", fi.cadence, fi.priority, fi.deferral_impact AS "deferralImpact",
        fi.status, fi.version
      FROM financial_item fi
      LEFT JOIN LATERAL (
        SELECT SUM(t.amount_xof)::bigint AS amount_xof
        FROM financial_transaction t
        WHERE t.financial_item_id = fi.id AND t.owner_id = fi.owner_id
          AND t.kind = 'expense' AND t.status = 'paid'
          AND t.occurred_on >= ${firstDay}::date AND t.occurred_on < ${nextMonth}::date
      ) paid ON true
      WHERE fi.owner_id = ${ownerId} AND fi.status = 'active'
        AND (fi.due_on IS NULL OR fi.due_on < ${nextMonth}::date)
      ORDER BY fi.priority DESC, fi.due_on NULLS LAST
    `,
  ]);
  if (!event) return { error: 'EVENT_NOT_FOUND' };
  if (!['open', 'planned'].includes(event.status)) return { error: 'EVENT_NOT_OPEN' };
  const numeric = [event.amountXof, totals.incomeXof, totals.expensesXof, totals.plannedXof, ...items.map((item) => item.plannedAmountXof)];
  if (numeric.some((value) => !Number.isSafeInteger(Number(value)))) return { error: 'AMOUNT_OUT_OF_RANGE' };
  const summary = Object.fromEntries(['incomeXof', 'expensesXof', 'plannedXof'].map((key) => [key, Number(totals[key])]));
  const result = buildScenario({ ...event, amountXof: Number(event.amountXof), version: Number(event.version) }, summary, items.map((item) => ({
    ...item,
    plannedAmountXof: Number(item.plannedAmountXof),
    version: Number(item.version),
    priority: Number(item.priority),
  })), month);
  return { event, summary, items, month, result };
}

export function nextMonthStart(month) {
  const [year, value] = month.split('-').map(Number);
  return value === 12 ? `${year + 1}-01-01` : `${year}-${String(value + 1).padStart(2, '0')}-01`;
}

export function isValidMonth(month) {
  return typeof month === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) && Number(month.slice(0, 4)) >= 2000 && Number(month.slice(0, 4)) <= 2100;
}
