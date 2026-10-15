import { postDepositsInternal } from "../accounting/posting";
import { getDb } from "@/server/db";
import {
  newId,
  nowIso,
  today,
  valid,
  dateSchema,
  moneySchema,
  atomic,
} from "@/server/modules/shared/domain";
import { z } from "zod";
import { HttpError } from "@/server/auth/guards";
import { recordAuditLog } from "@/server/modules/audit/audit.service";
const formatMinorCurrency = (n: number) =>
  `PKR ${(n / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type KycStatus = "pending" | "verified" | "rejected";
export type LeaseStatus =
  | "draft"
  | "pending_signature"
  | "active"
  | "expiring"
  | "renewed"
  | "terminated"
  | "expired";
export type LeaseExpiryWindow =
  "expired" | "30_days" | "60_days" | "90_days" | "safe";

export interface TenantRecord {
  id: string;
  organizationId: string;
  userId: string | null;
  fullName: string;
  cnic: string;
  phone: string;
  email: string;
  kycStatus: KycStatus;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  references: { name: string; phone: string; relationship?: string }[];
  activeLeaseNumber: string | null;
  unitNumber: string | null;
  propertyName: string | null;
  totalInvoicedMinor: number;
  totalPaidMinor: number;
  arrearsMinor: number;
  createdAt: string;
}

export interface LeaseRecord {
  id: string;
  organizationId: string;
  propertyId: string;
  propertyName: string;
  unitId: string;
  unitNumber: string;
  tenantId: string;
  tenantName: string;
  tenantPhone: string;
  tenantCnic: string;
  leaseNumber: string;
  status: LeaseStatus;
  startDate: string;
  endDate: string;
  rentMinor: number;
  depositMinor: number;
  escalationPct: number;
  dueDay: number;
  graceDays: number;
  lateFeeMinor: number;
  currency: string;
  daysRemaining: number;
  expiryWindow: LeaseExpiryWindow;
  createdAt: string;
}

export function computeLeaseExpiryWindow(
  endDateStr: string,
  asOf = today(),
): {
  daysRemaining: number;
  expiryWindow: LeaseExpiryWindow;
} {
  const end = new Date(`${endDateStr.slice(0, 10)}T00:00:00.000Z`);
  const diffDays = Math.ceil(
    (end.getTime() - new Date(asOf).getTime()) / (1000 * 60 * 60 * 24),
  );
  if (diffDays < 0) {
    return { daysRemaining: diffDays, expiryWindow: "expired" };
  }
  if (diffDays <= 30) {
    return { daysRemaining: diffDays, expiryWindow: "30_days" };
  }
  if (diffDays <= 60) {
    return { daysRemaining: diffDays, expiryWindow: "60_days" };
  }
  if (diffDays <= 90) {
    return { daysRemaining: diffDays, expiryWindow: "90_days" };
  }
  return { daysRemaining: diffDays, expiryWindow: "safe" };
}

export function listTenants(params: {
  organizationId: string;
  search?: string;
  kycStatus?: string;
}): TenantRecord[] {
  const db = getDb();
  const clauses: string[] = ["t.organization_id = ?", "t.deleted_at IS NULL"];
  const args: (string | number)[] = [params.organizationId];

  if (params.kycStatus) {
    clauses.push("t.kyc_status = ?");
    args.push(params.kycStatus);
  }
  if (params.search && params.search.trim()) {
    const q = `%${params.search.trim().toLowerCase()}%`;
    clauses.push(
      "(LOWER(t.full_name) LIKE ? OR LOWER(t.cnic) LIKE ? OR LOWER(t.phone) LIKE ? OR LOWER(t.email) LIKE ?)",
    );
    args.push(q, q, q, q);
  }

  const rows = db
    .prepare(
      `SELECT
        t.id,
        t.organization_id AS organizationId,
        t.user_id AS userId,
        t.full_name AS fullName,
        t.cnic,
        t.phone,
        t.email,
        t.kyc_status AS kycStatus,
        t.emergency_contact_name AS emergencyContactName,
        t.emergency_contact_phone AS emergencyContactPhone,
        t.references_json AS referencesJson,
        t.created_at AS createdAt,
        l.lease_number AS activeLeaseNumber,
        u.unit_number AS unitNumber,
        p.name AS propertyName,
        COALESCE((SELECT SUM(i.total_minor) FROM invoices i WHERE i.tenant_id = t.id AND i.deleted_at IS NULL), 0) AS totalInvoicedMinor,
        COALESCE((SELECT SUM(i.paid_minor) FROM invoices i WHERE i.tenant_id = t.id AND i.deleted_at IS NULL), 0) AS totalPaidMinor
       FROM tenants t
       LEFT JOIN leases l ON l.id = (SELECT tl.id FROM leases tl WHERE tl.tenant_id = t.id AND tl.organization_id = t.organization_id AND tl.status IN ('active', 'expiring', 'renewed') AND tl.deleted_at IS NULL ORDER BY tl.start_date DESC, tl.id LIMIT 1)
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = l.property_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY t.full_name ASC`,
    )
    .all(...args) as Array<
    Omit<TenantRecord, "arrearsMinor" | "references"> & {
      referencesJson: string;
    }
  >;

  return rows.map((r) => ({
    ...r,
    references: JSON.parse(r.referencesJson),
    arrearsMinor: Math.max(0, r.totalInvoicedMinor - r.totalPaidMinor),
  }));
}

export function createTenant(
  organizationId: string,
  actorUserId: string,
  input: {
    fullName: string;
    cnic: string;
    phone: string;
    email: string;
    kycStatus?: KycStatus;
    emergencyContactName?: string;
    emergencyContactPhone?: string;
    references?: { name: string; phone: string; relationship?: string }[];
  },
): TenantRecord {
  input = valid(
    z.object({
      fullName: z.string().trim().min(2),
      cnic: z.string().regex(/^\d{5}-\d{7}-\d$/),
      phone: z.string().trim().min(7),
      email: z.string().email(),
      kycStatus: z.enum(["pending", "verified", "rejected"]).optional(),
      emergencyContactName: z.string().optional(),
      emergencyContactPhone: z.string().optional(),
      references: z
        .array(
          z.object({
            name: z.string().trim().min(1),
            phone: z.string().trim().min(7),
            relationship: z.string().optional(),
          }),
        )
        .max(5)
        .optional(),
    }),
    input,
  );
  const db = getDb();
  if (
    db
      .prepare(
        "SELECT id FROM tenants WHERE organization_id = ? AND cnic = ? AND deleted_at IS NULL",
      )
      .get(organizationId, input.cnic)
  )
    throw new HttpError(
      409,
      "DUPLICATE_CNIC",
      "A tenant with this CNIC already exists.",
    );
  const id = newId("ten");
  const now = nowIso();
  const kyc: KycStatus = input.kycStatus || "pending";

  db.prepare(
    `INSERT INTO tenants (
      id, organization_id, full_name, cnic, phone, email, kyc_status,
      emergency_contact_name, emergency_contact_phone, references_json, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    organizationId,
    input.fullName.trim(),
    input.cnic.trim(),
    input.phone.trim(),
    input.email?.trim() || `${id}@tenant.fahadrealestate.test`,
    kyc,
    input.emergencyContactName?.trim() || null,
    input.emergencyContactPhone?.trim() || null,
    JSON.stringify(input.references || []),
    now,
    now,
    actorUserId,
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "tenant.created",
    entityType: "tenant",
    entityId: id,
    metadata: { fullName: input.fullName, cnic: input.cnic, kycStatus: kyc },
  });

  return listTenants({ organizationId }).find((t) => t.id === id)!;
}

