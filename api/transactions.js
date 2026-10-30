import { requireOwner } from './_lib/auth.js';
import { getSql } from './_lib/db.js';
import { isSameOrigin, readJson, sendError, sendJson } from './_lib/http.js';
import { monthRange, validateTransaction } from '../server/domain/transactions.js';

const PAGE_SIZE = 100;

export default async function handler(req, res) {
  const ownerId = await requireOwner(req, res);
  if (!ownerId) return;

  if (req.method === 'GET') return listTransactions(req, res, ownerId);
  if (req.method === 'POST') {
    if (!isSameOrigin(req)) return sendError(res, 403, 'ORIGIN_REJECTED', 'Origine de requête refusée.');
    return createTransaction(req, res, ownerId);
  }

  res.setHeader('Allow', 'GET, POST');
  return sendError(res, 405, 'METHOD_NOT_ALLOWED', 'Méthode non autorisée.');
}

async function listTransactions(req, res, ownerId) {
  const currentMonth = new Intl.DateTimeFormat('fr-CA', {
    timeZone: 'Africa/Abidjan',
    year: 'numeric',
    month: '2-digit',
  }).format(new Date());
  const month = req.query?.month ?? currentMonth;
  const range = monthRange(month);
  if (!range) return sendError(res, 400, 'INVALID_MONTH', 'Le mois demandé est invalide.');
  const offset = Number(req.query?.offset ?? 0);
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
    return sendError(res, 400, 'INVALID_OFFSET', 'Le décalage demandé est invalide.');
  }

  const sql = getSql();
  const [transactionRows, [totals]] = await Promise.all([sql`
    SELECT
      t.id,
      t.kind,
      t.category_id AS "categoryId",
      c.name AS "categoryName",
      t.financial_item_id AS "financialItemId",
      t.amount_xof AS "amountXof",
      t.occurred_on::text AS "occurredOn",
      t.due_on::text AS "dueOn",
      t.payee,
      t.note,
      t.status,
      t.created_at AS "createdAt"
    FROM financial_transaction t
    JOIN category c ON c.id = t.category_id AND c.owner_id = t.owner_id
    WHERE t.owner_id = ${ownerId}
      AND (CASE WHEN t.status = 'paid' THEN t.occurred_on ELSE COALESCE(t.due_on, t.occurred_on) END) >= ${range.start}::date
      AND (CASE WHEN t.status = 'paid' THEN t.occurred_on ELSE COALESCE(t.due_on, t.occurred_on) END) < ${range.end}::date
    ORDER BY
      CASE WHEN t.status = 'paid' THEN t.occurred_on ELSE COALESCE(t.due_on, t.occurred_on) END DESC,
      t.created_at DESC
    LIMIT ${PAGE_SIZE + 1} OFFSET ${offset}
  `, sql`
    SELECT
      COALESCE(SUM(amount_xof) FILTER (WHERE kind = 'income' AND status = 'paid'), 0)::bigint AS "incomeXof",
      COALESCE(SUM(amount_xof) FILTER (WHERE kind = 'income' AND status <> 'paid'), 0)::bigint AS "plannedIncomeXof",
      COALESCE(SUM(amount_xof) FILTER (WHERE kind = 'expense' AND status = 'paid'), 0)::bigint AS "expensesXof",
      (
        COALESCE(SUM(amount_xof) FILTER (
          WHERE kind = 'expense' AND status <> 'paid' AND financial_item_id IS NULL
        ), 0)
        + COALESCE((
          SELECT SUM(GREATEST(0, fi.planned_amount_xof - COALESCE(paid.amount_xof, 0)))
          FROM financial_item fi
          LEFT JOIN LATERAL (
            SELECT SUM(t.amount_xof)::bigint AS amount_xof
            FROM financial_transaction t
            WHERE t.financial_item_id = fi.id AND t.owner_id = fi.owner_id
              AND t.kind = 'expense' AND t.status = 'paid'
              AND t.occurred_on >= ${range.start}::date AND t.occurred_on < ${range.end}::date
          ) paid ON true
          WHERE fi.owner_id = ${ownerId} AND fi.status = 'active'
            AND (fi.due_on IS NULL OR fi.due_on < ${range.end}::date)
        ), 0)
      )::bigint AS "plannedXof"
    FROM financial_transaction
    WHERE owner_id = ${ownerId}
      AND (CASE WHEN status = 'paid' THEN occurred_on ELSE COALESCE(due_on, occurred_on) END) >= ${range.start}::date
      AND (CASE WHEN status = 'paid' THEN occurred_on ELSE COALESCE(due_on, occurred_on) END) < ${range.end}::date
  `]);

  const transactions = transactionRows.slice(0, PAGE_SIZE);
  if (transactions.some((transaction) => !Number.isSafeInteger(Number(transaction.amountXof)) || Number(transaction.amountXof) <= 0)) {
    return sendError(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Un montant de mouvement dépasse la précision prise en charge.');
  }
  const safeTotals = [
    totals.incomeXof,
    totals.plannedIncomeXof,
    totals.expensesXof,
    totals.plannedXof,
  ].map(Number);
  if (safeTotals.some((value) => !Number.isSafeInteger(value))) {
    return sendError(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Le total dépasse la précision prise en charge.');
  }
  const availableXof = safeTotals[0] - safeTotals[2] - safeTotals[3];
  if (!Number.isSafeInteger(availableXof)) {
    return sendError(res, 422, 'AMOUNT_OUT_OF_RANGE', 'Le solde calculé dépasse la précision prise en charge.');
  }

  return sendJson(res, 200, {
    data: {
      month,
      summary: {
        incomeXof: Number(totals.incomeXof),
        plannedIncomeXof: Number(totals.plannedIncomeXof),
        expensesXof: Number(totals.expensesXof),
        plannedXof: Number(totals.plannedXof),
        availableXof,
      },
      transactions: transactions.map((transaction) => ({ ...transaction, amountXof: Number(transaction.amountXof) })),
      pagination: {
        offset,
        limit: PAGE_SIZE,
        hasMore: transactionRows.length > PAGE_SIZE,
        nextOffset: offset + transactions.length,
      },
    },
  });
}

async function createTransaction(req, res, ownerId) {
  const input = await readJson(req, res);
  if (!input) return;

  const validation = validateTransaction(input);
  if (!validation.ok) return sendError(res, 400, 'INVALID_TRANSACTION', validation.message);

  const sql = getSql();
  if (input.financialItemId) {
    const [item] = await sql`
      SELECT id
      FROM financial_item
      WHERE id = ${input.financialItemId} AND owner_id = ${ownerId} AND status = 'active'
      LIMIT 1
    `;
    if (!item) return sendError(res, 400, 'INVALID_FINANCIAL_ITEM', 'Cet engagement est inaccessible ou inactif.');
  }
  const [category] = await sql`
    SELECT id
    FROM category
    WHERE id = ${input.categoryId} AND owner_id = ${ownerId} AND kind = ${input.kind}
    LIMIT 1
  `;
  if (!category) return sendError(res, 400, 'INVALID_CATEGORY', 'Cette catégorie ne correspond pas au mouvement.');

  const [transaction] = await sql`
    INSERT INTO financial_transaction (
      owner_id, category_id, kind, amount_xof, currency_code,
      occurred_on, due_on, payee, note, status, financial_item_id
    )
    VALUES (
      ${ownerId}, ${input.categoryId}, ${input.kind}, ${input.amountXof}, 'XOF',
      ${input.occurredOn}, ${input.dueOn || null}, ${input.payee?.trim() || null},
      ${input.note?.trim() || null}, ${input.status ?? 'paid'}, ${input.financialItemId || null}
    )
    RETURNING
      id,
      kind,
      category_id AS "categoryId",
      amount_xof AS "amountXof",
      occurred_on::text AS "occurredOn",
      due_on::text AS "dueOn",
      payee,
      note,
      status
  `;

  return sendJson(res, 201, { data: transaction });
}
