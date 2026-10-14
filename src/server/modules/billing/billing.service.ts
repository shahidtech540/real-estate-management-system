import { postInvoiceInternal, postPayoutsInternal } from "../accounting/posting";
import { savepoint } from "../shared/domain";
import { getDb } from "@/server/db";
import {
  newId,
  nowIso,
  today,
  valid,
  dateSchema,
  monthSchema,
  moneySchema,
  atomic,
} from "@/server/modules/shared/domain";
import { z } from "zod";
import { HttpError } from "@/server/auth/guards";
import { recordAuditLog } from "@/server/modules/audit/audit.service";

export type InvoiceType =
  "rent" | "utilities" | "maintenance" | "parking" | "service_charge";
export type InvoiceStatus =
  "pending" | "partially_paid" | "paid" | "overdue" | "cancelled";
export type PaymentMethod =
  "bank_transfer" | "cash" | "jazzcash" | "easypaisa" | "stripe";
export type AgingBucket = "current" | "0_30" | "30_60" | "60_90" | "90_plus";

export interface InvoiceRecord {
  id: string;
  organizationId: string;
  leaseId: string;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitNumber: string;
  tenantId: string;
  tenantName: string;
  tenantPhone: string;
  invoiceNumber: string;
  type: InvoiceType;
  periodMonth: string;
  dueDate: string;
  amountMinor: number;
  lateFeeMinor: number;
  totalMinor: number;
  paidMinor: number;
  balanceMinor: number;
  currency: string;
  status: InvoiceStatus;
  daysOverdue: number;
  agingBucket: AgingBucket;
  createdAt: string;
}

export interface PaymentReceiptRecord {
  paymentId: string;
  receiptId: string;
  receiptNumber: string;
  invoiceId: string;
  invoiceNumber: string;
  periodMonth: string;
  tenantId: string;
  tenantName: string;
  unitNumber: string;
  propertyName: string;
  method: PaymentMethod;
  referenceNumber: string;
  amountMinor: number;
  overpaymentMinor: number;
  currency: string;
  paidAt: string;
  pdfUrl: string;
}

export interface OwnerStatementLineItem {
  propertyId: string;
  propertyCode: string;
  propertyName: string;
  ownershipPct: number;
  totalPropertyRentCollectedMinor: number;
  ownerShareGrossRentMinor: number;
  ownerShareExpensesMinor: number;
}

export interface OwnerStatementRecord {
  id: string;
  organizationId: string;
  ownerId: string;
  ownerName: string;
  ownerEmail: string;
  bankName: string | null;
  iban: string | null;
  periodMonth: string;
  grossRentMinor: number;
  expensesMinor: number;
  managementFeePct: number;
  managementFeeMinor: number;
  netPayoutMinor: number;
  currency: string;
  status: string;
  lineItems: OwnerStatementLineItem[];
  createdAt: string;
}