export function updateTenantKyc(
  organizationId: string,
  actorUserId: string,
  tenantId: string,
  kycStatus: KycStatus,
): TenantRecord {
  const valid: KycStatus[] = ["pending", "verified", "rejected"];
  if (!valid.includes(kycStatus)) {
    throw new HttpError(400, "INVALID_KYC_STATUS", "Invalid KYC status.");
  }

  const db = getDb();
  const existing = db
    .prepare(`SELECT id FROM tenants WHERE id = ? AND organization_id = ?`)
    .get(tenantId, organizationId) as { id: string } | undefined;
  if (!existing) {
    throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant not found.");
  }

  db.prepare(
    `UPDATE tenants SET kyc_status = ?, updated_at = ? WHERE id = ?`,
  ).run(kycStatus, nowIso(), tenantId);

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "tenant.kyc_updated",
    entityType: "tenant",
    entityId: tenantId,
    metadata: { kycStatus },
  });

  return listTenants({ organizationId }).find((t) => t.id === tenantId)!;
}

export function listLeases(params: {
  organizationId: string;
  status?: string;
  expiryWindow?: string;
}): LeaseRecord[] {
  const db = getDb();
  const clauses: string[] = ["l.organization_id = ?", "l.deleted_at IS NULL"];
  const args: (string | number)[] = [params.organizationId];

  if (params.status) {
    clauses.push("l.status = ?");
    args.push(params.status);
  }

  const rows = db
    .prepare(
      `SELECT
        l.id,
        l.organization_id AS organizationId,
        l.property_id AS propertyId,
        p.name AS propertyName,
        l.unit_id AS unitId,
        u.unit_number AS unitNumber,
        l.tenant_id AS tenantId,
        t.full_name AS tenantName,
        t.phone AS tenantPhone,
        t.cnic AS tenantCnic,
        l.lease_number AS leaseNumber,
        l.status,
        l.start_date AS startDate,
        l.end_date AS endDate,
        l.rent_minor AS rentMinor,
        l.deposit_minor AS depositMinor,
        l.escalation_pct AS escalationPct,
        l.due_day AS dueDay,
        l.grace_days AS graceDays,
        l.late_fee_minor AS lateFeeMinor,
        l.currency,
        l.created_at AS createdAt
       FROM leases l
       JOIN properties p ON p.id = l.property_id
       JOIN units u ON u.id = l.unit_id
       JOIN tenants t ON t.id = l.tenant_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY l.end_date ASC`,
    )
    .all(...args) as Array<Omit<LeaseRecord, "daysRemaining" | "expiryWindow">>;

  const enriched = rows.map((r) => {
    const exp = computeLeaseExpiryWindow(r.endDate);
    return {
      ...r,
      daysRemaining: exp.daysRemaining,
      expiryWindow: exp.expiryWindow,
    };
  });

  if (params.expiryWindow) {
    return enriched.filter((e) => e.expiryWindow === params.expiryWindow);
  }
  return enriched;
}

