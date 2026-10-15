import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { unzipSync, strFromU8 } from "fflate";
import { PDFDocument } from "pdf-lib";
import { getDb, resetDbForTesting } from "@/server/db";
import { loginWithPassword } from "@/server/modules/auth/auth.service";
import { verifyAccessToken, type JwtPayload } from "@/server/auth/crypto";
import * as a from "@/server/modules/accounting/accounting.service";
import * as r from "@/server/modules/accounting/reports.service";
import * as s from "@/server/modules/accounting/schedules.service";
import { allocate } from "@/server/modules/accounting/posting";
import {
  csvCell,
  workbook,
  exportReport,
} from "@/server/modules/accounting/exports";
import * as b from "@/server/modules/billing/billing.service";
import * as m from "@/server/modules/maintenance/maintenance.service";
import * as api from "@/app/api/v1/accounting/route";
import { GET as reportsAPI } from "@/app/api/v1/reports/route";
import { migratePhase5, seedPhase5 } from "@/server/db/phase5";
const org = "org_pakland",
  q = { from: "2026-01-01", to: "2026-12-31" };
let admin: JwtPayload,
  accountant: JwtPayload,
  agent: JwtPayload,
  tenant: JwtPayload,
  other: JwtPayload;
const context = (email: string) =>
  verifyAccessToken(
    loginWithPassword({ email, password: "Password123!" }).accessToken!,
  )!;