export function computeInvoiceAging(
  dueDateStr: string,
  balanceMinor: number,
  asOf = today(),
): { daysOverdue: number; agingBucket: AgingBucket } {
  if (balanceMinor <= 0) {
    return { daysOverdue: 0, agingBucket: "current" };
  }
  const due = new Date(`${dueDateStr.slice(0, 10)}T00:00:00.000Z`);
  const diffDays = Math.floor(
    (new Date(asOf).getTime() - due.getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays <= 0) {
    return { daysOverdue: 0, agingBucket: "current" };
  }
  if (diffDays <= 30) {
    return { daysOverdue: diffDays, agingBucket: "0_30" };
  }
  if (diffDays <= 60) {
    return { daysOverdue: diffDays, agingBucket: "30_60" };
  }
  if (diffDays <= 90) {
    return { daysOverdue: diffDays, agingBucket: "60_90" };
  }
  return { daysOverdue: diffDays, agingBucket: "90_plus" };
}

export function listInvoices(params: {
  organizationId: string;
  status?: string;
  periodMonth?: string;
  tenantId?: string;
  limit?: number;
}): InvoiceRecord[] {
  const db = getDb();
  const clauses: string[] = ["i.organization_id = ?", "i.deleted_at IS NULL"];
  const args: (string | number)[] = [params.organizationId];

  if (params.status) {
    clauses.push("i.status = ?");
    args.push(params.status);
  }
  if (params.periodMonth) {
    clauses.push("i.period_month = ?");
    args.push(params.periodMonth);
  }
  if (params.tenantId) {
    clauses.push("i.tenant_id = ?");
    args.push(params.tenantId);
  }

  const limit = params.limit || 100;
  const rows = db
    .prepare(
      `SELECT
        i.id,
        i.organization_id AS organizationId,
        i.lease_id AS leaseId,
        i.property_id AS propertyId,
        p.name AS propertyName,
        i.unit_id AS unitId,
        u.unit_number AS unitNumber,
        i.tenant_id AS tenantId,
        t.full_name AS tenantName,
        t.phone AS tenantPhone,
        i.invoice_number AS invoiceNumber,
        i.type,
        i.period_month AS periodMonth,
        i.due_date AS dueDate,
        i.amount_minor AS amountMinor,
        i.late_fee_minor AS lateFeeMinor,
        i.total_minor AS totalMinor,
        i.paid_minor AS paidMinor,
        i.currency,
        i.status,
        i.created_at AS createdAt
       FROM invoices i
       JOIN properties p ON p.id = i.property_id
       JOIN units u ON u.id = i.unit_id
       JOIN tenants t ON t.id = i.tenant_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY i.period_month DESC, i.invoice_number ASC
       LIMIT ?`,
    )
    .all(...args, limit) as Array<
    Omit<InvoiceRecord, "balanceMinor" | "daysOverdue" | "agingBucket">
  >;

  return rows.map((r) => {
    const balanceMinor = Math.max(0, r.totalMinor - r.paidMinor);
    const aging = computeInvoiceAging(r.dueDate, balanceMinor);
    return {
      ...r,
      balanceMinor,
      daysOverdue: aging.daysOverdue,
      agingBucket: aging.agingBucket,
    };
  });
}

/**
 * Generates recurring monthly rent invoices for all active/expiring/renewed leases
 * for the given YYYY-MM period (idempotent per lease + periodMonth).
 */
export function generateMonthlyRentCycle(
  organizationId: string,
  actorUserId: string,
  periodMonth: string,
) {
  valid(monthSchema, periodMonth);
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
    throw new HttpError(
      400,
      "INVALID_PERIOD",
      "periodMonth must be in YYYY-MM format.",
    );
  }

  const db = getDb();
  const activeLeases = db
    .prepare(
      `SELECT id, property_id AS propertyId, unit_id AS unitId, tenant_id AS tenantId,
              rent_minor AS rentMinor, due_day AS dueDay, start_date AS startDate, end_date AS endDate
       FROM leases
       WHERE organization_id = ? AND status IN ('active', 'expiring', 'renewed') AND deleted_at IS NULL`,
    )
    .all(organizationId) as Array<{
    id: string;
    propertyId: string;
    unitId: string;
    tenantId: string;
    rentMinor: number;
    dueDay: number;
    startDate: string;
    endDate: string;
  }>;

  const now = nowIso();
  let generatedCount = 0;
  let skippedCount = 0;
  let totalBilledMinor = 0;

  const insertInv = db.prepare(
    `INSERT INTO invoices (
      id, organization_id, lease_id, property_id, unit_id, tenant_id,
      invoice_number, type, period_month, due_date, amount_minor,
      late_fee_minor, total_minor, paid_minor, currency, status,
      created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 'rent', ?, ?, ?, 0, ?, 0, 'PKR', 'pending', ?, ?, ?)`,
  );

  return atomic(() => {
    for (let idx = 0; idx < activeLeases.length; idx++) {
      const lease = activeLeases[idx];
      if (
        periodMonth < lease.startDate.slice(0, 7) ||
        periodMonth > lease.endDate.slice(0, 7)
      ) {
        skippedCount++;
        continue;
      }
      const existing = db
        .prepare(
          `SELECT id FROM invoices
         WHERE organization_id = ? AND lease_id = ? AND period_month = ? AND type = 'rent' AND deleted_at IS NULL`,
        )
        .get(organizationId, lease.id, periodMonth) as
        { id: string } | undefined;

      if (existing) {
        skippedCount++;
        continue;
      }

      const invId = newId("inv");
      const dueDayStr = String(
        Math.min(28, Math.max(1, lease.dueDay || 5)),
      ).padStart(2, "0");
      const dueDate = `${periodMonth}-${dueDayStr}`;
      const invNumber = `INV-${periodMonth.replace("-", "")}-${String(
        idx + 1,
      ).padStart(3, "0")}-${invId.slice(-4).toUpperCase()}`;

      insertInv.run(
        invId,
        organizationId,
        lease.id,
        lease.propertyId,
        lease.unitId,
        lease.tenantId,
        invNumber,
        periodMonth,
        dueDate,
        lease.rentMinor,
        lease.rentMinor,
        now,
        now,
        actorUserId,
      );

      generatedCount++;
      totalBilledMinor += lease.rentMinor;
    }

    for (const charge of listRecurringCharges(organizationId)) {
      const lease = activeLeases.find((l) => l.id === charge.leaseId);
      if (
        !lease ||
        periodMonth < charge.startMonth ||
        periodMonth > charge.endMonth ||
        periodMonth < lease.startDate.slice(0, 7) ||
        periodMonth > lease.endDate.slice(0, 7)
      )
        continue;
      if (
        db
          .prepare(
            "SELECT invoice_id FROM recurring_charge_invoices WHERE charge_id = ? AND period_month = ?",
          )
          .get(charge.id, periodMonth)
      ) {
        skippedCount++;
        continue;
      }
      const invoice = createAdHocInvoice(organizationId, actorUserId, {
        leaseId: charge.leaseId,
        type: charge.type,
        periodMonth,
        dueDate: `${periodMonth}-${String(lease.dueDay).padStart(2, "0")}`,
        amountMinor: charge.amountMinor,
      });
      db.prepare("INSERT INTO recurring_charge_invoices VALUES (?, ?, ?)").run(
        charge.id,
        periodMonth,
        invoice.id,
      );
      generatedCount++;
      totalBilledMinor += charge.amountMinor;
    }
    recordAuditLog({
      organizationId,
      actorUserId,
      action: "billing.rent_cycle_generated",
      entityType: "invoice_batch",
      entityId: periodMonth,
      metadata: { periodMonth, generatedCount, skippedCount, totalBilledMinor },
    });

    for(const invoice of db.prepare("SELECT id FROM invoices WHERE organization_id=? AND period_month=? AND deleted_at IS NULL").all(organizationId,periodMonth)) postInvoiceInternal(organizationId,actorUserId,String(invoice.id));
    return {
      periodMonth,
      generatedCount,
      skippedCount,
      totalBilledMinor,
      invoices: listInvoices({ organizationId, periodMonth, limit: 100000 }),
    };
  });
}