export function createLease(
  organizationId: string,
  actorUserId: string,
  input: {
    unitId: string;
    tenantId: string;
    startDate: string;
    endDate: string;
    rentMinor: number;
    depositMinor?: number;
    escalationPct?: number;
    dueDay?: number;
    graceDays?: number;
    lateFeeMinor?: number;
    status?: LeaseStatus;
  },
): LeaseRecord {
  input = valid(
    z.object({
      unitId: z.string().min(1),
      tenantId: z.string().min(1),
      startDate: dateSchema,
      endDate: dateSchema,
      rentMinor: moneySchema.positive(),
      depositMinor: moneySchema.optional(),
      escalationPct: z.number().min(0).max(100).optional(),
      dueDay: z.number().int().min(1).max(28).optional(),
      graceDays: z.number().int().min(0).max(60).optional(),
      lateFeeMinor: moneySchema.optional(),
      status: z.enum(["draft", "pending_signature", "active"]).optional(),
    }),
    input,
  );
  if (input.endDate <= input.startDate)
    throw new HttpError(400, "INVALID_TERM", "Lease end must be after start.");
  return atomic(() => {
    const db = getDb();
    const unit = db
      .prepare(
        `SELECT id, property_id AS propertyId, unit_number AS unitNumber
       FROM units WHERE id = ? AND organization_id = ?`,
      )
      .get(input.unitId, organizationId) as
      { id: string; propertyId: string; unitNumber: string } | undefined;
    if (!unit) {
      throw new HttpError(404, "UNIT_NOT_FOUND", "Unit not found.");
    }

    const tenant = db
      .prepare(
        `SELECT id, full_name AS fullName FROM tenants WHERE id = ? AND organization_id = ?`,
      )
      .get(input.tenantId, organizationId) as
      { id: string; fullName: string } | undefined;
    if (!tenant) {
      throw new HttpError(404, "TENANT_NOT_FOUND", "Tenant not found.");
    }

    if (!Number.isFinite(input.rentMinor) || input.rentMinor <= 0) {
      throw new HttpError(
        400,
        "INVALID_RENT",
        "Monthly rent must be positive.",
      );
    }

    const id = newId("lease");
    const now = nowIso();
    const countRow = db
      .prepare(`SELECT COUNT(*) AS cnt FROM leases WHERE organization_id = ?`)
      .get(organizationId) as { cnt: number };
    const leaseNumber = `LSE-${new Date().getFullYear()}-${String(countRow.cnt + 1).padStart(3, "0")}`;
    const status: LeaseStatus = input.status || "draft";
    assertLeaseAvailable(
      organizationId,
      input.unitId,
      input.startDate,
      input.endDate,
    );
    if (status === "active") assertVerified(organizationId, input.tenantId);
    const depositMinor = input.depositMinor ?? input.rentMinor * 2;
    const escalationPct = input.escalationPct ?? 10.0;
    const dueDay = input.dueDay ?? 5;
    const graceDays = input.graceDays ?? 5;
    const lateFeeMinor = input.lateFeeMinor ?? 5000 * 100;

    db.prepare(
      `INSERT INTO leases (
      id, organization_id, property_id, unit_id, tenant_id, lease_number, status,
      start_date, end_date, rent_minor, deposit_minor, escalation_pct, due_day,
      grace_days, late_fee_minor, currency, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?)`,
    ).run(
      id,
      organizationId,
      unit.propertyId,
      unit.id,
      tenant.id,
      leaseNumber,
      status,
      input.startDate,
      input.endDate,
      Math.round(input.rentMinor),
      Math.round(depositMinor),
      escalationPct,
      dueDay,
      graceDays,
      Math.round(lateFeeMinor),
      now,
      now,
      actorUserId,
    );

    if (status === "active") {
      db.prepare(
        `UPDATE units SET status = 'rented', updated_at = ? WHERE id = ?`,
      ).run(now, unit.id);
    }

    recordAuditLog({
      organizationId,
      actorUserId,
      action: "lease.created",
      entityType: "lease",
      entityId: id,
      metadata: {
        leaseNumber,
        unitNumber: unit.unitNumber,
        tenantName: tenant.fullName,
        status,
      },
    });

    return listLeases({ organizationId }).find((l) => l.id === id)!;
  });
}

