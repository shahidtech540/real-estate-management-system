import { getDb } from "@/server/db";
import { HttpError } from "@/server/auth/guards";
import { newId, nowIso, today } from "../shared/domain";
import { recordAuditLog } from "../audit/audit.service";
export interface Share {
  ownerId: string | null;
  basisPoints: number;
}
export function ownership(org: string, property: string | null): Share[] {
  if (!property) return [{ ownerId: null, basisPoints: 10000 }];
  const shares = getDb()
    .prepare(
      `SELECT po.owner_id,po.ownership_pct FROM property_owners po JOIN owners o ON o.id=po.owner_id AND o.organization_id=po.organization_id WHERE po.organization_id=? AND po.property_id=? AND po.deleted_at IS NULL AND o.deleted_at IS NULL ORDER BY po.owner_id`,
    )
    .all(org, property)
    .map((r) => ({
      ownerId: String(r.owner_id),
      basisPoints: Math.round(Number(r.ownership_pct) * 100),
    }));
  const total = shares.reduce((n, s) => n + s.basisPoints, 0);
  if (total > 10000)
    throw new HttpError(
      409,
      "INVALID_OWNERSHIP",
      "Ownership exceeds 100%; correct allocations before posting.",
    );
  return [
    ...shares,
    ...(total < 10000 ? [{ ownerId: null, basisPoints: 10000 - total }] : []),
  ];
}
/** Largest remainder allocation: integer paisa, sum exactly equals original. */
export function allocate(amount: number, shares: Share[]) {
  const rows = shares.map((s, index) => ({
    ...s,
    index,
    amountMinor: Number((BigInt(amount) * BigInt(s.basisPoints)) / 10000n),
    remainder: Number((BigInt(amount) * BigInt(s.basisPoints)) % 10000n),
  }));
  let remaining = amount - rows.reduce((n, s) => n + s.amountMinor, 0);
  const ranked = [...rows].sort(
    (a, b) => b.remainder - a.remainder || a.index - b.index,
  );
  for (let i = 0; i < remaining; i++) ranked[i % ranked.length].amountMinor++;
  return rows;
}
export interface Posting {
  propertyId: string | null;
  date: string;
  description: string;
  sourceType: string;
  sourceId: string;
  reference: string;
  debitCode: string;
  creditCode: string;
  amountMinor: number;
  reverses?: string;
  shares?: Share[];
  allocations?: {
    ownerId: string | null;
    basisPoints: number;
    amountMinor: number;
  }[];
}
/** Caller owns transaction. Every supported journal has exactly one equal debit/credit. */
export function post(org: string, actor: string, b: Posting) {
  const db = getDb();
  if (
    !Number.isSafeInteger(b.amountMinor) ||
    b.amountMinor <= 0 ||
    b.amountMinor > 1e12
  )
    throw new HttpError(
      400,
      "INVALID_AMOUNT",
      "Post a positive integer amount in paisa.",
    );
  if (b.debitCode === b.creditCode)
    throw new HttpError(
      400,
      "SAME_ACCOUNT",
      "Debit and credit accounts must differ.",
    );
  const accounts = db
    .prepare(
      "SELECT id,code FROM accounts WHERE organization_id=? AND deleted_at IS NULL AND code IN (?,?)",
    )
    .all(org, b.debitCode, b.creditCode);
  if (accounts.length !== 2)
    throw new HttpError(
      404,
      "ACCOUNT_NOT_FOUND",
      "Account not found in this organization.",
    );
  const existing = db
    .prepare(
      "SELECT id,property_id,entry_date,description,source_type,source_id FROM journal_batches WHERE organization_id=? AND reference=?",
    )
    .get(org, b.reference);
  if (existing) {
    const entries = db
      .prepare(
        "SELECT a.code,l.direction,l.amount_minor FROM ledger_entries l JOIN accounts a ON a.id=l.account_id WHERE l.journal_id=? AND l.organization_id=?",
      )
      .all(existing.id, org);
    if (
      existing.source_type !== b.sourceType ||
      existing.source_id !== b.sourceId ||
      existing.property_id !== b.propertyId ||
      existing.entry_date !== b.date ||
      existing.description !== b.description ||
      !entries.some(
        (l) =>
          l.code === b.debitCode &&
          l.direction === "debit" &&
          l.amount_minor === b.amountMinor,
      ) ||
      !entries.some(
        (l) =>
          l.code === b.creditCode &&
          l.direction === "credit" &&
          l.amount_minor === b.amountMinor,
      )
    )
      throw new HttpError(
        409,
        "REFERENCE_CONFLICT",
        "Journal reference already used with different details.",
      );
    return String(existing.id);
  }
  const id = newId("jrn"),
    now = nowIso();
  db.prepare(
    "INSERT INTO journal_batches (id,organization_id,property_id,entry_date,description,source_type,source_id,reference,reversed_batch_id,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
  ).run(
    id,
    org,
    b.propertyId,
    b.date,
    b.description,
    b.sourceType,
    b.sourceId,
    b.reference,
    b.reverses || null,
    now,
    now,
    actor,
  );
  const shares =
    b.allocations ||
    allocate(b.amountMinor, b.shares || ownership(org, b.propertyId));
  for (const [i, code, direction] of [
    [1, b.debitCode, "debit"],
    [2, b.creditCode, "credit"],
  ] as const) {
    const lid = newId("led"),
      account = accounts.find((a) => a.code === code)!;
    db.prepare(
      `INSERT INTO ledger_entries (id,organization_id,account_id,property_id,entry_date,direction,amount_minor,category,description,created_at,updated_at,created_by,journal_id,line_number)
   VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).run(
      lid,
      org,
      account.id,
      b.propertyId,
      b.date,
      direction,
      b.amountMinor,
      b.sourceType,
      b.description,
      now,
      now,
      actor,
      id,
      i,
    );
    for (const share of shares)
      db.prepare(
        "INSERT INTO ledger_owner_allocations (id,organization_id,ledger_entry_id,owner_id,amount_minor,ownership_basis_points,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
      ).run(
        newId("loa"),
        org,
        lid,
        share.ownerId,
        share.amountMinor,
        share.basisPoints,
        now,
        actor,
      );
  }
  recordAuditLog({
    organizationId: org,
    actorUserId: actor,
    action: "accounting.journal_posted",
    entityType: "journal",
    entityId: id,
    metadata: {
      sourceType: b.sourceType,
      sourceId: b.sourceId,
      amountMinor: b.amountMinor,
      reference: b.reference,
    },
  });
  return id;
}
function target(
  org: string,
  actor: string,
  type: string,
  id: string,
  amount: number,
  property: string | null,
  date: string,
  debit: string,
  credit: string,
  description: string,
  shares?: Share[],
) {
  const db = getDb(),
    old = db
      .prepare(
        "SELECT * FROM accounting_source_state WHERE organization_id=? AND source_type=? AND source_id=?",
      )
      .get(org, type, id);
  if (old && old.property_id !== property)
    throw new HttpError(
      409,
      "SOURCE_MOVED",
      "A posted source changed property; use an audited correction, not a silent rewrite.",
    );
  const delta = amount - Number(old?.posted_minor || 0);
  if (!delta && old) return false;
  const revision = Number(old?.revision || 0) + 1,
    now = nowIso();
  if (delta)
    post(org, actor, {
      propertyId: property,
      date: old ? today() : date,
      description,
      sourceType: type,
      sourceId: id,
      reference: `source:${type}:${id}:${revision}`,
      debitCode: delta > 0 ? debit : credit,
      creditCode: delta > 0 ? credit : debit,
      amountMinor: Math.abs(delta),
      shares,
    });
  db.prepare(
    `INSERT INTO accounting_source_state (organization_id,source_type,source_id,posted_minor,property_id,revision,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,source_type,source_id) DO UPDATE SET posted_minor=excluded.posted_minor,revision=excluded.revision,updated_at=excluded.updated_at`,
  ).run(org, type, id, amount, property, revision, now, now, actor);
  return !!delta;
}
export function postInvoiceInternal(org: string, actor: string, id: string) {
  const db = getDb(),
    invoice = db
      .prepare(
        "SELECT * FROM invoices WHERE organization_id=? AND id=? AND deleted_at IS NULL",
      )
      .get(org, id);
  if (!invoice) return 0;
  const credits = db
    .prepare(
      "SELECT * FROM credit_notes WHERE organization_id=? AND invoice_id=? ORDER BY created_at,id",
    )
    .all(org, id);
  const payments = db
    .prepare(
      "SELECT * FROM payments WHERE organization_id=? AND invoice_id=? AND status='completed' AND deleted_at IS NULL ORDER BY paid_at,id",
    )
    .all(org, id);
  const paid = payments.reduce((n, p) => n + Number(p.amount_minor), 0),
    gap = Number(invoice.paid_minor) - paid;
  if (gap < 0)
    throw new HttpError(
      409,
      "PAYMENT_MISMATCH",
      "Recorded payments exceed invoice paid balance; reconcile source data first.",
    );
  const previous = db
    .prepare(
      "SELECT posted_minor FROM accounting_source_state WHERE organization_id=? AND source_type='legacy_settlement' AND source_id=?",
    )
    .get(org, id);
  if (previous && previous.posted_minor !== gap)
    throw new HttpError(
      409,
      "LEGACY_BALANCE_CHANGED",
      "Legacy settlement gap changed; investigate missing/altered payment records.",
    );
  const property = String(invoice.property_id),
    code =
      invoice.type === "utilities"
        ? "4010"
        : invoice.type === "rent"
          ? "4000"
          : "4020";
  const cancelled = invoice.status === "cancelled";
  if (cancelled && invoice.paid_minor)
    throw new HttpError(
      409,
      "PAID_CANCELLATION",
      "Cannot void an invoice with settlements.",
    );
  let count = Number(
    target(
      org,
      actor,
      "invoice",
      id,
      cancelled
        ? 0
        : Number(invoice.total_minor) +
            credits.reduce((n, c) => n + Number(c.amount_minor), 0),
      property,
      `${invoice.period_month}-01`,
      "1100",
      code,
      `Invoice ${invoice.invoice_number}: billed charges including fees`,
    ),
  );
  for (const credit of credits)
    count += Number(
      target(
        org,
        actor,
        "credit",
        String(credit.id),
        cancelled ? 0 : Number(credit.amount_minor),
        property,
        String(credit.created_at).slice(0, 10),
        code,
        "1100",
        `Credit ${credit.id}: ${credit.reason}`,
      ),
    );
  for (const payment of payments)
    count += Number(
      target(
        org,
        actor,
        "payment",
        String(payment.id),
        Number(payment.amount_minor),
        property,
        String(payment.paid_at).slice(0, 10),
        "1000",
        "1100",
        `Payment ${payment.reference_number}`,
      ),
    );
  count += Number(
    target(
      org,
      actor,
      "legacy_settlement",
      id,
      gap,
      property,
      `${invoice.period_month}-01`,
      "1190",
      "1100",
      `Legacy invoice settlement — no bank receipt: ${invoice.invoice_number}`,
    ),
  );
  return count;
}
export function postWorkOrderInternal(org: string, actor: string, id: string) {
  const row = getDb()
    .prepare(
      "SELECT w.*,t.property_id FROM work_orders w JOIN maintenance_tickets t ON t.id=w.ticket_id AND t.organization_id=w.organization_id WHERE w.organization_id=? AND w.id=? AND w.status='completed' AND w.deleted_at IS NULL",
    )
    .get(org, id);
  if (!row) return 0;
  return Number(
    target(
      org,
      actor,
      "work_order",
      id,
      Number(row.actual_cost_minor),
      String(row.property_id),
      String(row.completed_at).slice(0, 10),
      "5000",
      "2000",
      `Completed maintenance ${row.work_order_number}`,
    ),
  );
}

export function postDepositsInternal(
  org: string,
  actor: string,
  leaseId?: string,
) {
  const db = getDb();
  let count = 0;
  for (const e of db
    .prepare(
      `SELECT e.*,l.property_id FROM lease_events e JOIN leases l ON l.id=e.lease_id AND l.organization_id=e.organization_id WHERE e.organization_id=? AND e.type IN ('deposit_received','deposit_refunded') ${leaseId ? "AND e.lease_id=?" : ""} ORDER BY e.created_at,e.id`,
    )
    .all(org, ...(leaseId ? [leaseId] : []))) {
    const payload = JSON.parse(String(e.payload_json)),
      received = e.type === "deposit_received";
    count += Number(
      target(
        org,
        actor,
        "deposit",
        String(e.id),
        Number(payload.amountMinor),
        String(e.property_id),
        String(e.created_at).slice(0, 10),
        received ? "1000" : "2100",
        received ? "2100" : "1000",
        `${e.type}: ${payload.reference}`,
      ),
    );
  }
  return count;
}
export function postPayoutsInternal(
  org: string,
  actor: string,
  statementId?: string,
) {
  let count = 0;
  for (const p of getDb()
    .prepare(
      `SELECT p.*,s.owner_id FROM statement_payouts p JOIN owner_statements s ON s.id=p.statement_id AND s.organization_id=p.organization_id WHERE p.organization_id=? ${statementId ? "AND p.statement_id=?" : ""} ORDER BY p.paid_at,p.id`,
    )
    .all(org, ...(statementId ? [statementId] : [])))
    count += Number(
      target(
        org,
        actor,
        "owner_payout",
        String(p.id),
        Number(p.amount_minor),
        null,
        String(p.paid_at).slice(0, 10),
        "3100",
        "1000",
        `Owner distribution: ${p.reference_number}`,
        [{ ownerId: String(p.owner_id), basisPoints: 10000 }],
      ),
    );
  return count;
}
