import { z } from "zod";
import { getDb } from "@/server/db";
import { HttpError, requirePermission } from "@/server/auth/guards";
import type { JwtPayload } from "@/server/auth/crypto";
import {
  atomic,
  newId,
  nowIso,
  today,
  valid,
  sourceDate,
  dateSchema,
  monthSchema,
  moneySchema,
} from "../shared/domain";
import { recordAuditLog } from "../audit/audit.service";
import {
  post,
  postInvoiceInternal,
  postWorkOrderInternal,
  postDepositsInternal,
  postPayoutsInternal,
  ownership,
  allocate,
  type Share,
} from "./posting";
const id = z.string().min(1).max(180),
  text = z.string().trim().min(3).max(1000),
  reference = z
    .string()
    .trim()
    .min(3)
    .max(100)
    .refine(
      (s) => !s.startsWith("source:") && !s.startsWith("reversal:"),
      "Reserved reference prefix",
    );
function audit(
  ctx: JwtPayload,
  action: string,
  entityId: string,
  metadata: Record<string, unknown> = {},
) {
  recordAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.sub,
    action,
    entityType: "accounting",
    entityId,
    metadata,
  });
}
function property(org: string, p: string) {
  if (
    !getDb()
      .prepare(
        "SELECT id FROM properties WHERE organization_id=? AND id=? AND deleted_at IS NULL",
      )
      .get(org, p)
  )
    throw new HttpError(404, "NOT_FOUND", "Project not found.");
  return p;
}
function account(org: string, code: string, type?: string) {
  const row = getDb()
    .prepare(
      "SELECT * FROM accounts WHERE organization_id=? AND code=? AND deleted_at IS NULL",
    )
    .get(org, code);
  if (!row || (type && row.type !== type))
    throw new HttpError(
      404,
      "NOT_FOUND",
      "Account not found or wrong account type.",
    );
  return row;
}
function dateAllowed(date: string) {
  if (date > today())
    throw new HttpError(
      400,
      "FUTURE_DATE",
      "Financial entries cannot be dated in the future.",
    );
}
export function accountingCatalog(ctx: JwtPayload) {
  requirePermission(ctx, "accounting:read");
  const db = getDb(),
    org = ctx.organizationId;
  return {
    accounts: db
      .prepare(
        "SELECT id,code,name,type,currency FROM accounts WHERE organization_id=? AND deleted_at IS NULL ORDER BY code",
      )
      .all(org),
    projects: db
      .prepare(
        "SELECT id,name FROM properties WHERE organization_id=? AND deleted_at IS NULL ORDER BY name",
      )
      .all(org),
    owners: db
      .prepare(
        "SELECT id,full_name AS name FROM owners WHERE organization_id=? AND deleted_at IS NULL ORDER BY full_name",
      )
      .all(org),
    expenses: db
      .prepare(
        "SELECT e.id,e.property_id,e.amount_minor,e.expense_date,e.description,e.reference,e.status,e.receipt_name,e.void_reason,a.code AS account_code FROM accounting_expenses e JOIN accounts a ON a.id=e.account_id AND a.organization_id=e.organization_id WHERE e.organization_id=? ORDER BY e.created_at DESC,e.id DESC LIMIT 100",
      )
      .all(org),
    payables: db
      .prepare(
        `SELECT w.id,w.work_order_number,w.actual_cost_minor,w.completed_at,t.property_id,v.name AS vendor_name,p.reference AS paid_reference FROM work_orders w JOIN maintenance_tickets t ON t.id=w.ticket_id AND t.organization_id=w.organization_id JOIN vendors v ON v.id=w.vendor_id AND v.organization_id=w.organization_id LEFT JOIN accounting_vendor_payments p ON p.work_order_id=w.id AND p.organization_id=w.organization_id WHERE w.organization_id=? AND w.status='completed' AND w.deleted_at IS NULL ORDER BY w.completed_at DESC,w.id LIMIT 100`,
      )
      .all(org),
  };
}
export function syncSourcesInternal(org: string, actor: string) {
  return atomic(() => {
    const db = getDb();
    let posted = 0;
    for (const row of db
      .prepare(
        "SELECT id FROM invoices WHERE organization_id=? AND deleted_at IS NULL ORDER BY period_month,id",
      )
      .all(org))
      posted += postInvoiceInternal(org, actor, String(row.id));
    for (const row of db
      .prepare(
        "SELECT id FROM work_orders WHERE organization_id=? AND status='completed' AND deleted_at IS NULL ORDER BY completed_at,id",
      )
      .all(org))
      posted += postWorkOrderInternal(org, actor, String(row.id));
    posted +=
      postDepositsInternal(org, actor) + postPayoutsInternal(org, actor);
    return { posted };
  });
}
export function synchronize(ctx: JwtPayload) {
  requirePermission(ctx, "accounting:write");
  return syncSourcesInternal(ctx.organizationId, ctx.sub);
}
export function createAccount(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  const b = valid(
    z
      .object({
        code: z.string().regex(/^[1-5][0-9]{3}$/),
        name: z.string().trim().min(3).max(120),
        type: z.enum(["asset", "liability", "equity", "income", "expense"]),
      })
      .strict(),
    input,
  );
  if (
    Number(b.code[0]) !==
    ["asset", "liability", "equity", "income", "expense"].indexOf(b.type) + 1
  )
    throw new HttpError(
      400,
      "CODE_TYPE",
      "Code prefix must match account type (1 asset, 2 liability, 3 equity, 4 income, 5 expense).",
    );
  return atomic(() => {
    const db = getDb();
    if (
      db
        .prepare("SELECT id FROM accounts WHERE organization_id=? AND code=?")
        .get(ctx.organizationId, b.code)
    )
      throw new HttpError(
        409,
        "DUPLICATE_CODE",
        "Account code is already in use.",
      );
    const aid = newId("acc"),
      now = nowIso();
    db.prepare(
      "INSERT INTO accounts (id,organization_id,code,name,type,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
    ).run(aid, ctx.organizationId, b.code, b.name, b.type, now, now, ctx.sub);
    audit(ctx, "accounting.account_created", aid, b);
    return { id: aid };
  });
}
export function manualJournal(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  const b = valid(
    z
      .object({
        propertyId: id.nullable(),
        entryDate: dateSchema,
        debitCode: z.string(),
        creditCode: z.string(),
        amountMinor: moneySchema.positive(),
        description: text,
        reference,
      })
      .strict(),
    input,
  );
  dateAllowed(b.entryDate);
  if (
    [b.debitCode, b.creditCode].some((c) =>
      ["1100", "2000", "2100"].includes(c),
    )
  )
    throw new HttpError(
      400,
      "CONTROL_ACCOUNT",
      "Receivables, payables and deposits are source-controlled. Use rent, deposit or vendor payment workflows.",
    );
  return atomic(() => {
    if (b.propertyId) property(ctx.organizationId, b.propertyId);
    account(ctx.organizationId, b.debitCode);
    account(ctx.organizationId, b.creditCode);
    const journalId = post(ctx.organizationId, ctx.sub, {
      propertyId: b.propertyId,
      date: b.entryDate,
      debitCode: b.debitCode,
      creditCode: b.creditCode,
      amountMinor: b.amountMinor,
      description: b.description,
      reference: b.reference,
      sourceType: "manual",
      sourceId: b.reference,
    });
    return { journalId };
  });
}
export function reverseJournal(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  const b = valid(
    z.object({ id, entryDate: dateSchema, reason: text }).strict(),
    input,
  );
  dateAllowed(b.entryDate);
  return atomic(() => {
    const db = getDb(),
      org = ctx.organizationId,
      row = db
        .prepare(
          "SELECT * FROM journal_batches WHERE organization_id=? AND id=? AND source_type='manual'",
        )
        .get(org, b.id);
    if (!row)
      throw new HttpError(
        404,
        "NOT_FOUND",
        "Manual journal not found; correct other journals through their source workflow.",
      );
    if (b.entryDate < String(row.entry_date))
      throw new HttpError(
        400,
        "REVERSAL_DATE",
        "Reversal cannot precede original journal.",
      );
    const old = db
      .prepare(
        "SELECT id,description,entry_date FROM journal_batches WHERE organization_id=? AND reversed_batch_id=?",
      )
      .get(org, b.id);
    if (old) {
      if (
        old.description !== `Reversal: ${b.reason}` ||
        old.entry_date !== b.entryDate
      )
        throw new HttpError(
          409,
          "ALREADY_REVERSED",
          "Already reversed with different details.",
        );
      return { journalId: String(old.id) };
    }
    const journalId = reverseInternal(ctx, row, b.entryDate, b.reason);
    audit(ctx, "accounting.journal_reversed", b.id, {
      reason: b.reason,
      journalId,
    });
    return { journalId };
  });
}
function reverseInternal(
  ctx: JwtPayload,
  row: Record<string, unknown>,
  date: string,
  reason: string,
) {
  const db = getDb(),
    lines = db
      .prepare(
        "SELECT l.id,a.code,l.direction,l.amount_minor FROM ledger_entries l JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id WHERE l.organization_id=? AND l.journal_id=? ORDER BY l.line_number",
      )
      .all(ctx.organizationId, String(row.id));
  const allocations = db
    .prepare(
      "SELECT owner_id,amount_minor,ownership_basis_points FROM ledger_owner_allocations WHERE organization_id=? AND ledger_entry_id=? ORDER BY id",
    )
    .all(ctx.organizationId, lines[0].id)
    .map((r) => ({
      ownerId: r.owner_id as string | null,
      basisPoints: Number(r.ownership_basis_points),
      amountMinor: Number(r.amount_minor),
    }));
  const journalId = post(ctx.organizationId, ctx.sub, {
    propertyId: row.property_id as string | null,
    date,
    description: `Reversal: ${reason}`,
    sourceType: "reversal",
    sourceId: String(row.id),
    reference: `reversal:${row.id}`,
    reverses: String(row.id),
    debitCode: String(lines.find((l) => l.direction === "credit")!.code),
    creditCode: String(lines.find((l) => l.direction === "debit")!.code),
    amountMinor: Number(lines[0].amount_minor),
    allocations,
  });
  return journalId;
}
const receiptSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    data: z.string().max(4_200_000),
  })
  .strict();
