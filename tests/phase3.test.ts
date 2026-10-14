import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { SCHEMA_DDL } from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";
import type { InvoiceRecord } from "@/server/modules/billing/billing.service";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { PDFDocument } from "pdf-lib";
import { getDb, resetDbForTesting } from "@/server/db";
import { loginWithPassword } from "@/server/modules/auth/auth.service";
import { DEMO_PASSWORD } from "@/server/db/seed";
import {
  computeLeaseExpiryWindow,
  createTenant,
  listTenants,
  updateTenantKyc,
  createLease,
  listLeases,
  updateLeaseLifecycle,
  generateLeaseAgreementDocument,
  saveChecklist,
  listChecklists,
  recordDeposit,
  getLeaseEvents,
} from "@/server/modules/leases/leases.service";
import {
  computeInvoiceAging,
  generateMonthlyRentCycle,
  listInvoices,
  createAdHocInvoice,
  applyLateFees,
  issueCreditNote,
  recordPayment,
  listPaymentsAndReceipts,
  getArrearsAgingReport,
  generateOwnerStatements,
  listOwnerStatements,
  recordOwnerPayout,
  listCreditNotes,
  createRecurringCharge,
  listRecurringCharges,
} from "@/server/modules/billing/billing.service";
import { getPaymentGateway } from "@/server/modules/billing/adapters/gateway";
import * as tenantsApi from "@/app/api/v1/tenants/route";
import * as leasesApi from "@/app/api/v1/leases/route";
import * as invoicesApi from "@/app/api/v1/billing/invoices/route";
import * as paymentsApi from "@/app/api/v1/billing/payments/route";
import * as statementsApi from "@/app/api/v1/billing/statements/route";
import { GET as arrearsApi } from "@/app/api/v1/billing/arrears/route";
import { GET as receiptApi } from "@/app/api/v1/billing/receipts/[id]/route";
import { GET as agreementApi } from "@/app/api/v1/leases/[id]/agreement/route";
import * as checklistApi from "@/app/api/v1/leases/[id]/checklist/route";
import { POST as depositApi } from "@/app/api/v1/leases/[id]/deposit/route";
import { POST as checkoutApi } from "@/app/api/v1/billing/checkout/route";
const org = "org_pakland",
  actor = "usr_admin";