const expense = {
  propertyId: "prop_1",
  accountCode: "5000",
  amountMinor: 10001,
  expenseDate: "2026-10-15",
  description: "Verified repair invoice",
  reference: "expense-001",
};
const journal = {
  propertyId: "prop_1",
  entryDate: "2026-10-15",
  debitCode: "1000",
  creditCode: "3000",
  amountMinor: 10001,
  description: "Supported opening balance",
  reference: "opening-001",
};
function req(path: string, method = "GET", body?: unknown, ctx = admin) {
  return new NextRequest(`http://localhost:3000/api/v1/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${loginWithPassword({ email: ctx.email, password: "Password123!" }).accessToken}`,
      "Content-Type": "application/json",
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
function completed() {
  const ticket = m.createTicket(admin, {
    unitId: "unit_1",
    title: "Drain repair",
    description: "Drain needs repair",
    category: "plumbing",
    priority: "high",
  });
  m.triageTicket(admin, ticket.id, {
    category: "plumbing",
    priority: "high",
    note: "Inspect the joint",
  });
  let d = m.assignWorkOrder(admin, ticket.id, {
    vendorId: "ven_plumber",
    scheduledAt: "2026-10-15T11:00:00Z",
    estimatedCostMinor: 15000,
  });
  const workOrderId = d.orders[0].id;
  m.updateWorkOrder(admin, ticket.id, {
    workOrderId,
    status: "in_progress",
    note: "On site",
  });
  d = m.updateWorkOrder(admin, ticket.id, {
    workOrderId,
    status: "completed",
    actualCostMinor: 10001,
    note: "Repaired and checked",
  });
  return d.orders[0];
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  resetDbForTesting();
  admin = context("admin@pakland.pk");
  accountant = context("accountant@pakland.pk");
  agent = context("agent@pakland.pk");
  tenant = context("tenant@pakland.pk");
  other = context("admin@indusvalley.pk");
});
afterEach(() => vi.useRealTimers());
describe("Phase 5 accounting", () => {
  it("migrates additively and seeds idempotently without changing invoices or making legacy vacancies up", () => {
    const db = getDb(),
      before = db.prepare("SELECT * FROM invoices").all();
    migratePhase5(db);
    seedPhase5(db);
    expect(db.prepare("SELECT * FROM invoices").all()).toEqual(before);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(a.accountingCatalog(admin).accounts).toHaveLength(14);
    expect(
      r
        .operationalReport(admin, q)
        .vacancies.every((v) => v.vacantDays === null),
    ).toBe(true);
  });
  it("backfills balanced journals and reconciles without inventing cash; second sync is a no-op", () => {
    expect(r.reconciliation(org).fullyPosted).toBe(false);
    expect(a.synchronize(accountant).posted).toBeGreaterThan(0);
    const rec = r.reconciliation(org);
    expect(rec.fullyPosted).toBe(true);
    expect(rec.legacyClearingMinor).toBeGreaterThan(0);
    const report = r.financialReport(admin, q);
    expect(report.totals.debitMinor).toBe(report.totals.creditMinor);
    expect(report.totals.assetsMinor).toBe(
      report.totals.liabilitiesMinor +
        report.totals.equityMinor +
        report.totals.retainedEarningsMinor,
    );
    const actual = Number(
      getDb()
        .prepare(
          "SELECT SUM(amount_minor) n FROM payments WHERE organization_id=? AND status='completed'",
        )
        .get(org)!.n,
    );
    expect(report.totals.cashMovementMinor).toBe(actual);
    expect(a.synchronize(admin).posted).toBe(0);
  });
  it("keeps cash and owner statements separate from corporate revenue", () => {
    a.synchronize(admin);
    const before = r.financialReport(admin, q);
    b.generateOwnerStatements(org, admin.sub, "2026-10");
    expect(r.financialReport(admin, q).totals.incomeMinor).toBe(
      before.totals.incomeMinor,
    );
  });
  it("posts invoice, credit and payment atomically; handles recurring nested savepoints", () => {
    const inv = b.createAdHocInvoice(org, admin.sub, {
      leaseId: "lease_1",
      type: "utilities",
      periodMonth: "2026-10",
      dueDate: "2026-10-10",
      amountMinor: 10001,
    });
    b.issueCreditNote(org, admin.sub, inv.id, 1, "Rounding allowance");
    b.recordPayment(org, admin.sub, {
      invoiceId: inv.id,
      amountMinor: 10000,
      method: "cash",
      referenceNumber: "test-payment",
    });
    const report = r.financialReport(admin, q);
    expect(report.totals.incomeMinor).toBe(10000);
    expect(report.totals.receivablesMinor).toBe(0);
    expect(report.totals.cashMovementMinor).toBe(10000);
    b.createRecurringCharge(org, admin.sub, {
      leaseId: "lease_1",
      type: "utilities",
      amountMinor: 100,
      startMonth: "2026-11",
      endMonth: "2026-11",
    });
    b.generateMonthlyRentCycle(org, admin.sub, "2026-11");
    expect(getDb().prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("rolls an invoice back if financial posting rejects invalid ownership", () => {
    getDb()
      .prepare(
        "UPDATE property_owners SET ownership_pct=100 WHERE property_id='prop_1'",
      )
      .run();
    const n = getDb().prepare("SELECT COUNT(*) n FROM invoices").get()!.n;
    expect(() =>
      b.createAdHocInvoice(org, admin.sub, {
        leaseId: "lease_1",
        type: "utilities",
        periodMonth: "2026-10",
        dueDate: "2026-10-10",
        amountMinor: 100,
      }),
    ).toThrow("Ownership");
    expect(getDb().prepare("SELECT COUNT(*) n FROM invoices").get()!.n).toBe(n);
  });
  it("allocates exact paisa including huge integer amounts and unallocated shares", () => {
    const shares = [
      { ownerId: "a", basisPoints: 3333 },
      { ownerId: "b", basisPoints: 3333 },
      { ownerId: null, basisPoints: 3334 },
    ];
    for (const n of [1, 101, 999999999999])
      expect(
        allocate(n, shares).reduce((sum, r) => sum + r.amountMinor, 0),
      ).toBe(n);
  });
  it("prevents editing/deleting posted journals, ledger and allocations", () => {
    a.manualJournal(admin, journal);
    const db = getDb();
    for (const table of [
      "journal_batches",
      "ledger_entries",
      "ledger_owner_allocations",
    ]) {
      expect(() => db.prepare(`DELETE FROM ${table}`).run()).toThrow(
        "immutable",
      );
      expect(() =>
        db.prepare(`UPDATE ${table} SET created_by='tamper'`).run(),
      ).toThrow("immutable");
    }
  });
  it("reverses journal once and preserves original owner allocation after ownership changes", () => {
    const { journalId } = a.manualJournal(admin, journal),
      before = r.financialReport(admin, { ...q, ownerId: "own_1" });
    getDb()
      .prepare(
        "UPDATE property_owners SET ownership_pct=0 WHERE property_id='prop_1'",
      )
      .run();
    const payload = {
      id: journalId,
      entryDate: "2026-10-15",
      reason: "Correct supported balance",
    };
    const reversed = a.reverseJournal(admin, payload);
    expect(a.reverseJournal(admin, payload)).toEqual(reversed);
    expect(
      r.financialReport(admin, { ...q, ownerId: "own_1" }).totals
        .cashMovementMinor,
    ).toBe(0);
    expect(before.totals.cashMovementMinor).toBeGreaterThan(0);
    expect(() =>
      a.reverseJournal(admin, { ...payload, reason: "Different reason" }),
    ).toThrow("Already reversed");
  });
  it("rejects controls, future dates, same account and cross-source duplicate references", () => {
    expect(() =>
      a.manualJournal(admin, { ...journal, debitCode: "1100" }),
    ).toThrow("source-controlled");
    expect(() =>
      a.manualJournal(admin, { ...journal, entryDate: "2026-10-16" }),
    ).toThrow("future");
    expect(() =>
      a.manualJournal(admin, { ...journal, creditCode: "1000" }),
    ).toThrow("differ");
    a.manualJournal(admin, journal);
    expect(a.manualJournal(admin, journal).journalId).toBeTruthy();
    expect(() =>
      a.manualJournal(admin, { ...journal, amountMinor: 10002 }),
    ).toThrow("different");
    expect(() =>
      a.createExpense(admin, { ...expense, reference: journal.reference }),
    ).toThrow("different");
  });
  it("creates typed accounts and rejects duplicate/mismatched codes", () => {
    a.createAccount(accountant, {
      code: "5030",
      name: "Gardening expenses",
      type: "expense",
    });
    expect(() =>
      a.createAccount(admin, {
        code: "5030",
        name: "Duplicate",
        type: "expense",
      }),
    ).toThrow("already");
    expect(() =>
      a.createAccount(admin, {
        code: "4030",
        name: "Wrong prefix",
        type: "expense",
      }),
    ).toThrow("prefix");
  });
  it("records receipt expenses idempotently, returns private receipts and voids once", async () => {
    const receipt = {
      name: "proof.pdf",
      data:
        "data:application/pdf;base64," +
        Buffer.from("%PDF-1.7\nproof").toString("base64"),
    };
    const payload = { ...expense, receipt },
      { id } = a.createExpense(accountant, payload);
    expect(a.createExpense(accountant, payload).id).toBe(id);
    expect(a.expenseReceipt(admin, id).bytes.toString()).toContain("%PDF");
    expect(() =>
      a.createExpense(admin, { ...payload, amountMinor: 12 }),
    ).toThrow("different");
    const response = await api.GET(req(`accounting?action=receipt&id=${id}`));
    expect(response.headers.get("Content-Disposition")).toContain("attachment");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const v = {
      id,
      entryDate: "2026-10-15",
      reason: "Duplicate vendor invoice",
    };
    a.voidExpense(admin, v);
    expect(a.voidExpense(admin, v)).toEqual({ id });
    expect(r.financialReport(admin, q).totals.expenseMinor).toBe(0);
    expect(() =>
      a.voidExpense(admin, { ...v, reason: "Different reason" }),
    ).toThrow("already");
  });
  it("rejects forged receipt media and oversize/invalid data", () => {
    for (const data of [
      "data:text/html;base64,PHNjcmlwdD4=",
      "data:image/png;base64,PHNjcmlwdD4=",
      "data:application/pdf;base64,QQ==",
    ])
      expect(() =>
        a.createExpense(admin, { ...expense, receipt: { name: "bad", data } }),
      ).toThrow();
    for (const [mime, bytes] of [
      ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
      ["image/jpeg", Buffer.from([255, 216, 255])],
      ["image/webp", Buffer.from("RIFF1234WEBP")],
    ] as const) {
      expect(
        a.createExpense(admin, {
          ...expense,
          reference: mime,
          receipt: {
            name: "image",
            data: `data:${mime};base64,${bytes.toString("base64")}`,
          },
        }).id,
      ).toBeTruthy();
    }
  });
  it("posts completed work-order expense to AP, then records full settlement once, never twice as expense", () => {
    const work = completed();
    expect(r.financialReport(admin, q).totals.payablesMinor).toBe(10001);
    expect(() =>
      a.payVendor(admin, {
        workOrderId: work.id,
        paidDate: "2026-10-14",
        reference: "vendor-01",
      }),
    ).toThrow("precede");
    const pay = {
      workOrderId: work.id,
      paidDate: "2026-10-15",
      reference: "vendor-01",
    };
    expect(a.payVendor(accountant, pay)).toEqual(a.payVendor(accountant, pay));
    const report = r.financialReport(admin, q);
    expect(report.totals.expenseMinor).toBe(10001);
    expect(report.totals.payablesMinor).toBe(0);
    expect(() =>
      a.payVendor(admin, { ...pay, reference: "different" }),
    ).toThrow("already");
  });
  it("includes direct expenses in newly generated statements and preserves paid snapshots", () => {
    a.synchronize(admin);
    a.createExpense(admin, expense);
    const statements = b.generateOwnerStatements(org, admin.sub, "2026-10");
    expect(statements.some((s) => s.expensesMinor > 0)).toBe(true);
    const payable = statements.find((s) => s.netPayoutMinor > 0)!;
    b.recordOwnerPayout(org, admin.sub, payable.id, "verified-out-001");
    expect(
      r.financialReport(admin, q).accounts.find((a) => a.code === "3100")!
        .closingMinor,
    ).toBe(payable.netPayoutMinor);
    const before = b.listOwnerStatements(org).find((s) => s.id === payable.id);
    a.createExpense(admin, { ...expense, reference: "expense-002" });
    b.generateOwnerStatements(org, admin.sub, "2026-10");
    expect(b.listOwnerStatements(org).find((s) => s.id === payable.id)).toEqual(
      before,
    );
  });
  it("upserts full-month budgets with exact selected-date actuals and owner shares", () => {
    a.saveBudget(admin, {
      propertyId: "prop_1",
      accountCode: "5000",
      periodMonth: "2026-10",
      amountMinor: 20000,
    });
    a.saveBudget(admin, {
      propertyId: "prop_1",
      accountCode: "5000",
      periodMonth: "2026-10",
      amountMinor: 30000,
    });
    a.createExpense(admin, expense);
    const report = r.financialReport(admin, { ...q, propertyId: "prop_1" });
    expect(report.budgets).toHaveLength(1);
    expect(report.budgets[0].varianceMinor).toBe(19999);
    expect(
      r.financialReport(admin, { ...q, ownerId: "own_1" }).budgets[0]
        .plannedMinor,
    ).toBeGreaterThan(0);
    expect(() =>
      a.saveBudget(admin, {
        propertyId: "prop_1",
        accountCode: "1000",
        periodMonth: "2026-10",
        amountMinor: 10,
      }),
    ).toThrow("wrong");
  });
  it("filters projects, owners and dates and paginates without leaking the other organization", () => {
    a.synchronize(admin);
    const all = r.ledgerReport(admin, q, 1, 1);
    expect(all.rows).toHaveLength(1);
    expect(all.total).toBeGreaterThan(1);
    expect(r.financialReport(other, q).totals.incomeMinor).toBe(0);
    expect(() =>
      r.financialReport(admin, { ...q, propertyId: "prop_indus_1" }),
    ).toThrow("scope");
    expect(() => r.ledgerReport(admin, q, 0)).toThrow("pagination");
    expect(() =>
      r.financialReport(admin, { from: "2026-12-01", to: "2026-01-01" }),
    ).toThrow("Start");
  });
  it("retains unknown vacancy dates until a real status transition", () => {
    const db = getDb(),
      unit = db
        .prepare(
          "SELECT id FROM units WHERE organization_id=? AND status='available' LIMIT 1",
        )
        .get(org)!;
    db.prepare(
      "UPDATE units SET status='under_maintenance',updated_at=? WHERE id=?",
    ).run("2026-10-15T10:00:00Z", unit.id);
    db.prepare(
      "UPDATE units SET status='available',updated_at=? WHERE id=?",
    ).run("2026-10-15T10:00:00Z", unit.id);
    expect(
      r.operationalReport(admin, q).vacancies.find((v) => v.unitId === unit.id)
        ?.vacantDays,
    ).toBe(0);
  });
  it("detects unsupported changed legacy payment gaps and rolls all source sync back", () => {
    a.synchronize(admin);
    getDb()
      .prepare(
        "UPDATE invoices SET paid_minor=paid_minor-1 WHERE id=(SELECT source_id FROM accounting_source_state WHERE source_type='legacy_settlement' AND posted_minor>0 LIMIT 1)",
      )
      .run();
    expect(() => a.synchronize(admin)).toThrow("gap changed");
    expect(r.reconciliation(org).fullyPosted).toBe(false);
  });
  it("exports Unicode and formula-safe CSV, real Excel and parseable multipage PDF with audit logs", async () => {
    a.synchronize(admin);
    expect(csvCell(' =HYPERLINK("bad")')).toContain("'");
    expect(csvCell(-12)).toBe('"-12"');
    const x = unzipSync(
      workbook([{ name: "Ledger", rows: [["اردو", "=1+1", 123]] }]),
    );
    expect(strFromU8(x["xl/worksheets/sheet1.xml"])).toContain("اردو");
    expect(strFromU8(x["xl/worksheets/sheet1.xml"])).not.toContain("<f>");
    for (const format of ["csv", "xlsx", "pdf"]) {
      const response = await exportReport(admin, q, format, "summary");
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (format === "pdf")
        expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(
          1,
        );
      if (format === "xlsx")
        expect(unzipSync(bytes)["xl/workbook.xml"]).toBeTruthy();
      if (format === "csv")
        expect(Buffer.from(bytes).toString()).toContain("NOT bank receipts");
    }
    expect((await exportReport(admin, q, "csv", "ledger")).status).toBe(200);
    await expect(exportReport(admin, q, "exe", "ledger")).rejects.toThrow(
      "Choose",
    );
  });
  it("schedules personal private snapshots, deduplicates runs and pauses on revoked permission", () => {
    a.synchronize(admin);
    const saved = s.saveSchedule(accountant, { frequency: "daily" });
    expect(s.saveSchedule(accountant, { frequency: "daily" })).toEqual(saved);
    expect(s.runReportCycle(org, "2026-10-15T10:00:01Z").delivered).toBe(1);
    expect(s.runReportCycle(org, "2026-10-15T10:00:01Z").delivered).toBe(0);
    expect(s.listSchedules(accountant).deliveries).toHaveLength(1);
    expect(s.listSchedules(admin).deliveries).toHaveLength(0);
    getDb()
      .prepare(
        "UPDATE users SET role_id=(SELECT id FROM roles WHERE organization_id=? AND slug='tenant') WHERE id=?",
      )
      .run(org, accountant.sub);
    expect(s.runReportCycle(org, "2026-10-16T10:00:00Z").paused).toBe(1);
    expect(() => s.pauseSchedule(admin, { id: saved.id })).toThrow("not found");
    s.pauseSchedule(accountant, { id: saved.id });
  });
  it("handles weekly/monthly and coalesces missed schedules", () => {
    s.saveSchedule(admin, { frequency: "weekly" });
    s.saveSchedule(admin, { frequency: "monthly" });
    expect(s.runReportCycle(org, "2026-11-01T10:00:00Z").delivered).toBe(2);
    const reports = s.listSchedules(admin);
    expect(
      reports.deliveries.every((d) => d.report.filter.to === "2026-10-31"),
    ).toBe(true);
    expect(
      reports.schedules.every(
        (d) => String(d.next_due_at) > "2026-11-01T10:00:00Z",
      ),
    ).toBe(true);
  });
  it("protects all endpoints and exports; validates action/body/date inputs", async () => {
    expect(
      (await reportsAPI(req("reports", "GET", undefined, tenant))).status,
    ).toBe(403);
    expect(
      (
        await api.POST(
          req("accounting", "POST", { action: "expense", ...expense }, agent),
        )
      ).status,
    ).toBe(403);
    expect(
      (await api.GET(new NextRequest("http://localhost/api/v1/accounting")))
        .status,
    ).toBe(401);
    expect(
      (await api.POST(req("accounting", "POST", { action: "unknown" }))).status,
    ).toBe(400);
    expect((await api.POST(req("accounting", "POST", []))).status).toBe(400);
    expect((await reportsAPI(req("reports?from=invalid"))).status).toBe(400);
    expect(
      (await api.POST(req("accounting", "POST", { action: "sync" }))).status,
    ).toBe(201);
    expect((await api.GET(req("accounting"))).status).toBe(200);
    expect((await reportsAPI(req("reports?format=xlsx"))).status).toBe(200);
  });
});