export function createAdHocInvoice(
  organizationId: string,
  actorUserId: string,
  input: {
    leaseId: string;
    type: InvoiceType;
    periodMonth: string;
    dueDate: string;
    amountMinor: number;
  },
): InvoiceRecord {
  input = valid(
    z.object({
      leaseId: z.string().min(1),
      type: z.enum([
        "rent",
        "utilities",
        "maintenance",
        "parking",
        "service_charge",
      ]),
      periodMonth: monthSchema,
      dueDate: dateSchema,
      amountMinor: moneySchema.positive(),
    }),
    input,
  );
  return savepoint(() => {
  const db = getDb();
  const lease = db
    .prepare(
      `SELECT id, property_id AS propertyId, unit_id AS unitId, tenant_id AS tenantId
       FROM leases WHERE id = ? AND organization_id = ?`,
    )
    .get(input.leaseId, organizationId) as
    | { id: string; propertyId: string; unitId: string; tenantId: string }
    | undefined;
  if (!lease) {
    throw new HttpError(404, "LEASE_NOT_FOUND", "Lease not found.");
  }
  if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) {
    throw new HttpError(
      400,
      "INVALID_AMOUNT",
      "Invoice amount must be positive.",
    );
  }

  const id = newId("inv");
  const now = nowIso();
  const invoiceNumber = `INV-ADHOC-${id.slice(-6).toUpperCase()}`;
  const amt = Math.round(input.amountMinor);

  db.prepare(
    `INSERT INTO invoices (
      id, organization_id, lease_id, property_id, unit_id, tenant_id,
      invoice_number, type, period_month, due_date, amount_minor,
      late_fee_minor, total_minor, paid_minor, currency, status,
      created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 0, 'PKR', 'pending', ?, ?, ?)`,
  ).run(
    id,
    organizationId,
    lease.id,
    lease.propertyId,
    lease.unitId,
    lease.tenantId,
    invoiceNumber,
    input.type || "utilities",
    input.periodMonth,
    input.dueDate,
    amt,
    amt,
    now,
    now,
    actorUserId,
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "invoice.created",
    entityType: "invoice",
    entityId: id,
    metadata: { invoiceNumber, type: input.type, amountMinor: amt },
  });

  postInvoiceInternal(organizationId,actorUserId,id);
  return listInvoices({ organizationId, limit: 100000 }).find(
    (i) => i.id === id,
  )!;
  });
}

export function applyLateFees(
  organizationId: string,
  actorUserId: string,
  invoiceId?: string,
): { updatedCount: number; totalLateFeeAddedMinor: number } {
  const db = getDb();
  return atomic(() => {
    const candidates = db
      .prepare(
        `SELECT i.id, i.amount_minor AS amountMinor, i.late_fee_minor AS lateFeeMinor, i.paid_minor AS paidMinor, i.total_minor AS totalMinor, i.due_date AS dueDate, l.grace_days AS graceDays, l.late_fee_minor AS leaseLateFeeMinor FROM invoices i JOIN leases l ON l.id = i.lease_id WHERE i.organization_id = ? AND i.deleted_at IS NULL AND i.status IN ('pending','overdue','partially_paid') AND (? = '' OR i.id = ?)`,
      )
      .all(
        organizationId,
        invoiceId || "",
        invoiceId || "",
      ) as unknown as Array<{
      id: string;
      amountMinor: number;
      lateFeeMinor: number;
      paidMinor: number;
      totalMinor: number;
      dueDate: string;
      graceDays: number;
      leaseLateFeeMinor: number;
    }>;
    const now = nowIso();
    let updatedCount = 0,
      totalLateFeeAddedMinor = 0;
    for (const row of candidates) {
      const days = computeInvoiceAging(
        row.dueDate,
        row.totalMinor - row.paidMinor,
      ).daysOverdue;
      if (
        days <= row.graceDays ||
        row.lateFeeMinor > 0 ||
        row.paidMinor >= row.totalMinor
      )
        continue;
      // An existing credit note must not cause a waived late fee to be re-applied.
      if (
        db
          .prepare(
            "SELECT id FROM credit_notes WHERE organization_id = ? AND invoice_id = ?",
          )
          .get(organizationId, row.id)
      )
        continue;
      const feeToAdd = row.leaseLateFeeMinor;
      db.prepare(
        "UPDATE invoices SET late_fee_minor = ?, total_minor = total_minor + ?, status = CASE WHEN paid_minor > 0 THEN 'partially_paid' ELSE 'overdue' END, updated_at = ? WHERE id = ?",
      ).run(feeToAdd, feeToAdd, now, row.id);
      postInvoiceInternal(organizationId,actorUserId,row.id);
      updatedCount++;
      totalLateFeeAddedMinor += feeToAdd;
    }
    recordAuditLog({
      organizationId,
      actorUserId,
      action: "invoice.late_fees_applied",
      entityType: "invoice",
      entityId: invoiceId || "batch",
      metadata: { updatedCount, totalLateFeeAddedMinor },
    });

    return { updatedCount, totalLateFeeAddedMinor };
  });
}