const tenantPayload = {
  fullName: "Phase Three Tenant",
  cnic: "35202-1234567-1",
  email: "phase3@example.pk",
  phone: "+923001234567",
  references: [
    {
      name: "Reference Ali",
      phone: "+923001112233",
      relationship: "colleague",
    },
  ],
  emergencyContactName: "Ahmed",
  emergencyContactPhone: "+923007654321",
};
function draft() {
  return createLease(org, actor, {
    unitId: "unit_22",
    tenantId: "ten_1",
    startDate: "2026-11-01",
    endDate: "2027-10-31",
    rentMinor: 10000000,
    depositMinor: 20000000,
  });
}
function activate(id: string) {
  updateLeaseLifecycle(org, actor, id, { status: "pending_signature" });
  return updateLeaseLifecycle(org, actor, id, { status: "active" });
}
function req(path: string, method = "GET", body?: unknown, token?: string) {
  return new NextRequest(`http://localhost:3000/api/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function token(email = "admin@pakland.pk") {
  return loginWithPassword({ email, password: DEMO_PASSWORD }).accessToken;
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
describe("Phase 3 tenancy & billing", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-14T08:00:00Z"));
    resetDbForTesting();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });
  it("onboards tenants, validates IDs, and tracks verified KYC and history", () => {
    const tenant = createTenant(org, actor, tenantPayload);
    expect(tenant.kycStatus).toBe("pending");
    expect(tenant.references[0].name).toBe("Reference Ali");
    expect(updateTenantKyc(org, actor, tenant.id, "verified").kycStatus).toBe(
      "verified",
    );
    expect(
      listTenants({
        organizationId: org,
        search: "Phase Three",
        kycStatus: "verified",
      }),
    ).toHaveLength(1);
    expect(listTenants({ organizationId: "org_indus" })).toHaveLength(0);
    expect(
      listTenants({ organizationId: org }).find((t) => t.id === "ten_1")!
        .totalPaidMinor,
    ).toBeGreaterThan(0);
    expect(() => createTenant(org, actor, tenantPayload)).toThrow(
      "already exists",
    );
    expect(() =>
      createTenant(org, actor, { ...tenantPayload, cnic: "bad" }),
    ).toThrow();
    expect(() =>
      updateTenantKyc("org_indus", "usr_indus_admin", tenant.id, "verified"),
    ).toThrow("not found");
    expect(() =>
      updateTenantKyc(org, actor, tenant.id, "bad" as never),
    ).toThrow();
  });
  it("calculates renewal windows and rejects invalid / overlapping leases and unverified activation", () => {
    expect(computeLeaseExpiryWindow("2026-10-13").expiryWindow).toBe("expired");
    expect(computeLeaseExpiryWindow("2026-11-10").expiryWindow).toBe("30_days");
    expect(computeLeaseExpiryWindow("2026-12-05").expiryWindow).toBe("60_days");
    expect(computeLeaseExpiryWindow("2026-12-31").expiryWindow).toBe("90_days");
    expect(computeLeaseExpiryWindow("2027-06-30").expiryWindow).toBe("safe");
    expect(
      listLeases({ organizationId: org, expiryWindow: "30_days" }),
    ).toHaveLength(3);
    expect(
      listLeases({ organizationId: org, status: "expiring" }),
    ).toHaveLength(3);
    const tenant = createTenant(org, actor, tenantPayload);
    const lease = createLease(org, actor, {
      unitId: "unit_22",
      tenantId: tenant.id,
      startDate: "2026-11-01",
      endDate: "2027-10-31",
      rentMinor: 10000000,
    });
    updateLeaseLifecycle(org, actor, lease.id, { status: "pending_signature" });
    expect(() =>
      updateLeaseLifecycle(org, actor, lease.id, { status: "active" }),
    ).toThrow("KYC");
    expect(() => draft()).toThrow("overlapping");
    expect(() =>
      createLease(org, actor, {
        unitId: "unit_23",
        tenantId: "ten_1",
        startDate: "2027-11-01",
        endDate: "2027-10-01",
        rentMinor: 100,
      }),
    ).toThrow();
    expect(() =>
      createLease("org_indus", "usr_indus_admin", {
        unitId: "unit_23",
        tenantId: "ten_1",
        startDate: "2026-11-01",
        endDate: "2027-10-01",
        rentMinor: 100,
      }),
    ).toThrow();
  });
  it("progresses a lease, applies escalation only on renewal, records deposits and releases the unit", () => {
    const lease = draft();
    expect(lease.status).toBe("draft");
    expect(() =>
      updateLeaseLifecycle(org, actor, lease.id, { status: "active" }),
    ).toThrow();
    activate(lease.id);
    expect(
      getDb().prepare("SELECT status FROM units WHERE id='unit_22'").get()
        ?.status,
    ).toBe("rented");
    recordDeposit(org, actor, lease.id, {
      type: "deposit_received",
      amountMinor: 20000000,
      reference: "DEP-1",
    });
    expect(() =>
      recordDeposit(org, actor, lease.id, {
        type: "deposit_received",
        amountMinor: 1,
        reference: "DEP-2",
      }),
    ).toThrow();
    expect(() =>
      recordDeposit(org, actor, lease.id, {
        type: "deposit_refunded",
        amountMinor: 1,
        reference: "REF-1",
      }),
    ).toThrow();
    expect(() =>
      updateLeaseLifecycle(org, actor, lease.id, {
        status: "renewed",
        newEndDate: "2027-01-01",
      }),
    ).toThrow();
    const renewal = updateLeaseLifecycle(org, actor, lease.id, {
      status: "renewed",
      newEndDate: "2028-10-31",
    });
    expect(renewal.rentMinor).toBe(11000000);
    expect(listTenants({ organizationId: org })).toHaveLength(20);
    expect(() =>
      updateLeaseLifecycle(org, actor, lease.id, {
        status: "renewed",
        newEndDate: "2029-10-31",
      }),
    ).toThrow();
    updateLeaseLifecycle(org, actor, lease.id, { status: "terminated" });
    recordDeposit(org, actor, lease.id, {
      type: "deposit_refunded",
      amountMinor: 20000000,
      reference: "REF-2",
    });
    expect(
      getLeaseEvents(org, lease.id).filter(
        (e) => e.type === "deposit_refunded",
      ),
    ).toHaveLength(1);
    expect(
      getDb().prepare("SELECT status FROM units WHERE id='unit_22'").get()
        ?.status,
    ).toBe("available");
    expect(() =>
      updateLeaseLifecycle(org, actor, lease.id, { status: "active" }),
    ).toThrow();
  });
  it("stores move-in/out checklists and produces financial agreement terms", () => {
    const lease = draft();
    saveChecklist(org, actor, lease.id, {
      kind: "move_in",
      items: [{ label: "Keys", checked: true }],
      photos: ["https://example.pk/photo.jpg"],
    });
    saveChecklist(org, actor, lease.id, {
      kind: "move_in",
      items: [{ label: "Keys", checked: false }],
      photos: [],
    });
    expect(listChecklists(org, lease.id)).toHaveLength(1);
    expect(listChecklists(org, lease.id)[0].items[0].checked).toBe(false);
    expect(() =>
      saveChecklist("org_indus", actor, lease.id, {
        kind: "move_in",
        items: [],
      }),
    ).toThrow();
    const agreement = generateLeaseAgreementDocument(org, lease.id);
    expect(agreement.financialTerms.securityDepositMinor).toBe(20000000);
    expect(agreement.contractText).toContain("CNIC");
    expect(() =>
      generateLeaseAgreementDocument("org_indus", lease.id),
    ).toThrow();
  });
  it("generates monthly rent and recurring utilities/maintenance idempotently within lease terms", () => {
    const lease = draft();
    activate(lease.id);
    createRecurringCharge(org, actor, {
      leaseId: lease.id,
      type: "utilities",
      amountMinor: 200000,
      startMonth: "2026-11",
      endMonth: "2027-01",
    });
    createRecurringCharge(org, actor, {
      leaseId: lease.id,
      type: "maintenance",
      amountMinor: 100000,
      startMonth: "2026-11",
      endMonth: "2027-01",
    });
    expect(listRecurringCharges(org)).toHaveLength(2);
    expect(generateMonthlyRentCycle(org, actor, "2026-11").generatedCount).toBe(
      23,
    );
    expect(generateMonthlyRentCycle(org, actor, "2026-11").generatedCount).toBe(
      0,
    );
    const items = listInvoices({ organizationId: org, periodMonth: "2026-11" });
    expect(items.filter((i) => i.leaseId === lease.id)).toHaveLength(3);
    expect(generateMonthlyRentCycle(org, actor, "2025-01").generatedCount).toBe(
      0,
    );
    expect(() => generateMonthlyRentCycle(org, actor, "2026-13")).toThrow();
    expect(() =>
      createAdHocInvoice(org, actor, {
        leaseId: lease.id,
        type: "utilities",
        amountMinor: 1.5,
        dueDate: "2026-11-05",
        periodMonth: "2026-11",
      }),
    ).toThrow();
    expect(() =>
      createRecurringCharge("org_indus", actor, {
        leaseId: lease.id,
        type: "utilities",
        amountMinor: 100,
        startMonth: "2026-11",
        endMonth: "2027-01",
      }),
    ).toThrow();
  });
  it("computes every arrears bucket without counting not-yet-due invoices", () => {
    for (const [date, bucket] of [
      ["2026-11-01", "current"],
      ["2026-10-05", "0_30"],
      ["2026-09-05", "30_60"],
      ["2026-08-05", "60_90"],
      ["2026-06-05", "90_plus"],
    ])
      expect(computeInvoiceAging(date, 100).agingBucket).toBe(bucket);
    expect(computeInvoiceAging("2026-06-05", 0).agingBucket).toBe("current");
    const before = getArrearsAgingReport(org);
    expect(Object.values(before.buckets).every((b) => b.count > 0)).toBe(true);
    generateMonthlyRentCycle(org, actor, "2026-11");
    expect(getArrearsAgingReport(org).totalArrearsMinor).toBe(
      before.totalArrearsMinor,
    );
  });
  it("applies late fees once, only after the contractual grace period, including partial invoices", () => {
    const inv = createAdHocInvoice(org, actor, {
      leaseId: "lease_1",
      type: "utilities",
      amountMinor: 1000000,
      periodMonth: "2026-10",
      dueDate: "2026-10-01",
    });
    recordPayment(org, actor, {
      invoiceId: inv.id,
      method: "cash",
      amountMinor: 100,
      referenceNumber: "PARTIAL-1",
    });
    expect(applyLateFees(org, actor, inv.id).totalLateFeeAddedMinor).toBe(
      500000,
    );
    expect(applyLateFees(org, actor, inv.id).updatedCount).toBe(0);
    const future = createAdHocInvoice(org, actor, {
      leaseId: "lease_1",
      type: "utilities",
      amountMinor: 1000000,
      periodMonth: "2026-11",
      dueDate: "2026-11-05",
    });
    expect(applyLateFees(org, actor, future.id).updatedCount).toBe(0);
    applyLateFees(org, actor);
    expect(applyLateFees(org, actor).updatedCount).toBe(0);
  });
  it("issues auditable credit notes, preserves invoice arithmetic and prevents over-crediting", () => {
    const inv = createAdHocInvoice(org, actor, {
      leaseId: "lease_1",
      type: "utilities",
      amountMinor: 1000000,
      periodMonth: "2026-10",
      dueDate: "2026-10-01",
    });
    applyLateFees(org, actor, inv.id);
    const credited = issueCreditNote(
      org,
      actor,
      inv.id,
      1200000,
      "Adjustment and fee waiver",
    );
    expect(credited.totalMinor).toBe(300000);
    expect(credited.amountMinor + credited.lateFeeMinor).toBe(
      credited.totalMinor,
    );
    expect(listCreditNotes(org)).toHaveLength(1);
    expect(applyLateFees(org, actor, inv.id).updatedCount).toBe(0);
    expect(() =>
      issueCreditNote(org, actor, inv.id, 400000, "too much"),
    ).toThrow();
    expect(() => issueCreditNote(org, actor, inv.id, 1, "")).toThrow();
    expect(() =>
      issueCreditNote("org_indus", actor, inv.id, 1, "test"),
    ).toThrow();
  });
  it.each([
    "cash",
    "bank_transfer",
    "jazzcash",
    "easypaisa",
    "stripe",
  ] as const)(
    "records partial and final %s payments and rejects duplicates / overpayments",
    (method) => {
      const inv = createAdHocInvoice(org, actor, {
        leaseId: "lease_1",
        type: "utilities",
        amountMinor: 1000000,
        periodMonth: "2026-10",
        dueDate: "2026-10-20",
      });
      const input = {
        invoiceId: inv.id,
        method,
        amountMinor: 400000,
        referenceNumber: `TEST-${method}`,
      };
      const first = recordPayment(org, actor, input);
      expect(first.invoice.status).toBe("partially_paid");
      expect(recordPayment(org, actor, input).payment.receiptId).toBe(
        first.payment.receiptId,
      );
      expect(() =>
        recordPayment(org, actor, { ...input, amountMinor: 500000 }),
      ).toThrow();
      expect(() =>
        recordPayment(org, actor, {
          ...input,
          referenceNumber: "EXCESS",
          amountMinor: 700000,
        }),
      ).toThrow();
      const final = recordPayment(org, actor, {
        ...input,
        referenceNumber: `FINAL-${method}`,
        amountMinor: 600000,
      });
      expect(final.invoice.status).toBe("paid");
      expect(final.invoice.balanceMinor).toBe(0);
      expect(
        listPaymentsAndReceipts(org, "ten_1").filter(
          (p) => p.invoiceId === inv.id,
        ),
      ).toHaveLength(2);
    },
  );
  it("fails closed in live gateway mode and provides deterministic mock confirmations", () => {
    vi.stubEnv("PAYMENT_PROVIDER_MODE", "mock");
    const input = { invoiceId: "x", amountMinor: 100, requestId: "test-12345" };
    for (const provider of ["jazzcash", "easypaisa", "stripe"] as const) {
      const gateway = getPaymentGateway(provider);
      expect(gateway.confirm(input)).toEqual(gateway.confirm(input));
      expect(gateway.confirm(input).referenceNumber).toContain("MOCK");
    }
    vi.stubEnv("PAYMENT_PROVIDER_MODE", "live");
    expect(() => getPaymentGateway("stripe")).toThrow("not enabled");
  });
  it("calculates actual cash-collected owner shares without invented expenses and locks paid statements", () => {
    const statements = generateOwnerStatements(org, actor, "2026-10");
    expect(statements).toHaveLength(3);
    const owner = statements.find((s) => s.ownerId === "own_1")!;
    const line = owner.lineItems.find((l) => l.propertyId === "prop_1")!;
    expect(line.ownershipPct).toBe(70);
    expect(line.ownerShareGrossRentMinor).toBe(
      Math.round(line.totalPropertyRentCollectedMinor * 0.7),
    );
    expect(owner.expensesMinor).toBe(0);
    expect(owner.netPayoutMinor).toBe(
      owner.grossRentMinor - owner.managementFeeMinor,
    );
    expect(
      generateOwnerStatements(org, actor, "2026-10").map((s) => s.id),
    ).toEqual(statements.map((s) => s.id));
    recordOwnerPayout(org, actor, owner.id, "BANK-PAYOUT-1");
    expect(() =>
      recordOwnerPayout(org, actor, owner.id, "BANK-PAYOUT-2"),
    ).toThrow();
    expect(
      generateOwnerStatements(org, actor, "2026-10").find(
        (s) => s.id === owner.id,
      )?.status,
    ).toBe("paid");
    expect(listOwnerStatements("org_indus")).toHaveLength(0);
  });
  it("enforces authentication, RBAC and row-level tenant / owner access through REST", async () => {
    expect((await invoicesApi.GET(req("billing/invoices"))).status).toBe(401);
    const tenant = token("tenant@pakland.pk"),
      owner = token("owner@pakland.pk"),
      agent = token("agent@pakland.pk"),
      other = token("admin@indusvalley.pk");
    expect(
      (
        await invoicesApi.POST(
          req(
            "billing/invoices",
            "POST",
            { action: "rent_cycle", periodMonth: "2026-11" },
            agent,
          ),
        )
      ).status,
    ).toBe(403);
    expect(
      (await tenantsApi.GET(req("tenants", "GET", undefined, tenant))).status,
    ).toBe(403);
    const ownInvoices = await (
      await invoicesApi.GET(req("billing/invoices", "GET", undefined, tenant))
    ).json();
    expect(ownInvoices.invoices).toHaveLength(12);
    expect(
      ownInvoices.invoices.every((i: InvoiceRecord) => i.tenantId === "ten_1"),
    ).toBe(true);
    expect(
      (
        await (
          await leasesApi.GET(req("leases", "GET", undefined, tenant))
        ).json()
      ).leases,
    ).toHaveLength(1);
    expect(
      (
        await agreementApi(
          req("leases/lease_2/agreement", "GET", undefined, tenant),
          ctx("lease_2"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await receiptApi(
          req("billing/receipts/rec_2_12", "GET", undefined, tenant),
          ctx("rec_2_12"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await (
          await invoicesApi.GET(
            req("billing/invoices", "GET", undefined, other),
          )
        ).json()
      ).invoices,
    ).toHaveLength(0);
    const allowed = await (
      await invoicesApi.GET(req("billing/invoices", "GET", undefined, owner))
    ).json();
    expect(allowed.invoices.length).toBeGreaterThan(0);
    expect(allowed.invoices.length).toBeLessThan(240);
    generateOwnerStatements(org, actor, "2026-10");
    expect(
      (
        await (
          await statementsApi.GET(
            req("billing/statements", "GET", undefined, owner),
          )
        ).json()
      ).statements,
    ).toHaveLength(1);
    expect(
      (await paymentsApi.POST(req("billing/payments", "POST", {}, owner)))
        .status,
    ).toBe(403);
    expect(
      (
        await (
          await arrearsApi(req("billing/arrears", "GET", undefined, tenant))
        ).json()
      ).totalArrearsMinor,
    ).toBe(0);
  });
  it("completes tenant -> signed-ready lease -> invoice -> partial payment -> PDF receipt -> owner statement over REST", async () => {
    const admin = token();
    const createdTenant = await tenantsApi.POST(
      req("tenants", "POST", tenantPayload, admin),
    );
    expect(createdTenant.status).toBe(201);
    const { tenant } = await createdTenant.json();
    expect(
      (
        await tenantsApi.PATCH(
          req(
            "tenants",
            "PATCH",
            { id: tenant.id, kycStatus: "verified" },
            admin,
          ),
        )
      ).status,
    ).toBe(200);
    const createdLease = await leasesApi.POST(
      req(
        "leases",
        "POST",
        {
          unitId: "unit_22",
          tenantId: tenant.id,
          startDate: "2026-10-01",
          endDate: "2027-09-30",
          rentMinor: 10000000,
        },
        admin,
      ),
    );
    expect(createdLease.status).toBe(201);
    const { lease } = await createdLease.json();
    for (const status of ["pending_signature", "active"])
      expect(
        (
          await leasesApi.PATCH(
            req("leases", "PATCH", { id: lease.id, status }, admin),
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await checklistApi.PUT(
          req(
            `leases/${lease.id}/checklist`,
            "PUT",
            {
              kind: "move_in",
              items: [{ label: "Keys received", checked: true }],
              photos: [],
            },
            admin,
          ),
          ctx(lease.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await checklistApi.GET(
          req(`leases/${lease.id}/checklist`, "GET", undefined, admin),
          ctx(lease.id),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await depositApi(
          req(
            `leases/${lease.id}/deposit`,
            "POST",
            {
              type: "deposit_received",
              amountMinor: 20000000,
              reference: "DEPOSIT-TEST",
            },
            admin,
          ),
          ctx(lease.id),
        )
      ).status,
    ).toBe(201);
    const agreement = await agreementApi(
      req(`leases/${lease.id}/agreement`, "GET", undefined, admin),
      ctx(lease.id),
    );
    expect(agreement.headers.get("content-type")).toBe("application/pdf");
    expect(
      (await PDFDocument.load(await agreement.arrayBuffer())).getPageCount(),
    ).toBeGreaterThan(0);
    expect(
      (
        await agreementApi(
          req(
            `leases/${lease.id}/agreement?format=json`,
            "GET",
            undefined,
            admin,
          ),
          ctx(lease.id),
        )
      ).status,
    ).toBe(200);
    const cycle = await invoicesApi.POST(
      req(
        "billing/invoices",
        "POST",
        { action: "rent_cycle", periodMonth: "2026-10" },
        admin,
      ),
    );
    expect(cycle.status).toBe(201);
    const invoice = (await cycle.json()).invoices.find(
      (i: InvoiceRecord) => i.leaseId === lease.id,
    );
    const paid = await paymentsApi.POST(
      req(
        "billing/payments",
        "POST",
        {
          invoiceId: invoice.id,
          method: "cash",
          amountMinor: 3000000,
          referenceNumber: "REST-PARTIAL",
        },
        admin,
      ),
    );
    expect(paid.status).toBe(201);
    const result = await paid.json();
    expect(result.invoice.status).toBe("partially_paid");
    const receipt = await receiptApi(
      req(result.payment.pdfUrl.slice(8), "GET", undefined, admin),
      ctx(result.payment.receiptId),
    );
    expect(receipt.headers.get("content-type")).toBe("application/pdf");
    expect(
      (await PDFDocument.load(await receipt.arrayBuffer())).getPageCount(),
    ).toBe(1);
    expect(
      (await paymentsApi.GET(req("billing/payments", "GET", undefined, admin)))
        .status,
    ).toBe(200);
    expect(
      (
        await invoicesApi.PATCH(
          req(
            "billing/invoices",
            "PATCH",
            {
              action: "credit",
              invoiceId: invoice.id,
              creditMinor: 1000000,
              reason: "Settlement",
            },
            admin,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await invoicesApi.PATCH(
          req(
            "billing/invoices",
            "PATCH",
            { action: "late_fees", invoiceId: invoice.id },
            admin,
          ),
        )
      ).status,
    ).toBe(200);
    const statements = await statementsApi.POST(
      req("billing/statements", "POST", { periodMonth: "2026-10" }, admin),
    );
    expect(statements.status).toBe(201);
    const statement = (await statements.json()).statements[0];
    const pdf = await statementsApi.GET(
      req(
        `billing/statements?id=${statement.id}&format=pdf`,
        "GET",
        undefined,
        admin,
      ),
    );
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(
      (
        await statementsApi.PATCH(
          req(
            "billing/statements",
            "PATCH",
            { id: statement.id, reference: "REST-PAYOUT" },
            admin,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (await arrearsApi(req("billing/arrears", "GET", undefined, admin)))
        .status,
    ).toBe(200);
  });
  it("validates REST payloads, simulates gateway checkout idempotently, and hides foreign documents", async () => {
    const admin = token(),
      other = token("admin@indusvalley.pk");
    expect(
      (
        await invoicesApi.POST(
          req(
            "billing/invoices",
            "POST",
            { action: "rent_cycle", periodMonth: "2026-99" },
            admin,
          ),
        )
      ).status,
    ).toBe(400);
    expect(
      (await leasesApi.POST(req("leases", "POST", {}, admin))).status,
    ).toBe(400);
    expect(
      (
        await paymentsApi.POST(
          req(
            "billing/payments",
            "POST",
            {
              invoiceId: "inv_17_12",
              method: "cash",
              amountMinor: 1.5,
              referenceNumber: "bad",
            },
            admin,
          ),
        )
      ).status,
    ).toBe(400);
    const body = {
      invoiceId: "inv_17_12",
      method: "jazzcash",
      amountMinor: 100000,
      requestId: "mock-checkout-1",
    };
    const a = await checkoutApi(req("billing/checkout", "POST", body, admin));
    expect(a.status).toBe(201);
    expect((await a.json()).mode).toBe("mock");
    const b = await checkoutApi(req("billing/checkout", "POST", body, admin));
    expect(b.status).toBe(201);
    expect(
      (
        await receiptApi(
          req("billing/receipts/rec_1_12", "GET", undefined, other),
          ctx("rec_1_12"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await agreementApi(
          req("leases/lease_1/agreement", "GET", undefined, other),
          ctx("lease_1"),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await invoicesApi.POST(
          req(
            "billing/invoices",
            "POST",
            {
              action: "recurring_charge",
              leaseId: "lease_1",
              type: "maintenance",
              amountMinor: 100,
              startMonth: "2026-11",
              endMonth: "2027-01",
            },
            admin,
          ),
        )
      ).status,
    ).toBe(201);
    expect(
      (
        await invoicesApi.POST(
          req(
            "billing/invoices",
            "POST",
            {
              leaseId: "lease_1",
              type: "utilities",
              amountMinor: 100,
              periodMonth: "2026-11",
              dueDate: "2026-11-05",
            },
            admin,
          ),
        )
      ).status,
    ).toBe(201);
  });
  it("rolls back payment and invoice mutations if issuing the receipt fails", () => {
    const invoice = createAdHocInvoice(org, actor, {
      leaseId: "lease_1",
      type: "utilities",
      periodMonth: "2026-10",
      dueDate: "2026-10-20",
      amountMinor: 1000,
    });
    getDb().exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON receipts BEGIN SELECT RAISE(ABORT, 'Receipt failure'); END",
    );
    expect(() =>
      recordPayment(org, actor, {
        invoiceId: invoice.id,
        method: "cash",
        amountMinor: 500,
        referenceNumber: "ROLLBACK-TEST",
      }),
    ).toThrow("Receipt failure");
    expect(
      listInvoices({ organizationId: org, limit: 1000 }).find(
        (i) => i.id === invoice.id,
      )!.paidMinor,
    ).toBe(0);
    expect(
      listPaymentsAndReceipts(org).some(
        (p) => p.referenceNumber === "ROLLBACK-TEST",
      ),
    ).toBe(false);
    expect(
      getDb()
        .prepare(
          "SELECT COUNT(*) AS n FROM payments WHERE reference_number = 'ROLLBACK-TEST'",
        )
        .get()?.n,
    ).toBe(0);
    getDb().exec("DROP TRIGGER fail_receipt");
  });
  it("expires elapsed leases and prevents premature expiry", () => {
    const lease = draft();
    activate(lease.id);
    expect(() =>
      updateLeaseLifecycle(org, actor, lease.id, { status: "expired" }),
    ).toThrow("not yet expired");
    vi.setSystemTime(new Date("2027-11-01T08:00:00Z"));
    expect(
      updateLeaseLifecycle(org, actor, lease.id, { status: "expired" }).status,
    ).toBe("expired");
    expect(
      getDb().prepare("SELECT status FROM units WHERE id='unit_22'").get()
        ?.status,
    ).toBe("available");
  });
  it("deducts only completed actual work-order costs from owner shares", () => {
    const now = "2026-10-14T08:00:00Z";
    getDb()
      .prepare(
        `INSERT INTO vendors(id,organization_id,name,trade_category,phone,base_rate_minor,created_at,updated_at) VALUES ('test_vendor',?,'Test vendor','plumbing','03000000000',0,?,?)`,
      )
      .run(org, now, now);
    getDb()
      .prepare(
        `INSERT INTO maintenance_tickets(id,organization_id,property_id,unit_id,ticket_number,title,description,category,sla_due_at,created_at,updated_at) VALUES ('test_ticket',?,'prop_1','unit_1','TST-1','Leak','Leaking pipe','plumbing',?,?,?)`,
      )
      .run(org, now, now, now);
    getDb()
      .prepare(
        `INSERT INTO work_orders(id,organization_id,ticket_id,vendor_id,work_order_number,status,estimated_cost_minor,actual_cost_minor,scheduled_at,completed_at,created_at,updated_at) VALUES ('test_work',?,'test_ticket','test_vendor','WO-TEST','completed',1000000,800000,?,?,?,?)`,
      )
      .run(org, now, now, now, now);
    const statements = generateOwnerStatements(org, actor, "2026-10");
    expect(statements.find((s) => s.ownerId === "own_1")!.expensesMinor).toBe(
      560000,
    );
    expect(statements.find((s) => s.ownerId === "own_2")!.expensesMinor).toBe(
      240000,
    );
  });
  it("migrates an existing pre-Phase-3 database without deleting records", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "rems-phase3-migration-"));
    const dbPath = path.join(dir, "legacy.sqlite");
    const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite");
    const legacy = new DatabaseSync(dbPath);
    legacy.exec(
      SCHEMA_DDL.replace("  references_json TEXT NOT NULL DEFAULT '[]',", ""),
    );
    seedDatabase(legacy);
    legacy.close();
    try {
      vi.stubEnv("SQLITE_DB_PATH", dbPath);
      const migrated = resetDbForTesting();
      expect(
        migrated.prepare("SELECT COUNT(*) AS n FROM tenants").get()?.n,
      ).toBe(20);
      expect(
        migrated
          .prepare("SELECT references_json FROM tenants WHERE id='ten_1'")
          .get()?.references_json,
      ).toBe("[]");
      expect(
        listTenants({ organizationId: org }).find((t) => t.id === "ten_1")!
          .references,
      ).toEqual([]);
    } finally {
      vi.unstubAllEnvs();
      resetDbForTesting();
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("rejects malformed JSON with a 400 response", async () => {
    const response = await tenantsApi.POST(
      new NextRequest("http://localhost:3000/api/v1/tenants", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token()}`,
          "Content-Type": "application/json",
        },
        body: "{",
      }),
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error.code).toBe("INVALID_JSON");
  });
});
