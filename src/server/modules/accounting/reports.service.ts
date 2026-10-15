import { z } from "zod";
import { getDb } from "@/server/db";
import { HttpError, requirePermission } from "@/server/auth/guards";
import type { JwtPayload } from "@/server/auth/crypto";
import { dateSchema, today, valid } from "../shared/domain";
import { budgetOwnerAmount } from "./accounting.service";
/** Sum in BigInt before converting back; reject scopes that cannot preserve every paisa. */
export function sumMinor(values: number[]): number {
  if (values.some((v) => !Number.isSafeInteger(v)))
    throw new HttpError(
      422,
      "MONEY_PRECISION",
      "Amounts exceed exact integer precision; narrow report scope.",
    );
  const total = values.reduce((n, v) => n + BigInt(v), 0n),
    limit = BigInt(Number.MAX_SAFE_INTEGER);
  if (total > limit || total < -limit)
    throw new HttpError(
      422,
      "MONEY_PRECISION",
      "Amounts exceed exact integer precision; narrow report scope.",
    );
  return Number(total);
}
export const filterSchema = z
  .object({
    from: dateSchema,
    to: dateSchema,
    propertyId: z.string().min(1).optional(),
    ownerId: z.string().min(1).optional(),
  })
  .strict()
  .refine((q) => q.from <= q.to, "Start date must not follow end date")
  .refine(
    (q) => (Date.parse(q.to) - Date.parse(q.from)) / 86400000 <= 3660,
    "Select at most ten years",
  );