export function issueCreditNote(
  organizationId: string,
  actorUserId: string,
  invoiceId: string,
  creditMinor: number,
  reason: string,
): InvoiceRecord {
  if (!Number.isFinite(creditMinor) || creditMinor <= 0) {
    throw new HttpError(
      400,
      "INVALID_CREDIT",
      "Credit note amount must be positive.",
    );
  }

  return atomic(() => {
    const db = getDb();
    const inv = db
      .prepare(
        `SELECT id, amount_minor AS amountMinor, late_fee_minor AS lateFeeMinor,
              total_minor AS totalMinor, paid_minor AS paidMinor
       FROM invoices WHERE id = ? AND organization_id = ?`,
      )
      .get(invoiceId, organizationId) as
      | {
          id: string;
          amountMinor: number;
          lateFeeMinor: number;
          totalMinor: number;
          paidMinor: number;
        }
      | undefined;

    if (!inv) {
      throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
    }

    valid(moneySchema.positive(), creditMinor);
    if (!reason?.trim())
      throw new HttpError(400, "REASON_REQUIRED", "Credit reason is required.");
    if (creditMinor > inv.totalMinor - inv.paidMinor)
      throw new HttpError(
        409,
        "EXCESS_CREDIT",
        "Credit exceeds outstanding balance.",
      );
    const credit = creditMinor;
    const newTotal = Math.max(0, inv.totalMinor - credit);
    const newLateFee = Math.max(0, inv.lateFeeMinor - credit);
    const newAmount = inv.amountMinor - Math.max(0, credit - inv.lateFeeMinor);
    const newStatus: InvoiceStatus =
      inv.paidMinor >= newTotal
        ? "paid"
        : inv.paidMinor > 0
          ? "partially_paid"
          : "pending";

    db.prepare(
      `UPDATE invoices
     SET amount_minor = ?, late_fee_minor = ?, total_minor = ?, status = ?, updated_at = ?
     WHERE id = ?`,
    ).run(newAmount, newLateFee, newTotal, newStatus, nowIso(), invoiceId);
    db.prepare("INSERT INTO credit_notes VALUES (?, ?, ?, ?, ?, ?, ?)").run(
      newId("crn"),
      organizationId,
      invoiceId,
      credit,
      reason.trim(),
      nowIso(),
      actorUserId,
    );

    recordAuditLog({
      organizationId,
      actorUserId,
      action: "invoice.credit_note_issued",
      entityType: "invoice",
      entityId: invoiceId,
      metadata: {
        creditMinor: credit,
        reason,
        newTotalMinor: newTotal,
        newStatus,
      },
    });

    postInvoiceInternal(organizationId,actorUserId,invoiceId);
    return listInvoices({ organizationId, limit: 100000 }).find(
      (i) => i.id === invoiceId,
    )!;
  });
}

