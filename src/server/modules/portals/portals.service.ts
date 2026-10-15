import { z } from "zod";
import { getDb } from "@/server/db";
import type { JwtPayload } from "@/server/auth/crypto";
import { HttpError, requirePermission } from "@/server/auth/guards";
import { freshContext } from "../orchestration/orchestration.service";
import { atomic, newId, nowIso, valid, moneySchema } from "../shared/domain";
import { fingerprint, safeText } from "../domain-agents/safety";
import { recordAuditLog } from "../audit/audit.service";
const ownerScope = (alias: string) =>
  `EXISTS(SELECT 1 FROM property_owners po JOIN owners o ON o.id=po.owner_id AND o.organization_id=po.organization_id WHERE po.organization_id=${alias}.organization_id AND po.property_id=${alias}.property_id AND po.deleted_at IS NULL AND o.deleted_at IS NULL AND o.user_id=?)`;
const tenantScope = (alias: string) =>
  `EXISTS(SELECT 1 FROM tenants t WHERE t.organization_id=${alias}.organization_id AND t.id=${alias}.tenant_id AND t.deleted_at IS NULL AND t.user_id=?)`;
const resources = [
  "leases",
  "invoices",
  "payments",
  "tickets",
  "properties",
  "units",
  "statements",
  "reviews",
  "notifications",
] as const;
function actor(ctx: JwtPayload) {
  return freshContext(ctx.organizationId, ctx.sub);
}
function linked(ctx: JwtPayload) {
  const role = ctx.roleSlug;
  if (!["owner", "tenant"].includes(role))
    throw new HttpError(
      403,
      "PORTAL_ROLE",
      "Personal portals require an owner or tenant role.",
    );
  requirePermission(ctx, `portal:${role}`);
  return role;
}
export function portalPage(ctx: JwtPayload, input: unknown) {
  ctx = actor(ctx);
  const role = linked(ctx),
    q = valid(
      z
        .object({
          resource: z.enum(resources),
          page: z.coerce.number().int().min(1).max(10000).default(1),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        })
        .strict(),
      input,
    ),
    db = getDb();
  let table = "",
    columns = "",
    scope = "",
    extra = "AND r.deleted_at IS NULL",
    sort = "r.id";
  const specs: Record<string, [string, string, string]> = {
    leases: [
      "leases",
      "leases:read",
      "r.id,r.lease_number,r.property_id,r.unit_id,r.status,r.start_date,r.end_date,r.rent_minor,r.deposit_minor,r.escalation_pct",
    ],
    invoices: [
      "invoices",
      "invoices:read",
      "r.id,r.invoice_number,r.lease_id,r.property_id,r.unit_id,r.type,r.period_month,r.due_date,r.total_minor,r.paid_minor,r.status",
    ],
    payments: [
      "payments",
      "payments:read",
      "r.id,r.invoice_id,r.amount_minor,r.method,r.reference_number,r.paid_at,r.status",
    ],
    tickets: [
      "maintenance_tickets",
      "maintenance:read",
      "r.id,r.ticket_number,r.property_id,r.unit_id,r.title,r.description,r.category,r.priority,r.status,r.sla_due_at,r.created_at",
    ],
    properties: ["properties", "properties:read", "r.id,r.name,r.city,r.type"],
    units: [
      "units",
      "properties:read",
      "r.id,r.property_id,r.unit_number,r.type,r.status,r.area_sqft",
    ],
    statements: [
      "owner_statements",
      "statements:read",
      "r.id,r.owner_id,r.period_month,r.gross_rent_minor,r.expenses_minor,r.management_fee_minor,r.net_payout_minor,r.status,r.line_items_json",
    ],
    reviews: [
      "portal_reviews",
      "portal:owner",
      "r.id,r.owner_id,r.property_id,r.entity_type,r.entity_id,r.summary,r.proposed_cost_minor,r.status,r.decision_note,r.created_at",
    ],
    notifications: [
      "notifications",
      `portal:${role}`,
      "r.id,r.subject,r.body,r.status,r.sent_at,r.read_at",
    ],
  };
  const spec = specs[q.resource];
  [table, , columns] = spec;
  requirePermission(ctx, spec[1]);
  if (
    ["properties", "units", "statements", "reviews"].includes(q.resource) &&
    role !== "owner"
  )
    throw new HttpError(
      403,
      "OWNER_ONLY",
      "This resource belongs to the owner portal.",
    );
  if (q.resource === "notifications") {
    scope = "r.user_id=?";
    extra = "AND r.channel='in_app'";
    sort = "r.created_at DESC,r.id";
  } else if (q.resource === "properties")
    scope = ownerScope("r").replace("r.property_id", "r.id");
  else if (["statements", "reviews"].includes(q.resource)) {
    scope =
      "EXISTS(SELECT 1 FROM owners o WHERE o.id=r.owner_id AND o.organization_id=r.organization_id AND o.user_id=? AND o.deleted_at IS NULL)";
    extra = "";
    sort =
      q.resource === "statements"
        ? "r.period_month DESC,r.id"
        : "r.created_at DESC,r.id";
  } else if (q.resource === "payments") {
    scope =
      role === "tenant"
        ? tenantScope("r")
        : `EXISTS(SELECT 1 FROM invoices i WHERE i.id=r.invoice_id AND i.organization_id=r.organization_id AND i.deleted_at IS NULL AND ${ownerScope("i")})`;
    sort = "r.paid_at DESC,r.id";
  } else scope = role === "tenant" ? tenantScope("r") : ownerScope("r");
  if (q.resource === "invoices") sort = "r.due_date DESC,r.id";
  if (q.resource === "tickets") sort = "r.created_at DESC,r.id";
  const rows = db
    .prepare(
      `SELECT ${columns} FROM ${table} r WHERE r.organization_id=? AND ${scope} ${extra} ORDER BY ${sort} LIMIT ? OFFSET ?`,
    )
    .all(ctx.organizationId, ctx.sub, q.limit + 1, (q.page - 1) * q.limit);
  return {
    resource: q.resource,
    page: q.page,
    limit: q.limit,
    hasMore: rows.length > q.limit,
    items: rows.slice(0, q.limit),
    currency: "PKR",
  };
}
export function portalSummary(ctx: JwtPayload) {
  ctx = actor(ctx);
  const db = getDb(),
    org = ctx.organizationId;
  const company = db
    .prepare("SELECT name FROM organizations WHERE id=?")
    .get(org)!.name;
  if (!["owner", "tenant"].includes(ctx.roleSlug)) {
    if (
      !ctx.permissions.includes("maintenance:triage") &&
      !ctx.permissions.includes("leases:write")
    )
      throw new HttpError(
        403,
        "STAFF_ONLY",
        "Staff consent requests need a domain write permission.",
      );
    return {
      role: "staff",
      company,
      linkedProfiles: 0,
      outstandingMinor: 0,
      options: {
        linking: ctx.permissions.includes("admin:manage")
          ? {
              owners: db
                .prepare(
                  "SELECT id,full_name label,user_id FROM owners WHERE organization_id=? AND deleted_at IS NULL LIMIT 200",
                )
                .all(org),
              tenants: db
                .prepare(
                  "SELECT id,full_name label,user_id FROM tenants WHERE organization_id=? AND deleted_at IS NULL LIMIT 200",
                )
                .all(org),
              users: db
                .prepare(
                  "SELECT u.id,u.full_name label,r.slug role FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id WHERE u.organization_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.deleted_at IS NULL AND r.slug IN ('owner','tenant') LIMIT 200",
                )
                .all(org),
            }
          : null,
        owners: db
          .prepare(
            "SELECT id,full_name label FROM owners WHERE organization_id=? AND user_id IS NOT NULL AND deleted_at IS NULL LIMIT 200",
          )
          .all(org),
        tickets: ctx.permissions.includes("maintenance:triage")
          ? db
              .prepare(
                "SELECT id,ticket_number label,property_id FROM maintenance_tickets WHERE organization_id=? AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 100",
              )
              .all(org)
          : [],
        leases: ctx.permissions.includes("leases:write")
          ? db
              .prepare(
                "SELECT id,lease_number label,property_id FROM leases WHERE organization_id=? AND deleted_at IS NULL ORDER BY end_date LIMIT 100",
              )
              .all(org)
          : [],
      },
    };
  }
  const role = linked(ctx),
    profiles = Number(
      db
        .prepare(
          `SELECT COUNT(*) n FROM ${role === "tenant" ? "tenants" : "owners"} WHERE organization_id=? AND user_id=? AND deleted_at IS NULL`,
        )
        .get(org, ctx.sub)!.n,
    );
  const scope = role === "tenant" ? tenantScope("r") : ownerScope("r"),
    balance = Number(
      db
        .prepare(
          `SELECT COALESCE(SUM(r.total_minor-r.paid_minor),0) n FROM invoices r WHERE r.organization_id=? AND ${scope} AND r.deleted_at IS NULL AND r.status!='cancelled'`,
        )
        .get(org, ctx.sub)!.n,
    );
  if (!Number.isSafeInteger(balance))
    throw new HttpError(
      422,
      "MONEY_RANGE",
      "Balance cannot be represented in exact paisa.",
    );
  const units =
    role === "tenant"
      ? db
          .prepare(
            `SELECT u.id,u.unit_number label FROM units u WHERE u.organization_id=? AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM leases r WHERE r.organization_id=u.organization_id AND r.unit_id=u.id AND r.deleted_at IS NULL AND r.status IN ('active','expiring','renewed') AND ${tenantScope("r")}) ORDER BY u.id`,
          )
          .all(org, ctx.sub)
      : [];
  return {
    role,
    company,
    linkedProfiles: profiles,
    outstandingMinor: balance,
    options: { owners: [], tickets: [], leases: [], units },
    notice:
      "Recorded demo/unverified data. No live payment, bank balance verification or automatic contract execution.",
  };
}
function reviewSource(ctx: JwtPayload, kind: string, id: string) {
  const table = kind === "lease" ? "leases" : "maintenance_tickets",
    row = getDb()
      .prepare(
        `SELECT * FROM ${table} WHERE organization_id=? AND id=? AND deleted_at IS NULL`,
      )
      .get(ctx.organizationId, id);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Consent source not found.");
  return row;
}
export function requestOwnerReview(ctx: JwtPayload, input: unknown) {
  ctx = actor(ctx);
  const b = valid(
    z
      .object({
        ownerId: z.string().min(1),
        entityType: z.enum(["lease", "maintenance"]),
        entityId: z.string().min(1),
        summary: z.string().trim().min(5).max(1200),
        proposedCostMinor: moneySchema.default(0),
      })
      .strict(),
    input,
  );
  requirePermission(
    ctx,
    b.entityType === "lease" ? "leases:write" : "maintenance:triage",
  );
  return atomic(() => {
    const source = reviewSource(ctx, b.entityType, b.entityId),
      db = getDb();
    const owner = db
      .prepare(
        "SELECT o.id,o.user_id FROM owners o JOIN property_owners po ON po.owner_id=o.id AND po.organization_id=o.organization_id JOIN users u ON u.id=o.user_id AND u.organization_id=o.organization_id WHERE o.organization_id=? AND o.id=? AND po.property_id=? AND po.deleted_at IS NULL AND o.deleted_at IS NULL AND u.deleted_at IS NULL AND u.status='active'",
      )
      .get(ctx.organizationId, b.ownerId, String(source.property_id));
    if (!owner || owner.user_id === ctx.sub)
      throw new HttpError(
        404,
        "NOT_FOUND",
        "Different linked owner for this property required.",
      );
    const id = newId("consent");
    db.prepare(
      "INSERT INTO portal_reviews(id,organization_id,owner_id,property_id,entity_type,entity_id,summary,proposed_cost_minor,source_hash,created_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      id,
      ctx.organizationId,
      b.ownerId,
      String(source.property_id),
      b.entityType,
      b.entityId,
      safeText(b.summary, 1200),
      b.proposedCostMinor,
      fingerprint(source),
      nowIso(),
      ctx.sub,
    );
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "portal.owner_consent_requested",
      entityType: "portal_review",
      entityId: id,
      metadata: {
        entityType: b.entityType,
        entityId: b.entityId,
        binding: false,
      },
    });
    return { id, status: "pending", binding: false };
  });
}
export function decideOwnerReview(ctx: JwtPayload, input: unknown) {
  ctx = actor(ctx);
  if (linked(ctx) !== "owner")
    throw new HttpError(
      403,
      "OWNER_ONLY",
      "Only the linked owner can record consent.",
    );
  const b = valid(
    z
      .object({
        id: z.string().min(1),
        decision: z.enum(["approved", "rejected"]),
        note: z.string().trim().min(3).max(1000),
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const db = getDb(),
      r = db
        .prepare(
          "SELECT r.* FROM portal_reviews r JOIN owners o ON o.id=r.owner_id AND o.organization_id=r.organization_id WHERE r.organization_id=? AND r.id=? AND o.user_id=? AND o.deleted_at IS NULL AND EXISTS(SELECT 1 FROM property_owners po WHERE po.organization_id=r.organization_id AND po.property_id=r.property_id AND po.owner_id=r.owner_id AND po.deleted_at IS NULL)",
        )
        .get(ctx.organizationId, b.id, ctx.sub);
    if (!r)
      throw new HttpError(404, "NOT_FOUND", "Owner consent request not found.");
    if (r.status !== "pending")
      throw new HttpError(409, "ALREADY_REVIEWED", "Decision is final.");
    if (
      fingerprint(
        reviewSource(ctx, String(r.entity_type), String(r.entity_id)),
      ) !== r.source_hash
    )
      throw new HttpError(
        409,
        "STALE_CONSENT",
        "Source changed; staff must issue a fresh consent request.",
      );
    db.prepare(
      "UPDATE portal_reviews SET status=?,decision_note=?,reviewed_at=?,reviewed_by=? WHERE organization_id=? AND id=? AND status='pending'",
    ).run(
      b.decision,
      safeText(b.note, 1000),
      nowIso(),
      ctx.sub,
      ctx.organizationId,
      b.id,
    );
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: `portal.owner_consent_${b.decision}`,
      entityType: "portal_review",
      entityId: b.id,
      metadata: { binding: false, executesBusinessWrite: false },
    });
    return {
      id: b.id,
      status: b.decision,
      binding: false,
      executesBusinessWrite: false,
    };
  });
}