function receipt(input: z.infer<typeof receiptSchema> | undefined) {
  if (!input) return { name: null, mime: null, data: null };
  const m = input.data.match(
    /^data:(image\/png|image\/jpeg|image\/webp|application\/pdf);base64,([A-Za-z0-9+/]+={0,2})$/,
  );
  if (!m)
    throw new HttpError(
      400,
      "RECEIPT_TYPE",
      "Upload a PNG, JPEG, WebP or PDF receipt.",
    );
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 3 * 1024 * 1024 || bytes.toString("base64") !== m[2])
    throw new HttpError(
      400,
      "RECEIPT_SIZE",
      "Receipt must be valid base64 and at most 3 MiB.",
    );
  const signature =
    m[1] === "application/pdf"
      ? bytes.subarray(0, 5).toString() === "%PDF-"
      : m[1] === "image/png"
        ? bytes
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : m[1] === "image/jpeg"
          ? bytes.subarray(0, 3).equals(Buffer.from([255, 216, 255]))
          : bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WEBP";
  if (!signature)
    throw new HttpError(
      400,
      "RECEIPT_SIGNATURE",
      "Receipt content does not match its file type.",
    );
  return { name: input.name, mime: m[1], data: m[2] };
}
export function createExpense(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  const b = valid(
      z
        .object({
          propertyId: id,
          accountCode: z.string(),
          amountMinor: moneySchema.positive(),
          expenseDate: dateSchema,
          description: text,
          reference,
          receipt: receiptSchema.optional(),
        })
        .strict(),
      input,
    ),
    r = receipt(b.receipt);
  dateAllowed(b.expenseDate);
  return atomic(() => {
    const org = ctx.organizationId,
      db = getDb();
    property(org, b.propertyId);
    const a = account(org, b.accountCode, "expense");
    const existing = db
      .prepare(
        "SELECT id,property_id,account_id,amount_minor,expense_date,description,receipt_name,receipt_data,status FROM accounting_expenses WHERE organization_id=? AND reference=?",
      )
      .get(org, b.reference);
    if (existing) {
      if (
        existing.status !== "posted" ||
        existing.property_id !== b.propertyId ||
        existing.account_id !== a.id ||
        existing.amount_minor !== b.amountMinor ||
        existing.expense_date !== b.expenseDate ||
        existing.description !== b.description ||
        existing.receipt_name !== r.name ||
        existing.receipt_data !== r.data
      )
        throw new HttpError(
          409,
          "REFERENCE_CONFLICT",
          "Expense reference already used with different details.",
        );
      return { id: String(existing.id) };
    }
    const eid = newId("exp"),
      now = nowIso(),
      journalId = post(org, ctx.sub, {
        propertyId: b.propertyId,
        date: b.expenseDate,
        debitCode: b.accountCode,
        creditCode: "1000",
        amountMinor: b.amountMinor,
        description: b.description,
        reference: b.reference,
        sourceType: "expense",
        sourceId: eid,
      });
    db.prepare(
      "INSERT INTO accounting_expenses (id,organization_id,property_id,account_id,amount_minor,expense_date,description,reference,journal_id,receipt_name,receipt_mime,receipt_data,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      eid,
      org,
      b.propertyId,
      a.id,
      b.amountMinor,
      b.expenseDate,
      b.description,
      b.reference,
      journalId,
      r.name,
      r.mime,
      r.data,
      now,
      now,
      ctx.sub,
    );
    audit(ctx, "accounting.expense_created", eid, {
      amountMinor: b.amountMinor,
      receipt: !!r.data,
    });
    return { id: eid };
  });
}
export function voidExpense(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  const b = valid(
    z.object({ id, entryDate: dateSchema, reason: text }).strict(),
    input,
  );
  dateAllowed(b.entryDate);
  return atomic(() => {
    const db = getDb(),
      row = db
        .prepare(
          "SELECT e.*,j.entry_date,j.source_type FROM accounting_expenses e JOIN journal_batches j ON j.id=e.journal_id AND j.organization_id=e.organization_id WHERE e.organization_id=? AND e.id=?",
        )
        .get(ctx.organizationId, b.id);
    if (!row) throw new HttpError(404, "NOT_FOUND", "Expense not found.");
    if (b.entryDate < String(row.entry_date))
      throw new HttpError(
        400,
        "REVERSAL_DATE",
        "Void date cannot precede the expense.",
      );
    if (row.status === "void") {
      const rev = db
        .prepare(
          "SELECT entry_date FROM journal_batches WHERE organization_id=? AND reversed_batch_id=?",
        )
        .get(ctx.organizationId, row.journal_id);
      if (row.void_reason !== b.reason || rev?.entry_date !== b.entryDate)
        throw new HttpError(
          409,
          "ALREADY_VOID",
          "Expense already voided with different details.",
        );
      return { id: b.id };
    }
    reverseInternal(ctx, { ...row, id: row.journal_id }, b.entryDate, b.reason);
    db.prepare(
      "UPDATE accounting_expenses SET status='void',void_reason=?,updated_at=? WHERE organization_id=? AND id=?",
    ).run(b.reason, nowIso(), ctx.organizationId, b.id);
    audit(ctx, "accounting.expense_voided", b.id, { reason: b.reason });
    return { id: b.id };
  });
}
export function expenseReceipt(ctx: JwtPayload, eid: string) {
  requirePermission(ctx, "accounting:read");
  const row = getDb()
    .prepare(
      "SELECT receipt_name,receipt_mime,receipt_data FROM accounting_expenses WHERE organization_id=? AND id=? AND receipt_data IS NOT NULL",
    )
    .get(ctx.organizationId, eid);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Receipt not found.");
  return {
    name: String(row.receipt_name),
    mime: String(row.receipt_mime),
    bytes: Buffer.from(String(row.receipt_data), "base64"),
  };
}
export function payVendor(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  const b = valid(
    z.object({ workOrderId: id, paidDate: dateSchema, reference }).strict(),
    input,
  );
  dateAllowed(b.paidDate);
  return atomic(() => {
    const db = getDb(),
      org = ctx.organizationId,
      row = db
        .prepare(
          "SELECT w.*,t.property_id FROM work_orders w JOIN maintenance_tickets t ON t.id=w.ticket_id AND t.organization_id=w.organization_id WHERE w.organization_id=? AND w.id=? AND w.status='completed' AND w.deleted_at IS NULL",
        )
        .get(org, b.workOrderId);
    if (!row)
      throw new HttpError(404, "NOT_FOUND", "Completed work order not found.");
    if (b.paidDate < sourceDate(String(row.completed_at)))
      throw new HttpError(
        400,
        "PAYMENT_DATE",
        "Payment cannot precede completion.",
      );
    if (!row.actual_cost_minor)
      throw new HttpError(400, "ZERO_PAYABLE", "There is no cost to settle.");
    const previous = db
      .prepare(
        "SELECT id,reference,paid_date FROM accounting_vendor_payments WHERE organization_id=? AND work_order_id=?",
      )
      .get(org, b.workOrderId);
    if (previous) {
      if (
        previous.reference !== b.reference ||
        previous.paid_date !== b.paidDate
      )
        throw new HttpError(
          409,
          "ALREADY_PAID",
          "Work order was already settled with different details.",
        );
      return { id: String(previous.id) };
    }
    if (
      db
        .prepare(
          "SELECT id FROM accounting_vendor_payments WHERE organization_id=? AND reference=?",
        )
        .get(org, b.reference)
    )
      throw new HttpError(
        409,
        "REFERENCE_CONFLICT",
        "Vendor payment reference already used.",
      );
    postWorkOrderInternal(org, ctx.sub, b.workOrderId);
    const pid = newId("vpay"),
      now = nowIso(),
      journalId = post(org, ctx.sub, {
        propertyId: String(row.property_id),
        date: b.paidDate,
        debitCode: "2000",
        creditCode: "1000",
        amountMinor: Number(row.actual_cost_minor),
        description: `Recorded vendor payment ${row.work_order_number}`,
        reference: b.reference,
        sourceType: "vendor_payment",
        sourceId: pid,
      });
    db.prepare(
      "INSERT INTO accounting_vendor_payments VALUES (?,?,?,?,?,?,?,?,?,?)",
    ).run(
      pid,
      org,
      b.workOrderId,
      b.reference,
      b.paidDate,
      row.actual_cost_minor,
      journalId,
      now,
      now,
      ctx.sub,
    );
    audit(ctx, "accounting.vendor_payment_recorded", pid, {
      workOrderId: b.workOrderId,
    });
    return { id: pid };
  });
}
export function saveBudget(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  const b = valid(
    z
      .object({
        propertyId: id,
        accountCode: z.string(),
        periodMonth: monthSchema,
        amountMinor: moneySchema,
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const db = getDb(),
      org = ctx.organizationId;
    property(org, b.propertyId);
    const a = account(org, b.accountCode, "expense"),
      bid = newId("bgt"),
      now = nowIso();
    db.prepare(
      `INSERT INTO accounting_budgets VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,property_id,account_id,period_month) DO UPDATE SET amount_minor=excluded.amount_minor,owner_shares_json=excluded.owner_shares_json,updated_at=excluded.updated_at,created_by=excluded.created_by`,
    ).run(
      bid,
      org,
      b.propertyId,
      a.id,
      b.periodMonth,
      b.amountMinor,
      JSON.stringify(ownership(org, b.propertyId)),
      now,
      now,
      ctx.sub,
    );
    audit(
      ctx,
      "accounting.budget_saved",
      `${b.propertyId}:${b.accountCode}:${b.periodMonth}`,
      { amountMinor: b.amountMinor },
    );
    return { saved: true };
  });
}
export function budgetOwnerAmount(
  amount: number,
  json: string,
  ownerId?: string,
) {
  return ownerId
    ? allocate(amount, JSON.parse(json) as Share[]).find(
        (a) => a.ownerId === ownerId,
      )?.amountMinor || 0
    : amount;
}