export function recordPayment(
  organizationId: string,
  actorUserId: string,
  input: {
    invoiceId: string;
    method: PaymentMethod;
    amountMinor: number;
    referenceNumber?: string;
  },
): {
  invoice: InvoiceRecord;
  payment: PaymentReceiptRecord;
  overpaymentMinor: number;
} {
  return atomic(() => {
    const validMethods: PaymentMethod[] = [
      "bank_transfer",
      "cash",
      "jazzcash",
      "easypaisa",
      "stripe",
    ];
    if (!validMethods.includes(input.method)) {
      throw new HttpError(
        400,
        "INVALID_PAYMENT_METHOD",
        "Unsupported payment method.",
      );
    }
    if (!Number.isFinite(input.amountMinor) || input.amountMinor <= 0) {
      throw new HttpError(
        400,
        "INVALID_PAYMENT_AMOUNT",
        "Payment amount must be positive.",
      );
    }

    const db = getDb();
    const inv = db
      .prepare(
        `SELECT id, tenant_id AS tenantId, invoice_number AS invoiceNumber,
              total_minor AS totalMinor, paid_minor AS paidMinor
       FROM invoices WHERE id = ? AND organization_id = ?`,
      )
      .get(input.invoiceId, organizationId) as
      | {
          id: string;
          tenantId: string;
          invoiceNumber: string;
          totalMinor: number;
          paidMinor: number;
        }
      | undefined;

    if (!inv) {
      throw new HttpError(404, "INVOICE_NOT_FOUND", "Invoice not found.");
    }

    valid(moneySchema.positive(), input.amountMinor);
    if (
      db.prepare("SELECT status FROM invoices WHERE id = ?").get(inv.id)
        ?.status === "cancelled"
    )
      throw new HttpError(
        409,
        "CANCELLED_INVOICE",
        "Cannot pay a cancelled invoice.",
      );
    if (input.referenceNumber?.trim()) {
      const duplicate = listPaymentsAndReceipts(organizationId).find(
        (p) => p.referenceNumber === input.referenceNumber!.trim(),
      );
      if (duplicate) {
        if (
          duplicate.invoiceId !== input.invoiceId ||
          duplicate.amountMinor !== input.amountMinor ||
          duplicate.method !== input.method
        )
          throw new HttpError(
            409,
            "REFERENCE_CONFLICT",
            "Payment reference already used with different details.",
          );
        return {
          invoice: listInvoices({ organizationId, limit: 100000 }).find(
            (i) => i.id === inv.id,
          )!,
          payment: duplicate,
          overpaymentMinor: 0,
        };
      }
    }
    if (input.amountMinor > inv.totalMinor - inv.paidMinor)
      throw new HttpError(
        409,
        "OVERPAYMENT",
        "Payment exceeds the outstanding balance. Record a separate deposit instead.",
      );
    const amountMinor = input.amountMinor;
    const newPaidMinor = inv.paidMinor + amountMinor;
    const overpaymentMinor = Math.max(0, newPaidMinor - inv.totalMinor);
    const nextStatus: InvoiceStatus =
      newPaidMinor >= inv.totalMinor ? "paid" : "partially_paid";

    const paymentId = newId("pay");
    const receiptId = newId("rec");
    const now = nowIso();
    const refNumber =
      input.referenceNumber?.trim() ||
      `${input.method.toUpperCase()}-${paymentId.slice(-6).toUpperCase()}`;
    const receiptNumber = `RCP-${new Date().getFullYear()}-${receiptId.slice(-8).toUpperCase()}`;

    db.prepare(
      `INSERT INTO payments (
        id, organization_id, invoice_id, tenant_id, method, reference_number,
        amount_minor, currency, status, paid_at, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PKR', 'completed', ?, ?, ?, ?)`,
    ).run(
      paymentId,
      organizationId,
      inv.id,
      inv.tenantId,
      input.method,
      refNumber,
      amountMinor,
      now,
      now,
      now,
      actorUserId,
    );

    db.prepare(
      `INSERT INTO receipts (
        id, organization_id, payment_id, invoice_id, tenant_id, receipt_number,
        amount_minor, currency, issued_at, pdf_url, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, ?, ?)`,
    ).run(
      receiptId,
      organizationId,
      paymentId,
      inv.id,
      inv.tenantId,
      receiptNumber,
      amountMinor,
      now,
      `/api/v1/billing/receipts/${receiptId}`,
      now,
      now,
      actorUserId,
    );

    db.prepare(
      `UPDATE invoices SET paid_minor = ?, status = ?, updated_at = ? WHERE id = ?`,
    ).run(newPaidMinor, nextStatus, now, inv.id);

    recordAuditLog({
      organizationId,
      actorUserId,
      action: "payment.recorded",
      entityType: "payment",
      entityId: paymentId,
      metadata: {
        invoiceId: inv.id,
        invoiceNumber: inv.invoiceNumber,
        method: input.method,
        amountMinor,
        newStatus: nextStatus,
        receiptNumber,
        overpaymentMinor,
      },
    });

    postInvoiceInternal(organizationId,actorUserId,inv.id);
    const updatedInvoice = listInvoices({ organizationId, limit: 100000 }).find(
      (i) => i.id === inv.id,
    )!;
    const receipt = listPaymentsAndReceipts(organizationId).find(
      (r) => r.paymentId === paymentId,
    )!;

    return {
      invoice: updatedInvoice,
      payment: receipt,
      overpaymentMinor,
    };
  });
}