export function updateLeaseLifecycle(
  organizationId: string,
  actorUserId: string,
  leaseId: string,
  input: {
    status: LeaseStatus;
    applyEscalation?: boolean;
    newEndDate?: string;
  },
): LeaseRecord {
  const validStatuses: LeaseStatus[] = [
    "draft",
    "pending_signature",
    "active",
    "expiring",
    "renewed",
    "terminated",
    "expired",
  ];
  if (!validStatuses.includes(input.status)) {
    throw new HttpError(400, "INVALID_LEASE_STATUS", "Invalid lease status.");
  }

  return atomic(() => {
    const db = getDb();
    const current = listLeases({ organizationId }).find(
      (l) => l.id === leaseId,
    );
    if (!current) {
      throw new HttpError(404, "LEASE_NOT_FOUND", "Lease not found.");
    }

    input = valid(
      z.object({
        status: z.enum([
          "draft",
          "pending_signature",
          "active",
          "expiring",
          "renewed",
          "terminated",
          "expired",
        ]),
        newEndDate: dateSchema.optional(),
        applyEscalation: z.boolean().optional(),
      }),
      input,
    );
    const transitions: Record<LeaseStatus, LeaseStatus[]> = {
      draft: ["pending_signature", "terminated"],
      pending_signature: ["active", "terminated"],
      active: ["expiring", "renewed", "terminated", "expired"],
      expiring: ["renewed", "terminated", "expired"],
      renewed: ["expiring", "terminated", "expired"],
      terminated: [],
      expired: [],
    };
    if (!transitions[current.status].includes(input.status))
      throw new HttpError(
        409,
        "INVALID_TRANSITION",
        "Lease cannot transition to this status.",
      );
    if (input.applyEscalation && input.status !== "renewed")
      throw new HttpError(
        400,
        "INVALID_ESCALATION",
        "Escalation is only allowed at renewal.",
      );
    if (input.status === "expired" && current.endDate >= today())
      throw new HttpError(
        409,
        "LEASE_NOT_EXPIRED",
        "Lease has not yet expired.",
      );
    if (input.newEndDate && input.status !== "renewed")
      throw new HttpError(
        400,
        "RENEWAL_REQUIRED",
        "Term changes require renewal.",
      );
    const now = nowIso();
    const nextRentMinor =
      input.status === "renewed"
        ? Math.round(current.rentMinor * (1 + current.escalationPct / 100))
        : current.rentMinor;
    const nextEndDate = input.newEndDate || current.endDate;
    if (input.status === "renewed" && nextEndDate <= current.endDate)
      throw new HttpError(
        400,
        "INVALID_RENEWAL",
        "Renewal must extend the lease end date.",
      );
    if (["active", "renewed"].includes(input.status)) {
      assertVerified(organizationId, current.tenantId);
      assertLeaseAvailable(
        organizationId,
        current.unitId,
        current.startDate,
        nextEndDate,
        current.id,
      );
    }
    db.prepare(
      `UPDATE leases
     SET status = ?, rent_minor = ?, end_date = ?, updated_at = ?
     WHERE id = ? AND organization_id = ?`,
    ).run(
      input.status,
      nextRentMinor,
      nextEndDate,
      now,
      leaseId,
      organizationId,
    );

    if (
      ["terminated", "expired"].includes(input.status) &&
      !db
        .prepare(
          "SELECT id FROM leases WHERE organization_id = ? AND unit_id = ? AND id != ? AND status IN ('active','expiring','renewed') AND deleted_at IS NULL",
        )
        .get(organizationId, current.unitId, current.id)
    ) {
      db.prepare(
        `UPDATE units SET status = 'available', updated_at = ? WHERE id = ?`,
      ).run(now, current.unitId);
    } else if (input.status === "active" || input.status === "renewed") {
      db.prepare(
        `UPDATE units SET status = 'rented', updated_at = ? WHERE id = ?`,
      ).run(now, current.unitId);
    }

    recordAuditLog({
      organizationId,
      actorUserId,
      action: "lease.lifecycle_updated",
      entityType: "lease",
      entityId: leaseId,
      metadata: {
        previousStatus: current.status,
        newStatus: input.status,
        previousRentMinor: current.rentMinor,
        newRentMinor: nextRentMinor,
        newEndDate: nextEndDate,
      },
    });

    db.prepare(
      "INSERT INTO lease_events VALUES (?, ?, ?, 'lifecycle', ?, ?, ?)",
    ).run(
      newId("lev"),
      organizationId,
      leaseId,
      JSON.stringify({
        from: current.status,
        to: input.status,
        previousRentMinor: current.rentMinor,
        rentMinor: nextRentMinor,
        endDate: nextEndDate,
      }),
      now,
      actorUserId,
    );
    return listLeases({ organizationId }).find((l) => l.id === leaseId)!;
  });
}

