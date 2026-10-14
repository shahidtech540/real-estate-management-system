import { HttpError, requirePermission } from "@/server/auth/guards";
import type { JwtPayload } from "@/server/auth/crypto";
import { getDb } from "@/server/db";
import { sumMinor } from "../accounting/reports.service";
import { atomic, newId, nowIso, today, valid } from "../shared/domain";
import { recordAuditLog } from "../audit/audit.service";
import { createListing } from "../listings/listings.service";
import { updateLeadStageOrActivity, scheduleViewing } from "../crm/crm.service";
import { triageTicket } from "../maintenance/maintenance.service";
import { enqueue } from "../notifications/notifications.service";
import { actionSchemas, type ActionName } from "./contracts";
import { getEntity, safeText, futureSlot, type Row } from "./safety";
import { classifyMaintenance, escalatedRent } from "./rules";
export function listingCopy(
  unit: Row,
  property: Row,
  purpose: string,
  price: number,
) {
  const amount = `PKR ${(price / 100).toFixed(2)}`,
    project = safeText(property.name, 80),
    number = safeText(unit.unit_number, 40),
    city = safeText(property.city, 60);
  const area = Number(unit.area_sqft),
    beds = Number(unit.bedrooms);
  return {
    titleEn: `${project} — unit ${number} for ${purpose}`,
    titleUr: `${project} — یونٹ ${number} ${purpose === "sale" ? "فروخت" : "کرائے"} کے لیے`,
    descriptionEn: `${safeText(unit.type, 30)} · ${area} sq ft · ${beds} bedrooms. ${city}. Stored asking ${purpose === "rent" ? "monthly rent" : "price"}: ${amount}. Inventory, ownership, amenities and approvals require independent verification. No legal approval or guaranteed return is asserted.`,
    descriptionUr: `${safeText(unit.type, 30)} · ${area} مربع فٹ · ${beds} بیڈروم۔ ${city}۔ درج ${purpose === "rent" ? "ماہانہ کرایہ" : "قیمت"}: ${amount}۔ انوینٹری، ملکیت، سہولیات اور قانونی حیثیت کی الگ تصدیق ضروری ہے۔ قانونی منظوری یا منافع کی گارنٹی نہیں دی جا رہی۔`,
  };
}
export function actionSnapshot(
  ctx: JwtPayload,
  name: string,
  input: unknown,
): unknown {
  const b = input as Row,
    db = getDb(),
    org = ctx.organizationId;
  if (name === "crm.qualify") return getEntity(ctx, "leads", String(b.leadId));
  if (name === "crm.viewing")
    return {
      lead: getEntity(ctx, "leads", String(b.leadId)),
      unit: getEntity(ctx, "units", String(b.unitId)),
      agent:
        db
          .prepare(
            "SELECT id,status,role_id,deleted_at FROM users WHERE organization_id=? AND id=?",
          )
          .get(org, String(b.agentId)) || null,
      conflicts: db
        .prepare(
          "SELECT id,scheduled_at FROM viewings WHERE organization_id=? AND deleted_at IS NULL AND status='scheduled' AND (unit_id=? OR agent_id=?) ORDER BY id",
        )
        .all(org, String(b.unitId), String(b.agentId)),
    };
  if (name === "listings.draft") {
    const unit = getEntity(ctx, "units", String(b.unitId)),
      property = db
        .prepare(
          "SELECT id,name,city,updated_at FROM properties WHERE organization_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(org, String(unit.property_id));
    if (!property) throw new HttpError(404, "NOT_FOUND", "Project not found.");
    return {
      unit,
      property,
      drafts: db
        .prepare(
          "SELECT id,status FROM listings WHERE organization_id=? AND unit_id=? AND purpose=? AND status='draft' AND deleted_at IS NULL ORDER BY id",
        )
        .all(org, unit.id as string, String(b.purpose)),
      copy: listingCopy(
        unit,
        property,
        String(b.purpose),
        Number(b.askingPriceMinor),
      ),
    };
  }
  if (name === "rent.reminder") {
    const invoice = getEntity(ctx, "invoices", String(b.invoiceId));
    return {
      invoice,
      payments: db
        .prepare(
          "SELECT id,amount_minor,status,updated_at FROM payments WHERE organization_id=? AND invoice_id=? AND deleted_at IS NULL ORDER BY id",
        )
        .all(org, String(b.invoiceId)),
      tenant:
        db
          .prepare(
            "SELECT id,user_id FROM tenants WHERE organization_id=? AND id=? AND deleted_at IS NULL",
          )
          .get(org, String(invoice.tenant_id)) || null,
    };
  }
  if (name === "maintenance.assign")
    return {
      ticket:
        db
          .prepare(
            "SELECT id,property_id,status,category,priority,title,description,sla_due_at,updated_at FROM maintenance_tickets WHERE organization_id=? AND id=? AND deleted_at IS NULL",
          )
          .get(org, String(b.ticketId)) || null,
      vendor:
        db
          .prepare(
            "SELECT id,available,trade_category,base_rate_minor,rating,sla_hours,updated_at FROM vendors WHERE organization_id=? AND id=? AND deleted_at IS NULL",
          )
          .get(org, String(b.vendorId)) || null,
    };
  if (name === "maintenance.triage")
    return getEntity(ctx, "maintenance_tickets", String(b.ticketId));
  if (name === "leases.offer")
    return getEntity(ctx, "leases", String(b.leaseId));
  return null;
}
export const ACTION_PERMISSIONS: Record<ActionName, string> = {
  "crm.qualify": "leads:write",
  "crm.viewing": "viewings:manage",
  "listings.draft": "listings:write",
  "rent.reminder": "invoices:write",
  "maintenance.triage": "maintenance:triage",
  "leases.offer": "leases:write",
};
export function executeAction(
  ctx: JwtPayload,
  name: ActionName,
  input: unknown,
) {
  requirePermission(ctx, ACTION_PERMISSIONS[name]);
  return atomic(() => {
    const db = getDb(),
      org = ctx.organizationId;
    if (name === "crm.qualify") {
      const b = valid(actionSchemas[name], input),
        lead = getEntity(ctx, "leads", b.leadId);
      if (!["new", "contacted"].includes(String(lead.stage)))
        throw new HttpError(
          409,
          "LEAD_STAGE",
          "Closed or later-stage leads cannot be requalified.",
        );
      return updateLeadStageOrActivity(org, ctx.sub, b.leadId, {
        stage: b.stage,
        noteText: b.note,
      });
    }
    if (name === "crm.viewing") {
      const b = valid(actionSchemas[name], input);
      futureSlot(b.scheduledAt);
      const unit = getEntity(ctx, "units", b.unitId),
        lead = getEntity(ctx, "leads", b.leadId);
      if (
        unit.status !== "available" ||
        ["won", "lost"].includes(String(lead.stage))
      )
        throw new HttpError(
          409,
          "UNAVAILABLE",
          "Viewing requires an available unit and open lead.",
        );
      if (
        !db
          .prepare(
            "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id WHERE u.organization_id=? AND u.id=? AND u.status='active' AND u.deleted_at IS NULL AND r.slug='agent'",
          )
          .get(org, b.agentId)
      )
        throw new HttpError(
          404,
          "NOT_FOUND",
          "Assigned sales agent not found.",
        );
      const conflict = db
        .prepare(
          "SELECT id FROM viewings WHERE organization_id=? AND deleted_at IS NULL AND status='scheduled' AND (unit_id=? OR agent_id=?) AND ABS((julianday(scheduled_at)-julianday(?))*1440)<30",
        )
        .get(org, b.unitId, b.agentId, b.scheduledAt);
      if (conflict)
        throw new HttpError(
          409,
          "VIEWING_CONFLICT",
          "Unit/agent already has a viewing within 30 minutes.",
        );
      return scheduleViewing(org, ctx.sub, b);
    }
    if (name === "listings.draft") {
      const b = valid(actionSchemas[name], input),
        snapshot = actionSnapshot(ctx, name, b) as {
          unit: Row;
          property: Row;
          drafts: Row[];
          copy: ReturnType<typeof listingCopy>;
        };
      if (snapshot.unit.status !== "available")
        throw new HttpError(
          409,
          "UNAVAILABLE",
          "Only available units can receive agent drafts.",
        );
      if (snapshot.drafts.length)
        throw new HttpError(
          409,
          "DRAFT_EXISTS",
          "A draft already exists for this unit and purpose.",
        );
      return createListing(org, ctx.sub, {
        propertyId: String(snapshot.unit.property_id),
        unitId: b.unitId,
        ...snapshot.copy,
        purpose: b.purpose,
        askingPriceMinor: b.askingPriceMinor,
        status: "draft",
        syndicatePortals: false,
      });
    }
    if (name === "rent.reminder") {
      const b = valid(actionSchemas[name], input),
        invoice = getEntity(ctx, "invoices", b.invoiceId),
        outstanding = Number(invoice.total_minor) - Number(invoice.paid_minor);
      const receipts = sumMinor(
        db
          .prepare(
            "SELECT amount_minor FROM payments WHERE organization_id=? AND invoice_id=? AND deleted_at IS NULL AND status='completed'",
          )
          .all(org, b.invoiceId)
          .map((p) => Number(p.amount_minor)),
      );
      if (receipts > Number(invoice.paid_minor))
        throw new HttpError(
          409,
          "SOURCE_MISMATCH",
          "Reconcile invoice/receipt evidence before reminding the tenant.",
        );
      if (outstanding <= 0 || invoice.status === "cancelled")
        throw new HttpError(
          409,
          "NO_ARREARS",
          "Settled/void invoices cannot receive a reminder.",
        );
      const tenant = db
        .prepare(
          "SELECT u.id FROM tenants t JOIN users u ON u.id=t.user_id AND u.organization_id=t.organization_id WHERE t.organization_id=? AND t.id=? AND t.deleted_at IS NULL AND u.status='active' AND u.deleted_at IS NULL",
        )
        .get(org, String(invoice.tenant_id));
      if (!tenant)
        throw new HttpError(
          404,
          "NO_RECIPIENT",
          "No active linked tenant inbox. No external message was sent.",
        );
      const body = `Invoice ${safeText(invoice.invoice_number)}: recorded outstanding PKR ${(outstanding / 100).toFixed(2)}, due ${invoice.due_date}. Please contact the office if a verified payment is missing. This is a courtesy reminder, not a legal notice.\nبل ${safeText(invoice.invoice_number)}: درج بقایا ${(outstanding / 100).toFixed(2)} پاکستانی روپے، آخری تاریخ ${invoice.due_date}۔ تصدیق شدہ ادائیگی درج نہ ہو تو دفتر سے رابطہ کریں۔ یہ یاددہانی ہے، قانونی نوٹس نہیں۔`;
      const id = enqueue(
        org,
        ctx.sub,
        String(tenant.id),
        "in_app",
        `${safeText(db.prepare("SELECT name FROM organizations WHERE id=?").get(org)!.name)} — invoice reminder`,
        body,
        `agent-rent:${b.invoiceId}:${today()}:${outstanding}`,
      );
      return {
        id,
        channel: "in_app",
        status: "delivered",
        externalMessageSent: false,
      };
    }
    if (name === "maintenance.triage") {
      const b = valid(actionSchemas[name], input),
        ticket = getEntity(ctx, "maintenance_tickets", b.ticketId),
        risk = classifyMaintenance(
          `${ticket.title} ${ticket.description}`,
          String(ticket.priority),
        );
      const ranks = ["low", "medium", "high", "emergency"];
      if (ranks.indexOf(b.priority) < ranks.indexOf(risk.priority))
        throw new HttpError(
          409,
          "UNSAFE_DOWNGRADE",
          "Agent triage cannot reduce the local safety rule minimum.",
        );
      return triageTicket(ctx, b.ticketId, {
        category: b.category,
        priority: b.priority,
        note: b.note,
      });
    }
    const b = valid(actionSchemas["leases.offer"], input),
      lease = getEntity(ctx, "leases", b.leaseId);
    const remaining = Math.floor(
      (Date.parse(String(lease.end_date)) - Date.parse(today())) / 86400000,
    );
    if (
      remaining < 0 ||
      remaining > 90 ||
      !["active", "expiring", "renewed"].includes(String(lease.status)) ||
      b.newEndDate <= String(lease.end_date)
    )
      throw new HttpError(
        409,
        "INVALID_OFFER",
        "Offer needs an ongoing lease and later end date.",
      );
    const expected = escalatedRent(
      Number(lease.rent_minor),
      Number(lease.escalation_pct),
    );
    if (b.offeredRentMinor !== expected)
      throw new HttpError(
        409,
        "OFFER_TERMS",
        "Offer rent must match the recorded escalation rule.",
      );
    const id = newId("artifact"),
      reference = `offer:${lease.id}:${b.newEndDate}:${b.offeredRentMinor}`;
    const previous = db
      .prepare(
        "SELECT id FROM agent_artifacts WHERE organization_id=? AND reference=?",
      )
      .get(org, reference);
    if (previous)
      return { id: String(previous.id), binding: false, status: "draft" };
    const content = {
      leaseId: lease.id,
      currentEndDate: lease.end_date,
      proposedEndDate: b.newEndDate,
      offeredRentMinor: b.offeredRentMinor,
      escalationPct: lease.escalation_pct,
      notice:
        "Unsigned, nonbinding proposal. Existing lease and invoice records are unchanged.",
      noticeUr:
        "غیر دستخط شدہ، غیر پابند تجویز۔ موجودہ معاہدہ اور بل تبدیل نہیں ہوئے۔",
    };
    db.prepare(
      "INSERT INTO agent_artifacts (id,organization_id,kind,entity_id,reference,content_json,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)",
    ).run(
      id,
      org,
      "lease_offer",
      b.leaseId,
      reference,
      JSON.stringify(content),
      nowIso(),
      ctx.sub,
    );
    recordAuditLog({
      organizationId: org,
      actorUserId: ctx.sub,
      action: "agents.lease_offer_drafted",
      entityType: "agent_artifact",
      entityId: id,
      metadata: { leaseId: b.leaseId, binding: false },
    });
    return { id, binding: false, status: "draft", content };
  });
}