export function listPaymentsAndReceipts(
  organizationId: string,
  tenantId?: string,
): PaymentReceiptRecord[] {
  const db = getDb();
  const clauses = ["p.organization_id = ?", "p.deleted_at IS NULL"];
  const args: string[] = [organizationId];
  if (tenantId) {
    clauses.push("p.tenant_id = ?");
    args.push(tenantId);
  }

  const rows = db
    .prepare(
      `SELECT
        p.id AS paymentId,
        r.id AS receiptId,
        r.receipt_number AS receiptNumber,
        p.invoice_id AS invoiceId,
        i.invoice_number AS invoiceNumber,
        i.period_month AS periodMonth,
        i.total_minor AS invoiceTotalMinor,
        i.paid_minor AS invoicePaidMinor,
        p.tenant_id AS tenantId,
        t.full_name AS tenantName,
        u.unit_number AS unitNumber,
        prop.name AS propertyName,
        p.method,
        p.reference_number AS referenceNumber,
        p.amount_minor AS amountMinor,
        p.currency,
        p.paid_at AS paidAt,
        r.pdf_url AS pdfUrl
       FROM payments p
       JOIN receipts r ON r.payment_id = p.id
       JOIN invoices i ON i.id = p.invoice_id
       JOIN tenants t ON t.id = p.tenant_id
       JOIN units u ON u.id = i.unit_id
       JOIN properties prop ON prop.id = i.property_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY p.paid_at DESC`,
    )
    .all(...args) as Array<
    Omit<PaymentReceiptRecord, "overpaymentMinor"> & {
      invoiceTotalMinor: number;
      invoicePaidMinor: number;
    }
  >;

  return rows.map((r) => ({
    paymentId: r.paymentId,
    receiptId: r.receiptId,
    receiptNumber: r.receiptNumber,
    invoiceId: r.invoiceId,
    invoiceNumber: r.invoiceNumber,
    periodMonth: r.periodMonth,
    tenantId: r.tenantId,
    tenantName: r.tenantName,
    unitNumber: r.unitNumber,
    propertyName: r.propertyName,
    method: r.method,
    referenceNumber: r.referenceNumber,
    amountMinor: r.amountMinor,
    overpaymentMinor: Math.max(0, r.invoicePaidMinor - r.invoiceTotalMinor),
    currency: r.currency,
    paidAt: r.paidAt,
    pdfUrl: r.pdfUrl,
  }));
}

export function getArrearsAgingReport(organizationId: string) {
  const allUnpaid = listInvoices({ organizationId, limit: 100000 }).filter(
    (inv) =>
      inv.balanceMinor > 0 && inv.daysOverdue > 0 && inv.status !== "cancelled",
  );

  const buckets: Record<
    "0_30" | "30_60" | "60_90" | "90_plus",
    { count: number; totalMinor: number; items: InvoiceRecord[] }
  > = {
    "0_30": { count: 0, totalMinor: 0, items: [] },
    "30_60": { count: 0, totalMinor: 0, items: [] },
    "60_90": { count: 0, totalMinor: 0, items: [] },
    "90_plus": { count: 0, totalMinor: 0, items: [] },
  };

  let totalArrearsMinor = 0;

  for (const inv of allUnpaid) {
    const key = inv.agingBucket === "current" ? "0_30" : inv.agingBucket;
    buckets[key].count += 1;
    buckets[key].totalMinor += inv.balanceMinor;
    buckets[key].items.push(inv);
    totalArrearsMinor += inv.balanceMinor;
  }

  return {
    totalArrearsMinor,
    totalUnpaidInvoices: allUnpaid.length,
    buckets,
  };
}

/**
 * Generates or updates monthly Owner Statements (gross rent collected - expenses - management fee = net payout)
 * taking into account multi-owner percentage splits on each property.
 */