export type ReportFilter = z.infer<typeof filterSchema>;
export function defaultFilter(): ReportFilter {
  const t = today();
  return { from: `${t.slice(0, 7)}-01`, to: t };
}
export function scope(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:read");
  const q = valid(filterSchema, input),
    db = getDb();
  for (const [table, id] of [
    ["properties", q.propertyId],
    ["owners", q.ownerId],
  ])
    if (
      id &&
      !db
        .prepare(
          `SELECT id FROM ${table} WHERE organization_id=? AND id=? AND deleted_at IS NULL`,
        )
        .get(ctx.organizationId, id)
    )
      throw new HttpError(404, "NOT_FOUND", "Report scope not found.");
  return q;
}
function ledgerScope(org: string, q: ReportFilter) {
  return {
    join: q.ownerId
      ? "JOIN ledger_owner_allocations oa ON oa.ledger_entry_id=l.id AND oa.organization_id=l.organization_id"
      : "",
    amount: q.ownerId ? "oa.amount_minor" : "l.amount_minor",
    where: `l.organization_id=? AND l.journal_id IS NOT NULL AND l.deleted_at IS NULL AND l.entry_date<=? ${q.propertyId ? "AND l.property_id=?" : ""} ${q.ownerId ? "AND oa.owner_id=?" : ""}`,
    args: [
      org,
      q.to,
      ...(q.propertyId ? [q.propertyId] : []),
      ...(q.ownerId ? [q.ownerId] : []),
    ],
  };
}
export function reconciliation(org: string) {
  const db = getDb(),
    balance = (code: string) =>
      Number(
        db
          .prepare(
            `SELECT COALESCE(SUM(CASE WHEN l.direction='debit' THEN l.amount_minor ELSE -l.amount_minor END),0) n FROM ledger_entries l JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=? AND a.code=? AND l.journal_id IS NOT NULL AND l.deleted_at IS NULL`,
          )
          .get(org, code)!.n,
      );
  const expectedAR = Number(
    db
      .prepare(
        "SELECT COALESCE(SUM(total_minor-paid_minor),0) n FROM invoices WHERE organization_id=? AND deleted_at IS NULL AND status!='cancelled'",
      )
      .get(org)!.n,
  );
  const expectedAP = Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(w.actual_cost_minor-COALESCE(p.amount_minor,0)),0) n FROM work_orders w LEFT JOIN accounting_vendor_payments p ON p.work_order_id=w.id AND p.organization_id=w.organization_id WHERE w.organization_id=? AND w.status='completed' AND w.deleted_at IS NULL`,
      )
      .get(org)!.n,
  );
  const unsyncedInvoices = Number(
    db
      .prepare(
        `SELECT COUNT(*) n FROM invoices i LEFT JOIN accounting_source_state s ON s.organization_id=i.organization_id AND s.source_type='invoice' AND s.source_id=i.id WHERE i.organization_id=? AND i.deleted_at IS NULL AND (s.source_id IS NULL OR s.posted_minor<>CASE WHEN i.status='cancelled' THEN 0 ELSE i.total_minor+(SELECT COALESCE(SUM(c.amount_minor),0) FROM credit_notes c WHERE c.organization_id=i.organization_id AND c.invoice_id=i.id) END)`,
      )
      .get(org)!.n,
  );
  const unsyncedPayments = Number(
    db
      .prepare(
        `SELECT COUNT(*) n FROM payments p LEFT JOIN accounting_source_state s ON s.organization_id=p.organization_id AND s.source_type='payment' AND s.source_id=p.id WHERE p.organization_id=? AND p.deleted_at IS NULL AND p.status='completed' AND (s.source_id IS NULL OR s.posted_minor<>p.amount_minor)`,
      )
      .get(org)!.n,
  );
  const unsyncedWorkOrders = Number(
    db
      .prepare(
        `SELECT COUNT(*) n FROM work_orders w LEFT JOIN accounting_source_state s ON s.organization_id=w.organization_id AND s.source_type='work_order' AND s.source_id=w.id WHERE w.organization_id=? AND w.deleted_at IS NULL AND w.status='completed' AND (s.source_id IS NULL OR s.posted_minor<>w.actual_cost_minor)`,
      )
      .get(org)!.n,
  );
  const unsyncedCredits = Number(
    db
      .prepare(
        `SELECT COUNT(*) n FROM credit_notes c JOIN invoices i ON i.id=c.invoice_id AND i.organization_id=c.organization_id LEFT JOIN accounting_source_state s ON s.organization_id=c.organization_id AND s.source_type='credit' AND s.source_id=c.id WHERE c.organization_id=? AND i.deleted_at IS NULL AND (s.source_id IS NULL OR s.posted_minor<>CASE WHEN i.status='cancelled' THEN 0 ELSE c.amount_minor END)`,
      )
      .get(org)!.n,
  );
  const unsyncedDeposits = Number(
    db
      .prepare(
        `SELECT COUNT(*) n FROM lease_events e LEFT JOIN accounting_source_state s ON s.organization_id=e.organization_id AND s.source_type='deposit' AND s.source_id=e.id WHERE e.organization_id=? AND e.type IN ('deposit_received','deposit_refunded') AND (s.source_id IS NULL OR s.posted_minor<>json_extract(e.payload_json,'$.amountMinor'))`,
      )
      .get(org)!.n,
  );
  const unsyncedPayouts = Number(
    db
      .prepare(
        `SELECT COUNT(*) n FROM statement_payouts p LEFT JOIN accounting_source_state s ON s.organization_id=p.organization_id AND s.source_type='owner_payout' AND s.source_id=p.id WHERE p.organization_id=? AND (s.source_id IS NULL OR s.posted_minor<>p.amount_minor)`,
      )
      .get(org)!.n,
  );
  const unjournaledEntries = Number(
    db
      .prepare(
        "SELECT COUNT(*) n FROM ledger_entries WHERE organization_id=? AND journal_id IS NULL AND deleted_at IS NULL",
      )
      .get(org)!.n,
  );
  const invalidBatches = Number(
    db
      .prepare(
        `SELECT COUNT(*) n FROM (SELECT l.journal_id FROM ledger_entries l WHERE l.organization_id=? AND l.journal_id IS NOT NULL GROUP BY l.journal_id HAVING COUNT(*)<>2 OR SUM(CASE WHEN l.direction='debit' THEN l.amount_minor ELSE -l.amount_minor END)<>0)`,
      )
      .get(org)!.n,
  );
  const receivablesMinor = balance("1100"),
    payablesMinor = 0 - balance("2000");
  return {
    expectedReceivablesMinor: expectedAR,
    ledgerReceivablesMinor: receivablesMinor,
    receivablesDifferenceMinor: receivablesMinor - expectedAR,
    expectedPayablesMinor: expectedAP,
    ledgerPayablesMinor: payablesMinor,
    payablesDifferenceMinor: payablesMinor - expectedAP,
    legacyClearingMinor: balance("1190"),
    unsyncedInvoices,
    unsyncedPayments,
    unsyncedWorkOrders,
    unsyncedCredits,
    unsyncedDeposits,
    unsyncedPayouts,
    unjournaledEntries,
    invalidBatches,
    balanced: !invalidBatches,
    fullyPosted:
      !(
        unsyncedInvoices +
        unsyncedPayments +
        unsyncedWorkOrders +
        unsyncedCredits +
        unsyncedDeposits +
        unsyncedPayouts +
        unjournaledEntries
      ) &&
      receivablesMinor === expectedAR &&
      payablesMinor === expectedAP,
  };
}
export function financialReport(ctx: JwtPayload, input: unknown) {
  const q = scope(ctx, input),
    db = getDb(),
    s = ledgerScope(ctx.organizationId, q);
  const sums = db
    .prepare(
      `SELECT l.account_id,
 COALESCE(SUM(CASE WHEN l.entry_date<? AND l.direction='debit' THEN ${s.amount} WHEN l.entry_date<? THEN -${s.amount} ELSE 0 END),0) opening,
 COALESCE(SUM(CASE WHEN l.entry_date>=? AND l.direction='debit' THEN ${s.amount} ELSE 0 END),0) debits,
 COALESCE(SUM(CASE WHEN l.entry_date>=? AND l.direction='credit' THEN ${s.amount} ELSE 0 END),0) credits
 FROM ledger_entries l ${s.join} WHERE ${s.where} GROUP BY l.account_id`,
    )
    .all(q.from, q.from, q.from, q.from, ...s.args);
  const accounts = db
    .prepare(
      "SELECT id,code,name,type FROM accounts WHERE organization_id=? AND deleted_at IS NULL ORDER BY code",
    )
    .all(ctx.organizationId)
    .map((a) => {
      const n = sums.find((r) => r.account_id === a.id);
      const openingMinor = Number(n?.opening || 0),
        debitMinor = Number(n?.debits || 0),
        creditMinor = Number(n?.credits || 0);
      return {
        id: String(a.id),
        code: String(a.code),
        name: String(a.name),
        type: String(a.type),
        openingMinor,
        debitMinor,
        creditMinor,
        closingMinor: sumMinor([openingMinor, debitMinor, -creditMinor]),
      };
    });
  const sum = (type: string) =>
      sumMinor(
        accounts
          .filter((a) => a.type === type)
          .flatMap((a) => [a.debitMinor, -a.creditMinor]),
      ),
    closing = (type: string) =>
      sumMinor(
        accounts.filter((a) => a.type === type).map((a) => a.closingMinor),
      );
  const budgets = db
    .prepare(
      `SELECT b.*,p.name AS property_name,a.code AS account_code,a.name AS account_name FROM accounting_budgets b JOIN properties p ON p.id=b.property_id AND p.organization_id=b.organization_id JOIN accounts a ON a.id=b.account_id AND a.organization_id=b.organization_id WHERE b.organization_id=? AND b.period_month BETWEEN ? AND ? ${q.propertyId ? "AND b.property_id=?" : ""} ORDER BY b.period_month,p.name,a.code`,
    )
    .all(
      ctx.organizationId,
      q.from.slice(0, 7),
      q.to.slice(0, 7),
      ...(q.propertyId ? [q.propertyId] : []),
    );
  // Include actual expense categories even if no budget was set.
  const actual = db
    .prepare(
      `SELECT l.property_id,l.account_id,substr(l.entry_date,1,7) period_month,SUM(CASE WHEN l.direction='debit' THEN ${s.amount} ELSE -${s.amount} END) amount FROM ledger_entries l ${s.join} JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE ${s.where} AND l.entry_date>=? AND a.type='expense' GROUP BY l.property_id,l.account_id,substr(l.entry_date,1,7)`,
    )
    .all(...s.args, q.from);
  const keys = new Set(
    [...budgets, ...actual].map(
      (b) => `${b.property_id || ""}|${b.account_id}|${b.period_month}`,
    ),
  );
  const budgetRows = [...keys].sort().map((key) => {
    const [propertyId, accountId, periodMonth] = key.split("|"),
      b = budgets.find(
        (b) =>
          `${b.property_id || ""}|${b.account_id}|${b.period_month}` === key,
      ),
      a = actual.find(
        (a) =>
          `${a.property_id || ""}|${a.account_id}|${a.period_month}` === key,
      );
    const plannedMinor = b
        ? budgetOwnerAmount(
            Number(b.amount_minor),
            String(b.owner_shares_json),
            q.ownerId,
          )
        : 0,
      actualMinor = Number(a?.amount || 0),
      acc = accounts.find((a) => a.id === accountId)!;
    return {
      propertyId,
      propertyName: String(
        b?.property_name ||
          db
            .prepare(
              "SELECT name FROM properties WHERE organization_id=? AND id=?",
            )
            .get(ctx.organizationId, propertyId)?.name ||
          "Office / unallocated",
      ),
      accountCode: acc.code,
      accountName: acc.name,
      periodMonth,
      plannedMinor,
      actualMinor,
      varianceMinor: sumMinor([plannedMinor, -actualMinor]),
    };
  });
  const totals = {
    debitMinor: sumMinor(accounts.map((a) => a.debitMinor)),
    creditMinor: sumMinor(accounts.map((a) => a.creditMinor)),
    incomeMinor: 0 - sum("income"),
    expenseMinor: sum("expense"),
    profitMinor: sumMinor([-sum("income"), -sum("expense")]),
    assetsMinor: closing("asset"),
    liabilitiesMinor: 0 - closing("liability"),
    equityMinor: 0 - closing("equity"),
    retainedEarningsMinor: sumMinor([-closing("income"), -closing("expense")]),
    cashMovementMinor:
      accounts.find((a) => a.code === "1000")!.debitMinor -
      accounts.find((a) => a.code === "1000")!.creditMinor,
    receivablesMinor: accounts.find((a) => a.code === "1100")!.closingMinor,
    payablesMinor: 0 - accounts.find((a) => a.code === "2000")!.closingMinor,
    legacyClearingMinor: accounts.find((a) => a.code === "1190")!.closingMinor,
  };
  return {
    filter: q,
    currency: "PKR",
    basis: "accrual",
    generatedAt: new Date().toISOString(),
    accounts,
    totals,
    budgets: budgetRows,
    reconciliation: reconciliation(ctx.organizationId),
  };
}
export function ledgerReport(
  ctx: JwtPayload,
  input: unknown,
  page = 1,
  limit = 50,
) {
  const q = scope(ctx, input),
    s = ledgerScope(ctx.organizationId, q),
    db = getDb();
  if (
    !Number.isInteger(page) ||
    page < 1 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10000
  )
    throw new HttpError(400, "PAGINATION", "Invalid ledger pagination.");
  const from = `FROM ledger_entries l ${s.join} JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id JOIN journal_batches j ON j.id=l.journal_id AND j.organization_id=l.organization_id LEFT JOIN properties p ON p.id=l.property_id AND p.organization_id=l.organization_id WHERE ${s.where} AND l.entry_date>=?`;
  const total = Number(
    db.prepare(`SELECT COUNT(*) n ${from}`).get(...s.args, q.from)!.n,
  );
  const rows = db
    .prepare(
      `SELECT l.id,l.journal_id AS journalId,l.entry_date AS entryDate,a.code AS accountCode,a.name AS accountName,l.direction,${s.amount} AS amountMinor,p.name AS propertyName,j.property_id AS propertyId,j.reference,j.description,j.source_type AS sourceType,j.source_id AS sourceId,EXISTS(SELECT 1 FROM journal_batches r WHERE r.organization_id=j.organization_id AND r.reversed_batch_id=j.id) AS reversed ${from} ORDER BY l.entry_date DESC,j.created_at DESC,j.id,l.line_number LIMIT ? OFFSET ?`,
    )
    .all(...s.args, q.from, limit, (page - 1) * limit)
    .map((r) => ({
      id: String(r.id),
      journalId: String(r.journalId),
      entryDate: String(r.entryDate),
      accountCode: String(r.accountCode),
      accountName: String(r.accountName),
      direction: String(r.direction),
      amountMinor: Number(r.amountMinor),
      propertyName: r.propertyName as string | null,
      propertyId: r.propertyId as string | null,
      reference: String(r.reference),
      description: String(r.description),
      sourceType: String(r.sourceType),
      sourceId: String(r.sourceId),
      reversed: Number(r.reversed),
    }));
  return { rows, total, page, limit };
}
export function operationalReport(ctx: JwtPayload, input: unknown) {
  const q = scope(ctx, input),
    db = getDb(),
    org = ctx.organizationId;
  const propertyClause = `${q.propertyId ? "AND u.property_id=?" : ""} ${q.ownerId ? "AND EXISTS(SELECT 1 FROM property_owners po WHERE po.organization_id=u.organization_id AND po.property_id=u.property_id AND po.owner_id=? AND po.deleted_at IS NULL)" : ""}`;
  const args = [
    org,
    ...(q.propertyId ? [q.propertyId] : []),
    ...(q.ownerId ? [q.ownerId] : []),
  ];
  const units = db
    .prepare(
      `SELECT u.id,u.unit_number,u.property_id,u.status,u.vacant_since,p.name AS property_name FROM units u JOIN properties p ON p.id=u.property_id AND p.organization_id=u.organization_id WHERE u.organization_id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL ${propertyClause} ORDER BY p.name,u.unit_number`,
    )
    .all(...args);
  const unitIds = new Set(units.map((u) => u.id)),
    propertyIds = new Set(units.map((u) => u.property_id));
  const invoices = db
    .prepare(
      "SELECT i.*,t.full_name AS tenant_name FROM invoices i JOIN tenants t ON t.id=i.tenant_id AND t.organization_id=i.organization_id WHERE i.organization_id=? AND i.deleted_at IS NULL AND i.status!='cancelled'",
    )
    .all(org)
    .filter((i) => propertyIds.has(i.property_id));
  const periodInvoices = invoices.filter(
    (i) =>
      i.type === "rent" &&
      String(i.period_month) >= q.from.slice(0, 7) &&
      String(i.period_month) <= q.to.slice(0, 7),
  );
  const recordedPayments = db
    .prepare(
      "SELECT p.amount_minor,p.paid_at,i.property_id FROM payments p JOIN invoices i ON i.id=p.invoice_id AND i.organization_id=p.organization_id WHERE p.organization_id=? AND p.deleted_at IS NULL AND p.status='completed' AND i.type='rent' AND date(p.paid_at,'+5 hours') BETWEEN ? AND ?",
    )
    .all(org, q.from, q.to)
    .filter((p) => propertyIds.has(p.property_id));
  const buckets = {
    current: 0,
    days1to30: 0,
    days31to60: 0,
    days61to90: 0,
    daysOver90: 0,
  };
  const arrears = invoices
    .filter((i) => Number(i.total_minor) > Number(i.paid_minor))
    .map((i) => {
      const outstandingMinor = Number(i.total_minor) - Number(i.paid_minor),
        daysOverdue = Math.max(
          0,
          Math.floor(
            (Date.parse(today()) - Date.parse(String(i.due_date))) / 86400000,
          ),
        ),
        bucket =
          daysOverdue === 0
            ? "current"
            : daysOverdue <= 30
              ? "days1to30"
              : daysOverdue <= 60
                ? "days31to60"
                : daysOverdue <= 90
                  ? "days61to90"
                  : "daysOver90";
      buckets[bucket] += outstandingMinor;
      return {
        invoiceId: String(i.id),
        invoiceNumber: String(i.invoice_number),
        tenantName: String(i.tenant_name),
        propertyId: String(i.property_id),
        dueDate: String(i.due_date),
        outstandingMinor,
        daysOverdue,
      };
    })
    .sort(
      (a, b) =>
        b.daysOverdue - a.daysOverdue || a.invoiceId.localeCompare(b.invoiceId),
    );
  const leads = db
    .prepare(
      "SELECT l.*,lst.unit_id FROM leads l LEFT JOIN listings lst ON lst.id=l.listing_id AND lst.organization_id=l.organization_id WHERE l.organization_id=? AND l.deleted_at IS NULL AND substr(l.created_at,1,10) BETWEEN ? AND ?",
    )
    .all(org, q.from, q.to)
    .filter((l) => (!q.propertyId && !q.ownerId) || unitIds.has(l.unit_id));
  const deals = db
    .prepare(
      "SELECT * FROM deals WHERE organization_id=? AND deleted_at IS NULL AND status='closed_won' AND substr(closed_at,1,10) BETWEEN ? AND ?",
    )
    .all(org, q.from, q.to)
    .filter((d) => unitIds.has(d.unit_id));
  const agents = db
    .prepare(
      "SELECT u.id,u.full_name FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id WHERE u.organization_id=? AND u.deleted_at IS NULL AND r.slug='agent'",
    )
    .all(org)
    .map((a) => ({
      id: String(a.id),
      name: String(a.full_name),
      assignedLeads: leads.filter((l) => l.assigned_agent_id === a.id).length,
      wonLeads: leads.filter(
        (l) => l.assigned_agent_id === a.id && l.stage === "won",
      ).length,
      closedDeals: deals.filter((d) => d.primary_agent_id === a.id).length,
      commissionMinor: deals.reduce((n, d) => {
        const splits = JSON.parse(String(d.agent_splits_json)) as {
          agentId: string;
          amountMinor: number;
        }[];
        return (
          n + Number(splits.find((s) => s.agentId === a.id)?.amountMinor || 0)
        );
      }, 0),
    }));
  const maintenanceCostMinor = Number(
    db
      .prepare(
        `SELECT COALESCE(SUM(w.actual_cost_minor),0) n FROM work_orders w JOIN maintenance_tickets t ON t.id=w.ticket_id AND t.organization_id=w.organization_id JOIN units u ON u.id=t.unit_id AND u.organization_id=t.organization_id WHERE w.organization_id=? AND w.deleted_at IS NULL AND w.status='completed' AND date(w.completed_at,'+5 hours') BETWEEN ? AND ? ${propertyClause}`,
      )
      .get(org, q.from, q.to, ...args.slice(1))!.n,
  );
  const vacant = units.filter((u) => u.status === "available"),
    occupied = units.filter((u) => u.status === "rented").length,
    denominator = units.filter((u) => u.status !== "sold").length;
  return {
    asOf: today(),
    occupancy: {
      totalUnits: units.length,
      rentalPoolUnits: denominator,
      occupiedUnits: occupied,
      availableUnits: vacant.length,
      occupancyPct: denominator
        ? Math.round((occupied / denominator) * 10000) / 100
        : 0,
    },
    vacancies: vacant.map((u) => ({
      unitId: String(u.id),
      unitNumber: String(u.unit_number),
      propertyName: String(u.property_name),
      vacantSince: u.vacant_since as string | null,
      vacantDays: u.vacant_since
        ? Math.max(
            0,
            Math.floor(
              (Date.parse(today()) -
                Date.parse(String(u.vacant_since).slice(0, 10))) /
                86400000,
            ),
          )
        : null,
    })),
    rent: {
      billedMinor: periodInvoices.reduce(
        (n, i) => n + Number(i.total_minor),
        0,
      ),
      invoiceSettledMinor: periodInvoices.reduce(
        (n, i) => n + Number(i.paid_minor),
        0,
      ),
      recordedReceiptsMinor: recordedPayments.reduce(
        (n, p) => n + Number(p.amount_minor),
        0,
      ),
    },
    aging: buckets,
    arrears,
    leadConversion: {
      leads: leads.length,
      won: leads.filter((l) => l.stage === "won").length,
      conversionPct: leads.length
        ? Math.round(
            (leads.filter((l) => l.stage === "won").length / leads.length) *
              10000,
          ) / 100
        : 0,
    },
    agents,
    maintenance: {
      actualCostMinor: maintenanceCostMinor,
      costPerUnitMinor: units.length
        ? Math.round(maintenanceCostMinor / units.length)
        : 0,
    },
  };
}
