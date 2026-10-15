import { postWorkOrderInternal } from "../accounting/posting";
import { z } from "zod";
import { getDb } from "@/server/db";
import type { JwtPayload } from "@/server/auth/crypto";
import { HttpError, requirePermission } from "@/server/auth/guards";
import {
  atomic,
  newId,
  nowIso,
  today,
  valid,
  moneySchema,
} from "../shared/domain";
import { assertReadable } from "../shared/access";
import { recordAuditLog } from "../audit/audit.service";
import { notifyMaintenance } from "../notifications/notifications.service";

export const categories = [
  "plumbing",
  "electrical",
  "hvac",
  "structural",
  "cleaning",
  "general",
] as const;
export const priorities = ["low", "medium", "high", "emergency"] as const;
export const slaHours = { low: 72, medium: 24, high: 4, emergency: 1 };
export interface Ticket {
  id: string;
  property_id: string;
  unit_id: string;
  tenant_id: string | null;
  ticket_number: string;
  title: string;
  description: string;
  category: string;
  priority: keyof typeof slaHours;
  status: string;
  sla_due_at: string;
  photos_json: string;
  created_at: string;
  confirmed_at: string | null;
  resolution_notes: string | null;
  rating: number | null;
}
export interface Vendor {
  id: string;
  name: string;
  trade_category: string;
  phone: string;
  email: string | null;
  rating: number;
  base_rate_minor: number;
  sla_hours: number;
  available: number;
  completed_jobs: number;
}
export interface WorkOrder {
  id: string;
  ticket_id: string;
  vendor_id: string;
  vendor_name: string;
  work_order_number: string;
  status: string;
  estimated_cost_minor: number;
  actual_cost_minor: number;
  scheduled_at: string;
  completed_at: string | null;
  completion_notes: string | null;
}
export interface Schedule {
  id: string;
  unit_id: string;
  title: string;
  category: string;
  interval_days: number;
  next_due_at: string;
  active: number;
}
export interface TicketDetail {
  ticket: Ticket;
  orders: WorkOrder[];
  events: {
    id: string;
    type: string;
    note: string;
    created_at: string;
    created_by: string;
  }[];
}
export interface Board {
  tickets: Ticket[];
  total: number;
  page: number;
  limit: number;
  units: { id: string; unit_number: string; property_name: string }[];
  vendors: Vendor[];
  schedules: Schedule[];
}
const text = z.string().trim().min(1).max(2000);
const timestamp = z
  .string()
  .datetime()
  .transform((s) => new Date(s).toISOString());
const photo = z
  .string()
  .max(1400000)
  .refine((s) => {
    const match = s.match(
      /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/,
    );
    if (!match) return false;
    const b = Buffer.from(match[2], "base64");
    if (b.length > 1024 * 1024 || b.toString("base64") !== match[2])
      return false;
    return match[1] === "jpeg"
      ? b[0] === 255 && b[1] === 216 && b[2] === 255
      : match[1] === "png"
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : b.toString("ascii", 0, 4) === "RIFF" &&
          b.toString("ascii", 8, 12) === "WEBP";
  }, "Use JPEG, PNG or WebP photos, at most 1MB each.");
const ticketInput = z
  .object({
    unitId: z.string().min(1),
    title: z.string().trim().min(3).max(160),
    description: text,
    category: z.enum(categories),
    priority: z.enum(priorities).default("medium"),
    photos: z.array(photo).max(5).default([]),
  })
  .strict();
const vendorInput = z
  .object({
    name: z.string().trim().min(2).max(120),
    tradeCategory: z.enum(categories),
    phone: z.string().regex(/^\+?[0-9 ()-]{7,25}$/),
    email: z.string().email().max(180).optional(),
    baseRateMinor: moneySchema,
    slaHours: z.number().int().min(1).max(720).default(24),
    available: z.boolean().default(true),
  })
  .strict();