export function generateOwnerStatements(
  organizationId: string,
  actorUserId: string,
  periodMonth: string,
): OwnerStatementRecord[] {
  valid(monthSchema, periodMonth);
  if (!/^\d{4}-\d{2}$/.test(periodMonth)) {
    throw new HttpError(400, "INVALID_PERIOD", "periodMonth must be YYYY-MM.");
  }

  const db = getDb();
  const owners = db
    .prepare(
      `SELECT id, full_name AS fullName, email, bank_name AS bankName, iban,
              management_fee_pct AS managementFeePct
       FROM owners WHERE organization_id = ? AND deleted_at IS NULL`,
    )
    .all(organizationId) as Array<{
    id: string;
    fullName: string;
    email: string;
    bankName: string | null;
    iban: string | null;
    managementFeePct: number;
  }>;

  const now = nowIso();

  return atomic(() => {
    for (const owner of owners) {
      const holdings = db
        .prepare(
          `SELECT po.property_id AS propertyId, p.code AS propertyCode, p.name AS propertyName,
                po.ownership_pct AS ownershipPct
         FROM property_owners po
         JOIN properties p ON p.id = po.property_id
         WHERE po.organization_id = ? AND po.owner_id = ?`,
        )
        .all(organizationId, owner.id) as Array<{
        propertyId: string;
        propertyCode: string;
        propertyName: string;
        ownershipPct: number;
      }>;

      let grossRentMinor = 0;
      let expensesMinor = 0;
      const lineItems: OwnerStatementLineItem[] = [];

      for (const h of holdings) {
        const rentRow = db
          .prepare(
            `SELECT COALESCE(SUM(pay.amount_minor), 0) AS collectedMinor
           FROM payments pay JOIN invoices i ON i.id = pay.invoice_id
           WHERE pay.organization_id = ? AND i.property_id = ? AND substr(pay.paid_at,1,7) = ? AND i.type = 'rent' AND pay.status = 'completed' AND pay.deleted_at IS NULL`,
          )
          .get(organizationId, h.propertyId, periodMonth) as {
          collectedMinor: number;
        };

        const expRow = db
          .prepare(
            `SELECT COALESCE(SUM(w.actual_cost_minor), 0) AS costMinor
           FROM work_orders w
           JOIN maintenance_tickets mt ON mt.id = w.ticket_id
           WHERE w.organization_id = ? AND mt.property_id = ? AND substr(COALESCE(w.completed_at, w.created_at), 1, 7) = ? AND w.deleted_at IS NULL AND w.status = 'completed'`,
          )
          .get(organizationId, h.propertyId, periodMonth) as {
          costMinor: number;
        };

        const extraExpenses = db.prepare(`SELECT COALESCE(SUM(CASE WHEN l.direction='debit' THEN l.amount_minor ELSE -l.amount_minor END),0) n FROM ledger_entries l JOIN accounts a ON a.id=l.account_id AND a.organization_id=l.organization_id JOIN journal_batches j ON j.id=l.journal_id AND j.organization_id=l.organization_id WHERE l.organization_id=? AND l.property_id=? AND substr(l.entry_date,1,7)=? AND a.type='expense' AND j.source_type<>'work_order'`).get(organizationId,h.propertyId,periodMonth);
        const propExpenseMinor = expRow.costMinor+Number(extraExpenses!.n);

        const ownerShareGross = Math.round(
          rentRow.collectedMinor * (h.ownershipPct / 100),
        );
        const ownerShareExp = Math.round(
          propExpenseMinor * (h.ownershipPct / 100),
        );

        grossRentMinor += ownerShareGross;
        expensesMinor += ownerShareExp;

        lineItems.push({
          propertyId: h.propertyId,
          propertyCode: h.propertyCode,
          propertyName: h.propertyName,
          ownershipPct: h.ownershipPct,
          totalPropertyRentCollectedMinor: rentRow.collectedMinor,
          ownerShareGrossRentMinor: ownerShareGross,
          ownerShareExpensesMinor: ownerShareExp,
        });
      }

      const managementFeeMinor = Math.round(
        grossRentMinor * (owner.managementFeePct / 100),
      );
      const netPayoutMinor =
        grossRentMinor - expensesMinor - managementFeeMinor;

      const existing = db
        .prepare(
          `SELECT id FROM owner_statements
         WHERE organization_id = ? AND owner_id = ? AND period_month = ?`,
        )
        .get(organizationId, owner.id, periodMonth) as
        { id: string } | undefined;

      if (existing) {
        if (
          db
            .prepare("SELECT id FROM statement_payouts WHERE statement_id = ?")
            .get(existing.id)
        )
          continue;
        db.prepare(
          `UPDATE owner_statements
         SET gross_rent_minor = ?, expenses_minor = ?, management_fee_pct = ?,
             management_fee_minor = ?, net_payout_minor = ?, line_items_json = ?, updated_at = ?
         WHERE id = ?`,
        ).run(
          grossRentMinor,
          expensesMinor,
          owner.managementFeePct,
          managementFeeMinor,
          netPayoutMinor,
          JSON.stringify(lineItems),
          now,
          existing.id,
        );
      } else {
        db.prepare(
          `INSERT INTO owner_statements (
          id, organization_id, owner_id, property_id, period_month,
          gross_rent_minor, expenses_minor, management_fee_pct, management_fee_minor,
          net_payout_minor, currency, status, line_items_json, created_at, updated_at, created_by
        ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'PKR', 'issued', ?, ?, ?, ?)`,
        ).run(
          newId("ost"),
          organizationId,
          owner.id,
          periodMonth,
          grossRentMinor,
          expensesMinor,
          owner.managementFeePct,
          managementFeeMinor,
          netPayoutMinor,
          JSON.stringify(lineItems),
          now,
          now,
          actorUserId,
        );
      }
    }

    recordAuditLog({
      organizationId,
      actorUserId,
      action: "billing.owner_statements_generated",
      entityType: "owner_statement",
      entityId: periodMonth,
      metadata: { periodMonth, ownerCount: owners.length },
    });

    return listOwnerStatements(organizationId, periodMonth);
  });
}