/** Explicit admin onboarding; never infer identity from a matching contact email. */
export function linkPortalProfile(ctx: JwtPayload, input: unknown) {
  ctx = actor(ctx);
  requirePermission(ctx, "admin:manage");
  const q = valid(
    z
      .object({
        profileType: z.enum(["owner", "tenant"]),
        profileId: z.string().min(1),
        userId: z.string().min(1).nullable(),
      })
      .strict(),
    input,
  );
  requirePermission(
    ctx,
    q.profileType === "owner" ? "owners:write" : "tenants:write",
  );
  const db = getDb(),
    table = q.profileType === "owner" ? "owners" : "tenants";
  return atomic(() => {
    const profile = db
      .prepare(
        `SELECT user_id FROM ${table} WHERE id=? AND organization_id=? AND deleted_at IS NULL`,
      )
      .get(q.profileId, ctx.organizationId);
    if (!profile)
      throw new HttpError(
        404,
        "PROFILE_NOT_FOUND",
        "Profile not found in your organization.",
      );
    if (
      q.userId &&
      !db
        .prepare(
          "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id WHERE u.id=? AND u.organization_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.deleted_at IS NULL AND r.slug=?",
        )
        .get(q.userId, ctx.organizationId, q.profileType)
    )
      throw new HttpError(
        403,
        "PROFILE_ROLE",
        "Link an active same-organization account with the matching personal role.",
      );
    db.prepare(
      `UPDATE ${table} SET user_id=?,updated_at=? WHERE id=? AND organization_id=?`,
    ).run(q.userId, nowIso(), q.profileId, ctx.organizationId);
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "portal.profile.linked",
      entityType: q.profileType,
      entityId: q.profileId,
      metadata: { previousUserId: profile.user_id, userId: q.userId },
    });
    return {
      linked: true,
      profileType: q.profileType,
      profileId: q.profileId,
      userId: q.userId,
    };
  });
}