const err = (code: string, message: string, status = 409): never => {
  throw new HttpError(status, code, message);
};
function audit(ctx: JwtPayload, type: string, id: string, note: string) {
  recordAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.sub,
    action: `maintenance.${type}`,
    entityType: "maintenance",
    entityId: id,
    metadata: { note },
  });
}
function event(
  ctx: JwtPayload,
  ticket: Ticket,
  type: string,
  note: string,
  key?: string,
) {
  const id = newId("mev");
  const sequence = Number(
    getDb()
      .prepare(
        "SELECT COALESCE(MAX(sequence),0)+1 AS n FROM maintenance_events WHERE organization_id=? AND ticket_id=?",
      )
      .get(ctx.organizationId, ticket.id)!.n,
  );
  getDb()
    .prepare(
      "INSERT INTO maintenance_events (id,organization_id,ticket_id,type,note,sequence,event_key,created_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      ctx.organizationId,
      ticket.id,
      type,
      note,
      sequence,
      key || null,
      nowIso(),
      ctx.sub,
    );
  audit(ctx, type, ticket.id, note);
  notifyMaintenance(ctx.organizationId, ctx.sub, ticket, type, note, key || id);
}
export function getTicket(ctx: JwtPayload, id: string): Ticket {
  requirePermission(ctx, "maintenance:read");
  const row = getDb()
    .prepare(
      "SELECT * FROM maintenance_tickets WHERE organization_id=? AND id=? AND deleted_at IS NULL",
    )
    .get(ctx.organizationId, id) as unknown as Ticket | undefined;
  if (!row) return err("NOT_FOUND", "Ticket not found.", 404);
  assertReadable(ctx, row.property_id, row.tenant_id || undefined);
  return row;
}
export function ticketDetail(ctx: JwtPayload, id: string): TicketDetail {
  const ticket = getTicket(ctx, id);
  const orders = getDb()
    .prepare(
      `SELECT w.*,v.name AS vendor_name FROM work_orders w JOIN vendors v ON v.id=w.vendor_id AND v.organization_id=w.organization_id WHERE w.organization_id=? AND w.ticket_id=? AND w.deleted_at IS NULL ORDER BY w.created_at,w.id`,
    )
    .all(ctx.organizationId, id) as unknown as WorkOrder[];
  const events = getDb()
    .prepare(
      "SELECT id,type,note,created_at,created_by FROM maintenance_events WHERE organization_id=? AND ticket_id=? ORDER BY sequence",
    )
    .all(ctx.organizationId, id) as unknown as TicketDetail["events"];
  return { ticket, orders, events };
}
export function listVendors(ctx: JwtPayload): Vendor[] {
  requirePermission(ctx, "vendors:manage");
  return getDb()
    .prepare(
      `SELECT v.*,(SELECT COUNT(*) FROM work_orders w WHERE w.vendor_id=v.id AND w.organization_id=v.organization_id AND w.status='completed' AND w.deleted_at IS NULL) AS completed_jobs FROM vendors v WHERE organization_id=? AND deleted_at IS NULL ORDER BY available DESC,rating DESC,name LIMIT 500`,
    )
    .all(ctx.organizationId) as unknown as Vendor[];
}
export function saveVendor(ctx: JwtPayload, input: unknown, id?: string) {
  requirePermission(ctx, "vendors:manage");
  const b = valid(vendorInput, input);
  return atomic(() => {
    const vid = id || newId("ven");
    const now = nowIso();
    if (id) {
      const row = getDb()
        .prepare(
          "SELECT id FROM vendors WHERE organization_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(ctx.organizationId, id);
      if (!row) return err("NOT_FOUND", "Vendor not found.", 404);
      getDb()
        .prepare(
          "UPDATE vendors SET name=?,trade_category=?,phone=?,email=?,base_rate_minor=?,sla_hours=?,available=?,updated_at=? WHERE organization_id=? AND id=?",
        )
        .run(
          b.name,
          b.tradeCategory,
          b.phone,
          b.email || null,
          b.baseRateMinor,
          b.slaHours,
          Number(b.available),
          now,
          ctx.organizationId,
          id,
        );
    } else
      getDb()
        .prepare(
          "INSERT INTO vendors (id,organization_id,name,trade_category,phone,email,rating,base_rate_minor,sla_hours,available,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,0,?,?,?,?,?,?)",
        )
        .run(
          vid,
          ctx.organizationId,
          b.name,
          b.tradeCategory,
          b.phone,
          b.email || null,
          b.baseRateMinor,
          b.slaHours,
          Number(b.available),
          now,
          now,
          ctx.sub,
        );
    audit(ctx, "vendor_saved", vid, b.name);
    return listVendors(ctx).find((v) => v.id === vid)!;
  });
}
function unitForCreation(ctx: JwtPayload, id: string) {
  const unit = getDb()
    .prepare(
      "SELECT u.id,u.property_id FROM units u JOIN properties p ON p.id=u.property_id AND p.organization_id=u.organization_id WHERE u.organization_id=? AND u.id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL",
    )
    .get(ctx.organizationId, id);
  if (!unit) return err("NOT_FOUND", "Unit not found.", 404);
  const leases = getDb()
    .prepare(
      `SELECT l.tenant_id,t.user_id FROM leases l JOIN tenants t ON t.id=l.tenant_id AND t.organization_id=l.organization_id
    WHERE l.organization_id=? AND l.unit_id=? AND l.status IN ('active','expiring','renewed') AND l.deleted_at IS NULL AND t.deleted_at IS NULL AND l.start_date<=? AND l.end_date>=?
    ORDER BY l.start_date DESC`,
    )
    .all(ctx.organizationId, id, today(), today());
  const lease =
    ctx.roleSlug === "tenant"
      ? leases.find((l) => l.user_id === ctx.sub)
      : leases[0];
  if (ctx.roleSlug === "tenant" && !lease)
    return err("NOT_FOUND", "No current lease for this unit.", 404);
  return {
    propertyId: String(unit.property_id),
    tenantId: lease?.tenant_id ? String(lease.tenant_id) : null,
  };
}
function insertTicket(
  ctx: JwtPayload,
  b: z.infer<typeof ticketInput>,
  reference = nowIso(),
): Ticket {
  const unit = unitForCreation(ctx, b.unitId);
  const id = newId("mt");
  const due = new Date(
    Date.parse(reference) + slaHours[b.priority] * 3600000,
  ).toISOString();
  getDb()
    .prepare(
      `INSERT INTO maintenance_tickets (id,organization_id,property_id,unit_id,tenant_id,ticket_number,title,description,category,priority,status,sla_due_at,photos_json,created_at,updated_at,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,'open',?,?,?,?,?)`,
    )
    .run(
      id,
      ctx.organizationId,
      unit.propertyId,
      b.unitId,
      unit.tenantId,
      `MT-${id.slice(3, 15).toUpperCase()}`,
      b.title,
      b.description,
      b.category,
      b.priority,
      due,
      JSON.stringify(b.photos),
      reference,
      reference,
      ctx.sub,
    );
  const ticket = getTicket(ctx, id);
  event(
    ctx,
    ticket,
    "opened",
    b.priority === "emergency"
      ? "Emergency reported. Contact local emergency services immediately if there is danger to life."
      : "Issue submitted for triage.",
  );
  return ticket;
}
export function createTicket(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "maintenance:create");
  const b = valid(ticketInput, input);
  return atomic(() => insertTicket(ctx, b));
}
export function maintenanceBoard(ctx: JwtPayload, input: unknown): Board {
  requirePermission(ctx, "maintenance:read");
  const q = valid(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      status: z
        .enum([
          "open",
          "triaged",
          "scheduled",
          "in_progress",
          "completed",
          "closed",
          "cancelled",
        ])
        .optional(),
      search: z.string().max(160).optional(),
    }),
    input,
  );
  let where = "t.organization_id=? AND t.deleted_at IS NULL";
  const args: (string | number)[] = [ctx.organizationId];
  if (ctx.roleSlug === "tenant") {
    where +=
      " AND t.tenant_id IN (SELECT id FROM tenants WHERE organization_id=? AND user_id=? AND deleted_at IS NULL)";
    args.push(ctx.organizationId, ctx.sub);
  }
  if (ctx.roleSlug === "owner") {
    where +=
      " AND t.property_id IN (SELECT po.property_id FROM property_owners po JOIN owners o ON o.id=po.owner_id WHERE o.organization_id=? AND o.user_id=? AND o.deleted_at IS NULL AND po.deleted_at IS NULL AND po.organization_id=o.organization_id)";
    args.push(ctx.organizationId, ctx.sub);
  }
  if (q.status) {
    where += " AND t.status=?";
    args.push(q.status);
  }
  if (q.search) {
    where += " AND (t.title LIKE ? OR t.ticket_number LIKE ?)";
    args.push(`%${q.search}%`, `%${q.search}%`);
  }
  const total = Number(
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM maintenance_tickets t WHERE ${where}`)
      .get(...args)!.n,
  );
  const tickets = getDb()
    .prepare(
      `SELECT t.id,t.property_id,t.unit_id,t.tenant_id,t.ticket_number,t.title,t.description,t.category,t.priority,t.status,t.sla_due_at,'[]' AS photos_json,t.created_at,t.confirmed_at,t.resolution_notes,t.rating FROM maintenance_tickets t WHERE ${where} ORDER BY CASE t.priority WHEN 'emergency' THEN 0 WHEN 'high' THEN 1 ELSE 2 END,t.created_at DESC,t.id LIMIT ? OFFSET ?`,
    )
    .all(...args, q.limit, (q.page - 1) * q.limit) as unknown as Ticket[];
  let unitWhere =
    "u.organization_id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL";
  const unitArgs: string[] = [ctx.organizationId];
  if (ctx.roleSlug === "tenant") {
    unitWhere +=
      " AND u.id IN (SELECT l.unit_id FROM leases l JOIN tenants t ON t.id=l.tenant_id WHERE l.organization_id=? AND t.user_id=? AND l.status IN ('active','expiring','renewed') AND l.deleted_at IS NULL AND t.deleted_at IS NULL AND l.start_date<=? AND l.end_date>=?)";
    unitArgs.push(ctx.organizationId, ctx.sub, today(), today());
  }
  if (ctx.roleSlug === "owner") {
    unitWhere +=
      " AND u.property_id IN (SELECT po.property_id FROM property_owners po JOIN owners o ON o.id=po.owner_id WHERE o.organization_id=? AND o.user_id=? AND o.deleted_at IS NULL AND po.deleted_at IS NULL AND po.organization_id=o.organization_id)";
    unitArgs.push(ctx.organizationId, ctx.sub);
  }
  const units = getDb()
    .prepare(
      `SELECT u.id,u.unit_number,p.name AS property_name FROM units u JOIN properties p ON p.id=u.property_id AND p.organization_id=u.organization_id WHERE ${unitWhere} ORDER BY p.name,u.unit_number LIMIT 500`,
    )
    .all(...unitArgs) as unknown as Board["units"];
  const manager = ctx.permissions.includes("maintenance:triage");
  return {
    tickets,
    total,
    page: q.page,
    limit: q.limit,
    units,
    vendors: ctx.permissions.includes("vendors:manage") ? listVendors(ctx) : [],
    schedules: manager
      ? (getDb()
          .prepare(
            "SELECT * FROM preventive_schedules WHERE organization_id=? AND deleted_at IS NULL ORDER BY next_due_at LIMIT 500",
          )
          .all(ctx.organizationId) as unknown as Schedule[])
      : [],
  };
}
export function triageTicket(ctx: JwtPayload, id: string, input: unknown) {
  requirePermission(ctx, "maintenance:triage");
  const b = valid(
    z
      .object({
        category: z.enum(categories),
        priority: z.enum(priorities),
        note: text,
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const ticket = getTicket(ctx, id);
    if (!["open", "triaged"].includes(ticket.status))
      return err(
        "INVALID_TRANSITION",
        "Only open or triaged tickets can be triaged.",
      );
    const due = new Date(
      Date.parse(ticket.created_at) + slaHours[b.priority] * 3600000,
    ).toISOString();
    getDb()
      .prepare(
        "UPDATE maintenance_tickets SET status='triaged',category=?,priority=?,sla_due_at=?,updated_at=? WHERE id=? AND organization_id=?",
      )
      .run(b.category, b.priority, due, nowIso(), id, ctx.organizationId);
    event(ctx, ticket, "triaged", b.note);
    return getTicket(ctx, id);
  });
}
export function assignWorkOrder(ctx: JwtPayload, id: string, input: unknown) {
  requirePermission(ctx, "maintenance:triage");
  const b = valid(
    z
      .object({
        vendorId: z.string().min(1),
        scheduledAt: timestamp,
        estimatedCostMinor: moneySchema,
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const ticket = getTicket(ctx, id);
    if (ticket.status !== "triaged")
      return err(
        "INVALID_TRANSITION",
        "Triage the ticket before assigning a vendor.",
      );
    if (Date.parse(b.scheduledAt) < Date.now() - 300000)
      return err("PAST_SCHEDULE", "Schedule must not be in the past.", 400);
    const vendor = getDb()
      .prepare(
        "SELECT * FROM vendors WHERE organization_id=? AND id=? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, b.vendorId);
    if (!vendor) return err("NOT_FOUND", "Vendor not found.", 404);
    if (!vendor.available)
      return err("VENDOR_UNAVAILABLE", "Vendor is unavailable.");
    if (
      vendor.trade_category !== ticket.category &&
      vendor.trade_category !== "general"
    )
      return err(
        "TRADE_MISMATCH",
        "Choose a vendor with the ticket's trade category.",
        400,
      );
    if (
      getDb()
        .prepare(
          "SELECT id FROM work_orders WHERE organization_id=? AND ticket_id=? AND status IN ('scheduled','in_progress') AND deleted_at IS NULL",
        )
        .get(ctx.organizationId, id)
    )
      return err("ACTIVE_WORK_ORDER", "An active work order already exists.");
    const wid = newId("wo"),
      now = nowIso();
    getDb()
      .prepare(
        "INSERT INTO work_orders (id,organization_id,ticket_id,vendor_id,work_order_number,status,estimated_cost_minor,scheduled_at,created_at,updated_at,created_by) VALUES (?,?,?,?,?,'scheduled',?,?,?,?,?)",
      )
      .run(
        wid,
        ctx.organizationId,
        id,
        b.vendorId,
        `WO-${wid.slice(3, 15).toUpperCase()}`,
        b.estimatedCostMinor,
        b.scheduledAt,
        now,
        now,
        ctx.sub,
      );
    getDb()
      .prepare(
        "UPDATE maintenance_tickets SET status='scheduled',updated_at=? WHERE id=? AND organization_id=?",
      )
      .run(now, id, ctx.organizationId);
    event(ctx, ticket, "scheduled", `${vendor.name}: ${b.scheduledAt}`);
    return ticketDetail(ctx, id);
  });
}
export function updateWorkOrder(ctx: JwtPayload, id: string, input: unknown) {
  requirePermission(ctx, "maintenance:triage");
  const b = valid(
    z
      .object({
        workOrderId: z.string().min(1),
        status: z.enum(["in_progress", "completed", "cancelled"]),
        actualCostMinor: moneySchema.optional(),
        note: text,
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const ticket = getTicket(ctx, id);
    const order = getDb()
      .prepare(
        "SELECT * FROM work_orders WHERE organization_id=? AND id=? AND ticket_id=? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, b.workOrderId, id) as unknown as
      WorkOrder | undefined;
    if (!order) return err("NOT_FOUND", "Work order not found.", 404);
    const allowed =
      b.status === "in_progress"
        ? order.status === "scheduled"
        : b.status === "completed"
          ? order.status === "in_progress"
          : ["scheduled", "in_progress"].includes(order.status);
    if (!allowed)
      return err(
        "INVALID_TRANSITION",
        "Invalid work-order transition; completed costs are immutable.",
      );
    if (b.status === "completed" && b.actualCostMinor === undefined)
      return err("COST_REQUIRED", "Enter the final actual cost in paisa.", 400);
    const now = nowIso();
    getDb()
      .prepare(
        "UPDATE work_orders SET status=?,actual_cost_minor=?,completion_notes=?,completed_at=?,updated_at=? WHERE id=? AND organization_id=?",
      )
      .run(
        b.status,
        b.status === "completed" ? b.actualCostMinor! : 0,
        b.note,
        b.status === "completed" ? now : null,
        now,
        order.id,
        ctx.organizationId,
      );
    getDb()
      .prepare(
        "UPDATE maintenance_tickets SET status=?,updated_at=? WHERE id=? AND organization_id=?",
      )
      .run(
        b.status === "cancelled" ? "triaged" : b.status,
        now,
        id,
        ctx.organizationId,
      );
    event(ctx, ticket, b.status, b.note);
    if(b.status === "completed") postWorkOrderInternal(ctx.organizationId,ctx.sub,b.workOrderId);
    return ticketDetail(ctx, id);
  });
}
export function confirmTicket(ctx: JwtPayload, id: string, input: unknown) {
  const b = valid(
    z
      .object({
        accepted: z.boolean(),
        rating: z.number().int().min(1).max(5).optional(),
        note: text,
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const ticket = getTicket(ctx, id);
    const linked = !!getDb()
      .prepare(
        "SELECT id FROM tenants WHERE organization_id=? AND id=? AND user_id=? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, ticket.tenant_id, ctx.sub);
    if (!linked) {
      requirePermission(ctx, "admin:manage");
      if (b.note.length < 10)
        return err(
          "REASON_REQUIRED",
          "Administrative closure needs an explanatory note of at least 10 characters.",
          400,
        );
    }
    if (ticket.status !== "completed")
      return err(
        "INVALID_TRANSITION",
        "Only completed tickets await confirmation.",
      );
    if (b.accepted && linked && b.rating === undefined)
      return err(
        "RATING_REQUIRED",
        "Rate the completed work from 1 to 5.",
        400,
      );
    const now = nowIso();
    getDb()
      .prepare(
        "UPDATE maintenance_tickets SET status=?,confirmed_at=?,rating=?,resolution_notes=?,updated_at=? WHERE id=? AND organization_id=?",
      )
      .run(
        b.accepted ? "closed" : "triaged",
        b.accepted ? now : null,
        b.accepted && linked ? b.rating! : null,
        b.note,
        now,
        id,
        ctx.organizationId,
      );
    if (b.accepted && linked && b.rating) {
      const order = getDb()
        .prepare(
          "SELECT vendor_id FROM work_orders WHERE organization_id=? AND ticket_id=? AND status='completed' AND deleted_at IS NULL ORDER BY completed_at DESC,id DESC LIMIT 1",
        )
        .get(ctx.organizationId, id)!;
      getDb()
        .prepare(
          "INSERT INTO vendor_reviews (id,organization_id,vendor_id,ticket_id,rating,note,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?)",
        )
        .run(
          newId("vr"),
          ctx.organizationId,
          order.vendor_id,
          id,
          b.rating,
          b.note,
          now,
          now,
          ctx.sub,
        );
      getDb()
        .prepare(
          "UPDATE vendors SET rating=(SELECT AVG(rating) FROM vendor_reviews WHERE organization_id=? AND vendor_id=?),updated_at=? WHERE id=? AND organization_id=?",
        )
        .run(
          ctx.organizationId,
          order.vendor_id,
          now,
          order.vendor_id,
          ctx.organizationId,
        );
    }
    event(
      ctx,
      ticket,
      b.accepted ? (linked ? "tenant_confirmed" : "admin_closed") : "reopened",
      b.note,
    );
    return ticketDetail(ctx, id);
  });
}
export function saveSchedule(ctx: JwtPayload, input: unknown, id?: string) {
  requirePermission(ctx, "maintenance:triage");
  const b = valid(
    z
      .object({
        unitId: z.string().min(1),
        title: z.string().trim().min(3).max(160),
        category: z.enum(categories),
        intervalDays: z.number().int().min(1).max(366),
        nextDueAt: timestamp,
        active: z.boolean().default(true),
      })
      .strict(),
    input,
  );
  return atomic(() => {
    unitForCreation(ctx, b.unitId);
    const sid = id || newId("ps"),
      now = nowIso();
    if (id) {
      if (
        !getDb()
          .prepare(
            "SELECT id FROM preventive_schedules WHERE id=? AND organization_id=? AND deleted_at IS NULL",
          )
          .get(id, ctx.organizationId)
      )
        return err("NOT_FOUND", "Schedule not found.", 404);
      getDb()
        .prepare(
          "UPDATE preventive_schedules SET unit_id=?,title=?,category=?,interval_days=?,next_due_at=?,active=?,updated_at=? WHERE id=? AND organization_id=?",
        )
        .run(
          b.unitId,
          b.title,
          b.category,
          b.intervalDays,
          b.nextDueAt,
          Number(b.active),
          now,
          id,
          ctx.organizationId,
        );
    } else
      getDb()
        .prepare(
          "INSERT INTO preventive_schedules (id,organization_id,unit_id,title,category,interval_days,next_due_at,active,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          sid,
          ctx.organizationId,
          b.unitId,
          b.title,
          b.category,
          b.intervalDays,
          b.nextDueAt,
          Number(b.active),
          now,
          now,
          ctx.sub,
        );
    audit(ctx, "schedule_saved", sid, b.title);
    return { id: sid };
  });
}
/** Idempotent scan, safe for cron or an explicit human-triggered run. */
export function runMaintenanceCycle(ctx: JwtPayload, reference = nowIso()) {
  requirePermission(ctx, "maintenance:triage");
  const when = valid(timestamp, reference);
  return atomic(() => {
    let generated = 0,
      escalated = 0;
    const schedules = getDb()
      .prepare(
        "SELECT * FROM preventive_schedules WHERE organization_id=? AND active=1 AND deleted_at IS NULL AND next_due_at<=? ORDER BY next_due_at LIMIT 100",
      )
      .all(ctx.organizationId, when) as unknown as Schedule[];
    for (const schedule of schedules) {
      if (
        !getDb()
          .prepare(
            "SELECT id FROM preventive_runs WHERE organization_id=? AND schedule_id=? AND due_at=?",
          )
          .get(ctx.organizationId, schedule.id, schedule.next_due_at)
      ) {
        const ticket = insertTicket(
          ctx,
          {
            unitId: schedule.unit_id,
            title: schedule.title,
            description: `Preventive maintenance due: ${schedule.next_due_at}`,
            category: schedule.category as (typeof categories)[number],
            priority: "medium",
            photos: [],
          },
          when,
        );
        getDb()
          .prepare(
            "INSERT INTO preventive_runs (id,organization_id,schedule_id,due_at,ticket_id,created_at,created_by) VALUES (?,?,?,?,?,?,?)",
          )
          .run(
            newId("pr"),
            ctx.organizationId,
            schedule.id,
            schedule.next_due_at,
            ticket.id,
            when,
            ctx.sub,
          );
        generated++;
      }
      // Coalesce missed intervals into one ticket; preserve cadence and advance beyond now.
      const interval = schedule.interval_days * 86400000;
      const due = Date.parse(schedule.next_due_at);
      const next = new Date(
        due + (Math.floor((Date.parse(when) - due) / interval) + 1) * interval,
      ).toISOString();
      getDb()
        .prepare(
          "UPDATE preventive_schedules SET next_due_at=?,updated_at=? WHERE id=? AND organization_id=?",
        )
        .run(next, when, schedule.id, ctx.organizationId);
    }
    const overdue = getDb()
      .prepare(
        `SELECT * FROM maintenance_tickets WHERE organization_id=? AND deleted_at IS NULL AND status IN ('open','triaged','scheduled','in_progress') AND sla_due_at<=?
      AND NOT EXISTS (SELECT 1 FROM maintenance_events e WHERE e.organization_id=maintenance_tickets.organization_id AND e.ticket_id=maintenance_tickets.id AND e.type='sla_breached' AND e.event_key='sla:'||maintenance_tickets.id||':'||maintenance_tickets.sla_due_at)
      ORDER BY sla_due_at LIMIT 500`,
      )
      .all(ctx.organizationId, when) as unknown as Ticket[];
    for (const ticket of overdue) {
      const key = `sla:${ticket.id}:${ticket.sla_due_at}`;
      if (
        getDb()
          .prepare(
            "SELECT id FROM maintenance_events WHERE organization_id=? AND ticket_id=? AND type='sla_breached' AND event_key=?",
          )
          .get(ctx.organizationId, ticket.id, key)
      )
        continue;
      event(
        ctx,
        ticket,
        "sla_breached",
        `SLA deadline exceeded at ${ticket.sla_due_at}. Coordinator action required.`,
        key,
      );
      escalated++;
    }
    return { generated, escalated, reference: when };
  });
}

export function vendorHistory(ctx: JwtPayload, id: string, input: unknown) {
  requirePermission(ctx, "vendors:manage");
  const q = valid(
    z.object({
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
    }),
    input,
  );
  if (
    !getDb()
      .prepare(
        "SELECT id FROM vendors WHERE organization_id=? AND id=? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, id)
  )
    return err("NOT_FOUND", "Vendor not found.", 404);
  const total = Number(
    getDb()
      .prepare(
        "SELECT COUNT(*) AS n FROM work_orders WHERE organization_id=? AND vendor_id=? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, id)!.n,
  );
  const items = getDb()
    .prepare(
      `SELECT w.*,t.title FROM work_orders w JOIN maintenance_tickets t ON t.id=w.ticket_id AND t.organization_id=w.organization_id WHERE w.organization_id=? AND w.vendor_id=? AND w.deleted_at IS NULL ORDER BY w.created_at DESC,w.id LIMIT ? OFFSET ?`,
    )
    .all(ctx.organizationId, id, q.limit, (q.page - 1) * q.limit);
  return { items, total, page: q.page, limit: q.limit };
}