export function listOwnerStatements(
  organizationId: string,
  periodMonth?: string,
): OwnerStatementRecord[] {
  const db = getDb();
  const clauses = ["os.organization_id = ?"];
  const args: string[] = [organizationId];
  if (periodMonth) {
    clauses.push("os.period_month = ?");
    args.push(periodMonth);
  }

  const rows = db
    .prepare(
      `SELECT
        os.id,
        os.organization_id AS organizationId,
        os.owner_id AS ownerId,
        o.full_name AS ownerName,
        o.email AS ownerEmail,
        o.bank_name AS bankName,
        o.iban,
        os.period_month AS periodMonth,
        os.gross_rent_minor AS grossRentMinor,
        os.expenses_minor AS expensesMinor,
        os.management_fee_pct AS managementFeePct,
        os.management_fee_minor AS managementFeeMinor,
        os.net_payout_minor AS netPayoutMinor,
        os.currency,
        os.status,
        os.line_items_json AS lineItemsJson,
        os.created_at AS createdAt
       FROM owner_statements os
       JOIN owners o ON o.id = os.owner_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY os.period_month DESC, o.full_name ASC`,
    )
    .all(...args) as Array<
    Omit<OwnerStatementRecord, "lineItems"> & { lineItemsJson: string }
  >;

  return rows.map((r) => {
    let lineItems: OwnerStatementLineItem[] = [];
    try {
      lineItems = JSON.parse(r.lineItemsJson || "[]");
    } catch {
      lineItems = [];
    }
    return {
      id: r.id,
      organizationId: r.organizationId,
      ownerId: r.ownerId,
      ownerName: r.ownerName,
      ownerEmail: r.ownerEmail,
      bankName: r.bankName,
      iban: r.iban,
      periodMonth: r.periodMonth,
      grossRentMinor: r.grossRentMinor,
      expensesMinor: r.expensesMinor,
      managementFeePct: r.managementFeePct,
      managementFeeMinor: r.managementFeeMinor,
      netPayoutMinor: r.netPayoutMinor,
      currency: r.currency,
      status: r.status,
      lineItems,
      createdAt: r.createdAt,
    };
  });
}

export function recordOwnerPayout(
  org: string,
  actor: string,
  statementId: string,
  reference: string,
) {
  if (!reference?.trim())
    throw new HttpError(
      400,
      "REFERENCE_REQUIRED",
      "Payout reference is required.",
    );
  return atomic(() => {
    const statement = listOwnerStatements(org).find(
      (s) => s.id === statementId,
    );
    if (!statement)
      throw new HttpError(404, "STATEMENT_NOT_FOUND", "Statement not found.");
    if (statement.status === "paid" || statement.netPayoutMinor <= 0)
      throw new HttpError(
        409,
        "INVALID_PAYOUT",
        "Statement is already paid or has no payable balance.",
      );
    getDb()
      .prepare("INSERT INTO statement_payouts VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        newId("out"),
        org,
        statementId,
        statement.netPayoutMinor,
        reference.trim(),
        nowIso(),
        actor,
      );
    getDb()
      .prepare(
        "UPDATE owner_statements SET status = 'paid', updated_at = ? WHERE id = ?",
      )
      .run(nowIso(), statementId);
    postPayoutsInternal(org,actor,statementId);
    recordAuditLog({
      organizationId: org,
      actorUserId: actor,
      action: "owner.payout_recorded",
      entityType: "owner_statement",
      entityId: statementId,
      metadata: { amountMinor: statement.netPayoutMinor, reference },
    });
    return listOwnerStatements(org).find((s) => s.id === statementId)!;
  });
}
export function listCreditNotes(org: string) {
  return getDb()
    .prepare(
      "SELECT id, invoice_id AS invoiceId, amount_minor AS amountMinor, reason, created_at AS createdAt FROM credit_notes WHERE organization_id = ? ORDER BY created_at DESC",
    )
    .all(org);
}

export function createRecurringCharge(
  org: string,
  actor: string,
  data: unknown,
) {
  const b = valid(
    z.object({
      leaseId: z.string().min(1),
      type: z.enum(["utilities", "maintenance", "parking", "service_charge"]),
      amountMinor: moneySchema.positive(),
      startMonth: monthSchema,
      endMonth: monthSchema,
    }),
    data,
  );
  if (b.endMonth < b.startMonth)
    throw new HttpError(
      400,
      "INVALID_TERM",
      "Charge end must not precede start.",
    );
  if (
    !getDb()
      .prepare(
        "SELECT id FROM leases WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
      )
      .get(org, b.leaseId)
  )
    throw new HttpError(404, "LEASE_NOT_FOUND", "Lease not found.");
  const id = newId("chg");
  getDb()
    .prepare("INSERT INTO recurring_charges VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
    .run(
      id,
      org,
      b.leaseId,
      b.type,
      b.amountMinor,
      b.startMonth,
      b.endMonth,
      nowIso(),
      actor,
    );
  recordAuditLog({
    organizationId: org,
    actorUserId: actor,
    action: "billing.recurring_charge_created",
    entityType: "recurring_charge",
    entityId: id,
    metadata: b,
  });
  return listRecurringCharges(org);
}
export function listRecurringCharges(org: string) {
  return getDb()
    .prepare(
      "SELECT id, lease_id AS leaseId, type, amount_minor AS amountMinor, start_month AS startMonth, end_month AS endMonth FROM recurring_charges WHERE organization_id = ?",
    )
    .all(org) as unknown as {
    id: string;
    leaseId: string;
    type: InvoiceType;
    amountMinor: number;
    startMonth: string;
    endMonth: string;
  }[];
}