export function generateLeaseAgreementDocument(
  organizationId: string,
  leaseId: string,
) {
  const lease = listLeases({ organizationId }).find((l) => l.id === leaseId);
  if (!lease) {
    throw new HttpError(404, "LEASE_NOT_FOUND", "Lease not found.");
  }

  const organization = getDb()
    .prepare("SELECT legal_name FROM organizations WHERE id = ?")
    .get(organizationId)!;
  const landlord = String(organization.legal_name);
  const contractText = [
    `TENANCY & LEASE AGREEMENT (${lease.leaseNumber})`,
    `Organization: ${landlord}`,
    `Property: ${lease.propertyName} | Unit: ${lease.unitNumber}`,
    `Tenant: ${lease.tenantName} (CNIC: ${lease.tenantCnic}, Phone: ${lease.tenantPhone})`,
    `Lease Term: ${lease.startDate} to ${lease.endDate} (Status: ${lease.status.toUpperCase()})`,
    `Monthly Rent: ${formatMinorCurrency(lease.rentMinor)} (Due Day: ${lease.dueDay}th of each month, Grace Period: ${lease.graceDays} days)`,
    `Security Deposit: ${formatMinorCurrency(lease.depositMinor)} (Refundable upon vacant possession less arrears/damages)`,
    `Annual Escalation: ${lease.escalationPct}% per annum | Late Fee: ${formatMinorCurrency(lease.lateFeeMinor)}`,
  ].join("\n");

  return {
    leaseId: lease.id,
    leaseNumber: lease.leaseNumber,
    title: `Tenancy Agreement - ${lease.leaseNumber} (${lease.unitNumber})`,
    generatedAt: nowIso(),
    landlord,
    tenant: {
      name: lease.tenantName,
      cnic: lease.tenantCnic,
      phone: lease.tenantPhone,
    },
    property: {
      name: lease.propertyName,
      unitNumber: lease.unitNumber,
    },
    financialTerms: {
      monthlyRentMinor: lease.rentMinor,
      monthlyRentFormatted: formatMinorCurrency(lease.rentMinor),
      securityDepositMinor: lease.depositMinor,
      securityDepositFormatted: formatMinorCurrency(lease.depositMinor),
      annualEscalationPct: lease.escalationPct,
      dueDay: lease.dueDay,
      graceDays: lease.graceDays,
      lateFeeMinor: lease.lateFeeMinor,
    },
    contractText,
  };
}

function assertVerified(org: string, tenantId: string) {
  const tenant = getDb()
    .prepare(
      "SELECT kyc_status FROM tenants WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .get(org, tenantId) as { kyc_status: string } | undefined;
  if (tenant?.kyc_status !== "verified")
    throw new HttpError(
      409,
      "KYC_REQUIRED",
      "Verify the tenant KYC before activation.",
    );
}
function assertLeaseAvailable(
  org: string,
  unit: string,
  start: string,
  end: string,
  except = "",
) {
  const clash = getDb()
    .prepare(
      "SELECT id FROM leases WHERE organization_id = ? AND unit_id = ? AND id != ? AND status NOT IN ('terminated','expired') AND deleted_at IS NULL AND start_date <= ? AND end_date >= ?",
    )
    .get(org, unit, except, end, start);
  if (clash)
    throw new HttpError(409, "LEASE_OVERLAP", "Unit has an overlapping lease.");
  const row = getDb()
    .prepare(
      "SELECT status FROM units WHERE organization_id = ? AND id = ? AND deleted_at IS NULL",
    )
    .get(org, unit) as { status: string } | undefined;
  if (!row || row.status === "sold" || row.status === "under_maintenance")
    throw new HttpError(
      409,
      "UNIT_UNAVAILABLE",
      "Unit is unavailable for leasing.",
    );
}
export function saveChecklist(
  org: string,
  actor: string,
  leaseId: string,
  data: unknown,
) {
  if (!listLeases({ organizationId: org }).some((l) => l.id === leaseId))
    throw new HttpError(404, "LEASE_NOT_FOUND", "Lease not found.");
  const input = valid(
    z.object({
      kind: z.enum(["move_in", "move_out"]),
      items: z
        .array(
          z.object({
            label: z.string().min(1),
            checked: z.boolean(),
            notes: z.string().optional(),
          }),
        )
        .min(1)
        .max(100),
      photos: z
        .array(
          z
            .string()
            .url()
            .refine((u) => u.startsWith("https://"), "Use HTTPS photo URLs"),
        )
        .max(20)
        .default([]),
    }),
    data,
  );
  const now = nowIso();
  getDb()
    .prepare(
      `INSERT INTO lease_checklists VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(organization_id, lease_id, kind) DO UPDATE SET items_json = excluded.items_json, photos_json = excluded.photos_json, updated_at = excluded.updated_at`,
    )
    .run(
      newId("chk"),
      org,
      leaseId,
      input.kind,
      JSON.stringify(input.items),
      JSON.stringify(input.photos),
      now,
      now,
      actor,
    );
  recordAuditLog({
    organizationId: org,
    actorUserId: actor,
    action: "lease.checklist_saved",
    entityType: "lease",
    entityId: leaseId,
    metadata: { kind: input.kind },
  });
  return listChecklists(org, leaseId);
}
export function listChecklists(org: string, leaseId: string) {
  return getDb()
    .prepare(
      "SELECT id, kind, items_json, photos_json FROM lease_checklists WHERE organization_id = ? AND lease_id = ?",
    )
    .all(org, leaseId)
    .map((r) => ({
      id: r.id,
      kind: r.kind,
      items: JSON.parse(String(r.items_json)),
      photos: JSON.parse(String(r.photos_json)),
    }));
}
export function recordDeposit(
  org: string,
  actor: string,
  leaseId: string,
  data: unknown,
) {
  const lease = listLeases({ organizationId: org }).find(
    (l) => l.id === leaseId,
  );
  if (!lease) throw new HttpError(404, "LEASE_NOT_FOUND", "Lease not found.");
  const input = valid(
    z.object({
      type: z.enum(["deposit_received", "deposit_refunded"]),
      amountMinor: moneySchema.positive(),
      reference: z.string().trim().min(1),
    }),
    data,
  );
  return atomic(() => {
    const events = getLeaseEvents(org, leaseId);
    const held = events.reduce(
      (n, e) =>
        n +
        (e.type === "deposit_received"
          ? Number(e.payload.amountMinor)
          : e.type === "deposit_refunded"
            ? -Number(e.payload.amountMinor)
            : 0),
      0,
    );
    if (
      input.type === "deposit_received" &&
      held + input.amountMinor > lease.depositMinor
    )
      throw new HttpError(
        409,
        "DEPOSIT_EXCESS",
        "Deposit exceeds agreed security deposit.",
      );
    if (
      input.type === "deposit_refunded" &&
      (input.amountMinor > held ||
        !["terminated", "expired"].includes(lease.status))
    )
      throw new HttpError(
        409,
        "INVALID_REFUND",
        "Terminate the lease first; refund cannot exceed deposit held.",
      );
    getDb()
      .prepare("INSERT INTO lease_events VALUES (?, ?, ?, ?, ?, ?, ?)")
      .run(
        newId("lev"),
        org,
        leaseId,
        input.type,
        JSON.stringify(input),
        nowIso(),
        actor,
      );
    recordAuditLog({
      organizationId: org,
      actorUserId: actor,
      action: `lease.${input.type}`,
      entityType: "lease",
      entityId: leaseId,
      metadata: input,
    });
    postDepositsInternal(org,actor,leaseId);
    return getLeaseEvents(org, leaseId);
  });
}
export function getLeaseEvents(org: string, leaseId: string) {
  return getDb()
    .prepare(
      "SELECT id, type, payload_json, created_at FROM lease_events WHERE organization_id = ? AND lease_id = ? ORDER BY created_at",
    )
    .all(org, leaseId)
    .map((r) => ({
      id: r.id,
      type: r.type,
      payload: JSON.parse(String(r.payload_json)),
      createdAt: r.created_at,
    }));
}
