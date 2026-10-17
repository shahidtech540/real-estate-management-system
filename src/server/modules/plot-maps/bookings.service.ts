import {
  bookingInputSchema as bookingSchema,
  bookingTermsError,
} from "@/lib/plot-booking-validation";
import { createHash } from "node:crypto";
import { z } from "zod";
import type { JwtPayload } from "@/server/auth/crypto";
import { getDb } from "@/server/db";
import { HttpError, requirePermission } from "@/server/auth/guards";
import { atomic, newId, nowIso, valid, today } from "../shared/domain";
import { pdfResponse } from "../shared/pdf";
import { recordAuditLog } from "../audit/audit.service";
import { enqueue } from "../notifications/notifications.service";
import {
  createPlotTokenInvoice,
  plotInvoiceNumber,
  cancelPlotTokenInvoice,
} from "../billing/plot-invoices";
import { linkPlotBookingLead } from "../crm/plot-booking-leads";
import {
  saveBookingFile,
  validateBookingFiles,
} from "../documents/plot-booking-files";
import { bookingSchedule } from "@/lib/plot-booking";
import { access } from "./plot-maps.service";
const text = (n: number) => z.string().trim().max(n);
export { bookingInputSchema as bookingSchema } from "@/lib/plot-booking-validation";
const readPermissions = ["leads:read", "invoices:read", "documents:read"];
const writePermissions = ["leads:write", "invoices:write", "documents:write"];
function plotAccess(ctx: JwtPayload, id: string, write = false) {
  const row = getDb()
    .prepare(
      "SELECT project_id FROM plots WHERE organization_id=? AND id=? AND deleted_at IS NULL",
    )
    .get(ctx.organizationId, id);
  if (!row) throw new HttpError(404, "PLOT_NOT_FOUND", "Plot not found.");
  ctx = access(ctx, String(row.project_id));
  for (const p of [...readPermissions, ...(write ? writePermissions : [])])
    requirePermission(ctx, p);
  return ctx;
}
function currentPlot(org: string, id: string) {
  const p = getDb()
    .prepare(
      `SELECT p.*,r.name project_name,r.city project_city FROM plots p JOIN properties r ON r.id=p.project_id AND r.organization_id=p.organization_id AND r.deleted_at IS NULL JOIN project_maps m ON m.id=p.map_id AND m.organization_id=p.organization_id AND m.status='published' WHERE p.organization_id=? AND p.id=? AND p.deleted_at IS NULL AND EXISTS(SELECT 1 FROM map_plot_geometries g WHERE g.organization_id=p.organization_id AND g.map_id=p.map_id AND g.plot_id=p.id AND g.excluded=0)`,
    )
    .get(org, id);
  if (!p)
    throw new HttpError(
      409,
      "PLOT_UNPUBLISHED",
      "Plot is no longer on a published map. Refresh the map.",
    );
  return p;
}
export function bookingOptions(ctx: JwtPayload, plotId: string, query: string) {
  ctx = plotAccess(ctx, plotId);
  currentPlot(ctx.organizationId, plotId);
  const q = valid(text(100), query);
  return {
    clients:
      q.length < 2
        ? []
        : getDb()
            .prepare(
              "SELECT id,full_name name,phone FROM clients WHERE organization_id=? AND deleted_at IS NULL AND (instr(lower(full_name),lower(?))>0 OR instr(phone,?)>0) ORDER BY full_name,id LIMIT 30",
            )
            .all(ctx.organizationId, q, q),
    agents: getDb()
      .prepare(
        "SELECT u.id,u.full_name name FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id AND r.deleted_at IS NULL WHERE u.organization_id=? AND u.deleted_at IS NULL AND u.status='active' AND r.slug IN ('admin','agent') ORDER BY u.full_name,u.id LIMIT 200",
      )
      .all(ctx.organizationId),
    defaultAgentId: ctx.sub,
  };
}
export function plotDetails(ctx: JwtPayload, plotId: string) {
  ctx = plotAccess(ctx, plotId);
  const db = getDb(),
    p = currentPlot(ctx.organizationId, plotId);
  const bookings = db
    .prepare(
      `SELECT b.id,b.client_id,b.lead_id,b.agent_id,b.booking_type,b.request_key,b.token_amount_minor,b.price_minor,b.currency,b.booking_date,b.expiry_date,b.closed_at,b.status,b.notes,b.payment_plan,b.revision,b.created_at,c.full_name client_name,c.phone client_phone,c.email client_email,c.cnic client_cnic,c.address client_address,u.full_name agent_name FROM plot_bookings b LEFT JOIN clients c ON c.id=b.client_id AND c.organization_id=b.organization_id AND c.deleted_at IS NULL LEFT JOIN users u ON u.id=b.agent_id AND u.organization_id=b.organization_id AND u.deleted_at IS NULL WHERE b.organization_id=? AND b.plot_id=? ORDER BY b.created_at DESC,b.id DESC LIMIT 50`,
    )
    .all(ctx.organizationId, plotId)
    .map((b) => ({
      id: String(b.id),
      managed: b.request_key != null,
      client_id: b.client_id == null ? null : String(b.client_id),
      lead_id: b.lead_id == null ? null : String(b.lead_id),
      agent_id: b.agent_id == null ? null : String(b.agent_id),
      booking_type: b.booking_type == null ? null : String(b.booking_type),
      token_amount_minor: Number(b.token_amount_minor),
      price_minor: b.price_minor == null ? null : Number(b.price_minor),
      currency: String(b.currency),
      booking_date: String(b.booking_date),
      expiry_date: b.expiry_date == null ? null : String(b.expiry_date),
      closed_at: b.closed_at == null ? null : String(b.closed_at),
      status: String(b.status),
      notes: b.notes == null ? null : String(b.notes),
      revision: Number(b.revision),
      created_at: String(b.created_at),
      client_name: b.client_name == null ? null : String(b.client_name),
      client_phone: b.client_phone == null ? null : String(b.client_phone),
      client_email: b.client_email == null ? null : String(b.client_email),
      client_cnic: b.client_cnic == null ? null : String(b.client_cnic),
      client_address:
        b.client_address == null ? null : String(b.client_address),
      agent_name: b.agent_name == null ? null : String(b.agent_name),
      payment_plan: JSON.parse(String(b.payment_plan)),
      invoice:
        db
          .prepare(
            "SELECT id,invoice_number,amount_minor,currency,due_date,status FROM plot_token_invoices WHERE organization_id=? AND booking_id=?",
          )
          .get(ctx.organizationId, b.id) || null,
      files: db
        .prepare(
          "SELECT f.document_id id,f.kind,d.title name,d.mime_type mimeType,d.size_bytes size FROM plot_booking_files f JOIN documents d ON d.id=f.document_id AND d.organization_id=f.organization_id AND d.deleted_at IS NULL WHERE f.organization_id=? AND f.booking_id=? ORDER BY f.kind,f.document_id",
        )
        .all(ctx.organizationId, b.id),
    }));
  const active = db
    .prepare(
      "SELECT id FROM plot_bookings WHERE organization_id=? AND plot_id=? AND status IN ('pending','confirmed') AND closed_at IS NULL",
    )
    .get(ctx.organizationId, plotId);
  return {
    plot: {
      id: String(p.id),
      projectId: String(p.project_id),
      projectName: String(p.project_name),
      number: String(p.plot_number),
      status: String(p.status),
      mapId: String(p.map_id),
      priceMinor:
        p.total_price_minor == null ? null : Number(p.total_price_minor),
      currency: String(p.currency),
      block: p.block,
      phase: p.phase,
      areaOfficial: p.area_official,
      areaUnit: p.area_unit,
      dimensions: p.dimensions_official,
      facing: p.facing,
      corner: p.is_corner,
    },
    bookings,
    activeBookingId: active ? String(active.id) : null,
    canWrite: writePermissions.every((permission) =>
      ctx.permissions.includes(permission),
    ),
    activity: db
      .prepare(
        `SELECT a.id,a.action,a.entity_id,a.created_at,u.full_name actor,json_extract(a.metadata_json,'$.reason') reason FROM audit_logs a LEFT JOIN users u ON u.id=a.actor_user_id AND u.organization_id=a.organization_id WHERE a.organization_id=? AND ((a.entity_type='plot' AND a.entity_id=?) OR (a.entity_type='plot_booking' AND a.entity_id IN (SELECT id FROM plot_bookings WHERE organization_id=? AND plot_id=?))) ORDER BY a.created_at DESC,a.id DESC LIMIT 100`,
      )
      .all(ctx.organizationId, plotId, ctx.organizationId, plotId),
  };
}
function notify(
  ctx: JwtPayload,
  booking: string,
  agent: string,
  plot: string,
  event: string,
) {
  for (const id of new Set([ctx.sub, agent]))
    enqueue(
      ctx.organizationId,
      ctx.sub,
      id,
      "in_app",
      `Plot ${plot}: ${event}`,
      `Booking ${booking}. ${event}. Open the private plot page for details.`,
      `plot-booking:${booking}:${event}:${id}`,
    );
}
function assertAvailable(
  org: string,
  p: ReturnType<typeof currentPlot>,
  q: z.infer<typeof bookingSchema>,
) {
  if (
    p.status !== "available" ||
    getDb()
      .prepare(
        "SELECT id FROM plot_bookings WHERE organization_id=? AND plot_id=? AND status IN ('pending','confirmed') AND closed_at IS NULL",
      )
      .get(org, p.id)
  )
    throw new HttpError(
      409,
      "PLOT_JUST_BOOKED",
      "This plot was just booked or is no longer available. The map has been refreshed; choose another plot.",
    );
  if (
    getDb()
      .prepare(
        "SELECT id FROM plot_sales WHERE organization_id=? AND plot_id=? AND current_owner=1 UNION ALL SELECT id FROM resale_listings WHERE organization_id=? AND plot_id=? AND status='active' UNION ALL SELECT id FROM plot_ownership_history WHERE organization_id=? AND plot_id=? AND to_date IS NULL",
      )
      .get(org, p.id, org, p.id, org, p.id)
  )
    throw new HttpError(
      409,
      "PLOT_ENCUMBERED",
      "Plot has an active ownership/sale/resale record; reconcile its status first.",
    );
  if (
    p.map_id !== q.expectedMapId ||
    p.total_price_minor !== q.expectedPriceMinor ||
    p.currency !== q.currency
  )
    throw new HttpError(
      409,
      "PLOT_CHANGED",
      "The publication or price changed. Refresh and review the latest terms before booking.",
    );
}
export async function createBooking(
  ctx: JwtPayload,
  plotId: string,
  input: unknown,
) {
  ctx = plotAccess(ctx, plotId, true);
  const q = valid(bookingSchema, input),
    hash = createHash("sha256").update(JSON.stringify(q)).digest("hex"),
    db = getDb();
  const replay = () => {
    const b = db
      .prepare(
        "SELECT id,plot_id,input_hash FROM plot_bookings WHERE organization_id=? AND created_by=? AND request_key=?",
      )
      .get(ctx.organizationId, ctx.sub, q.requestKey);
    if (!b) return null;
    if (b.plot_id !== plotId || b.input_hash !== hash)
      throw new HttpError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "This request key already belongs to different booking terms.",
      );
    return {
      bookingId: String(b.id),
      replayed: true,
      ...plotDetails(ctx, plotId),
    };
  };
  const existing = replay();
  if (existing) return existing;
  const p = currentPlot(ctx.organizationId, plotId);
  assertAvailable(ctx.organizationId, p, q);
  const termError = bookingTermsError(q);
  if (termError) throw new HttpError(400, termError.code, termError.message);
  const schedule = bookingSchedule(
    q.expectedPriceMinor,
    q.tokenAmountMinor,
    q.bookingDate,
    q.paymentPlan,
  );
  const files = validateBookingFiles(q.files);
  function agent() {
    if (
      !db
        .prepare(
          "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id AND r.deleted_at IS NULL WHERE u.id=? AND u.organization_id=? AND u.status='active' AND u.deleted_at IS NULL AND r.slug IN ('agent','admin')",
        )
        .get(q.agentId, ctx.organizationId)
    )
      throw new HttpError(
        400,
        "INVALID_AGENT",
        "Select an active agent/admin from this organization.",
      );
  }
  agent();
  const client = q.clientId
    ? db
        .prepare(
          "SELECT * FROM clients WHERE organization_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(ctx.organizationId, q.clientId)
    : null;
  if (q.clientId && !client)
    throw new HttpError(
      404,
      "CLIENT_NOT_FOUND",
      "Client not found in your organization.",
    );
  const bookingId = newId("pbk"),
    clientName = String(client?.full_name || q.newClient!.fullName),
    terms = [
      `${db.prepare("SELECT name FROM organizations WHERE id=?").get(ctx.organizationId)!.name} | ${p.project_city}`,
      `Booking: ${bookingId}`,
      `Project: ${p.project_name}; Plot: ${p.plot_number}`,
      `Client: ${clientName}`,
      `Booking date (Asia/Karachi): ${q.bookingDate}`,
      `Type: ${q.bookingType}; hold expiry: ${q.expiryDate || "None"}`,
      `Catalogue total: ${q.currency} ${(q.expectedPriceMinor / 100).toFixed(2)}`,
      `Requested token: ${q.currency} ${(q.tokenAmountMinor / 100).toFixed(2)}. NOT proof of payment.`,
      ...schedule.map(
        (s) =>
          `${s.label}: ${q.currency} ${(s.amountMinor / 100).toFixed(2)} due ${s.dueDate}`,
      ),
      "Schedule is agreed booking terms, not proof of installment payment or legal ownership.",
      "Confirmation reflects issuance-time terms. Verify current booking state on the private plot page.",
    ];
  const pdfs = await Promise.all([
    pdfResponse("Plot booking confirmation", terms, `${bookingId}.pdf`),
    pdfResponse(
      "Plot token invoice",
      [
        `Invoice: ${plotInvoiceNumber(bookingId)}`,
        `Token amount due: ${q.currency} ${(q.tokenAmountMinor / 100).toFixed(2)}; payment received: 0.00`,
        ...terms.slice(0, 7),
        "Unpaid token request only. No payment, receipt, tax invoice, sale revenue or ledger posting is asserted.",
      ],
      `${bookingId}-invoice.pdf`,
    ),
  ]).then(async (r) =>
    Promise.all(r.map(async (x) => Buffer.from(await x.arrayBuffer()))),
  );
  return atomic(() => {
    ctx = plotAccess(ctx, plotId, true);
    const done = replay();
    if (done) return done;
    if (q.bookingDate !== today())
      throw new HttpError(
        409,
        "BOOKING_DATE_CHANGED",
        "Office date changed during submission; reopen and review.",
      );
    const fresh = currentPlot(ctx.organizationId, plotId);
    assertAvailable(ctx.organizationId, fresh, q);
    agent();
    if (q.bookingType === "reserve" && Date.parse(q.expiryDate!) <= Date.now())
      throw new HttpError(
        409,
        "HOLD_EXPIRY",
        "Hold expired before submission; choose a future expiry.",
      );
    if (client) {
      const current = db
        .prepare(
          "SELECT * FROM clients WHERE organization_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(ctx.organizationId, q.clientId!);
      if (JSON.stringify(current) !== JSON.stringify(client))
        throw new HttpError(
          409,
          "CLIENT_CHANGED",
          "Client changed during submission. Reopen and review the client.",
        );
    }
    const now = nowIso(),
      clientId = q.clientId || newId("cli");
    if (q.newClient) {
      const c = q.newClient;
      db.prepare(
        "INSERT INTO clients(id,organization_id,full_name,phone,cnic,email,address,client_type,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,'buyer',?,?,?)",
      ).run(
        clientId,
        ctx.organizationId,
        c.fullName,
        c.phone,
        c.cnic || null,
        c.email || null,
        c.address || null,
        now,
        now,
        ctx.sub,
      );
      recordAuditLog({
        organizationId: ctx.organizationId,
        actorUserId: ctx.sub,
        action: "crm.client.created",
        entityType: "client",
        entityId: clientId,
        metadata: { source: "plot_booking" },
      });
    }
    const leadId = linkPlotBookingLead(
      ctx,
      clientId,
      q.agentId,
      String(fresh.plot_number),
      q.expectedPriceMinor,
      q.currency,
    );
    db.prepare(
      `INSERT INTO plot_bookings(id,organization_id,plot_id,client_id,lead_id,agent_id,token_amount_minor,currency,payment_plan,booking_date,expiry_date,status,notes,created_at,updated_at,created_by,request_key,input_hash,booking_type,revision,price_minor,map_version_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,?,?)`,
    ).run(
      bookingId,
      ctx.organizationId,
      plotId,
      clientId,
      leadId,
      q.agentId,
      q.tokenAmountMinor,
      q.currency,
      JSON.stringify({ ...q.paymentPlan, schedule }),
      q.bookingDate,
      q.expiryDate,
      q.bookingType === "reserve" ? "pending" : "confirmed",
      q.notes,
      now,
      now,
      ctx.sub,
      q.requestKey,
      hash,
      q.bookingType,
      q.expectedPriceMinor,
      String(fresh.map_id),
    );
    const changed = db
      .prepare(
        "UPDATE plots SET status=?,status_changed_at=?,updated_at=? WHERE organization_id=? AND id=? AND status='available'",
      )
      .run(
        q.bookingType === "reserve" ? "reserved" : "booked",
        now,
        now,
        ctx.organizationId,
        plotId,
      );
    if (Number(changed.changes) !== 1)
      throw new HttpError(
        409,
        "PLOT_JUST_BOOKED",
        "This plot was just booked. Refresh the map.",
      );
    createPlotTokenInvoice(
      ctx.organizationId,
      ctx.sub,
      bookingId,
      q.tokenAmountMinor,
      q.currency,
      q.bookingDate,
    );
    saveBookingFile(
      ctx.organizationId,
      ctx.sub,
      bookingId,
      "confirmation",
      `${bookingId}-confirmation.pdf`,
      "application/pdf",
      pdfs[0],
    );
    saveBookingFile(
      ctx.organizationId,
      ctx.sub,
      bookingId,
      "invoice",
      `${bookingId}-token-invoice.pdf`,
      "application/pdf",
      pdfs[1],
    );
    for (const file of files)
      saveBookingFile(
        ctx.organizationId,
        ctx.sub,
        bookingId,
        file.category,
        file.name,
        file.mimeType,
        file.bytes,
      );
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "plot.booking.created",
      entityType: "plot_booking",
      entityId: bookingId,
      metadata: {
        plotId,
        bookingType: q.bookingType,
        clientId,
        leadId,
        agentId: q.agentId,
        priceMinor: q.expectedPriceMinor,
        tokenMinor: q.tokenAmountMinor,
        currency: q.currency,
      },
    });
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "plot.status.changed.by_staff",
      entityType: "plot",
      entityId: plotId,
      metadata: {
        from: "available",
        to: q.bookingType === "reserve" ? "reserved" : "booked",
        bookingId,
      },
    });
    notify(ctx, bookingId, q.agentId, String(fresh.plot_number), "created");
    return { bookingId, replayed: false, ...plotDetails(ctx, plotId) };
  });
}
export function changeBooking(ctx: JwtPayload, plotId: string, input: unknown) {
  ctx = plotAccess(ctx, plotId, true);
  const q = valid(
    z
      .object({
        bookingId: text(100).min(1),
        revision: z.number().int().nonnegative(),
        action: z.enum(["confirm", "cancel", "extend"]),
        expiryDate: z.string().datetime({ offset: true }).optional(),
        reason: text(500).min(3),
      })
      .strict(),
    input,
  );
  return atomic(() => {
    ctx = plotAccess(ctx, plotId, true);
    const db = getDb(),
      p = currentPlot(ctx.organizationId, plotId),
      b = db
        .prepare(
          "SELECT * FROM plot_bookings WHERE organization_id=? AND plot_id=? AND id=? AND status IN ('pending','confirmed') AND closed_at IS NULL",
        )
        .get(ctx.organizationId, plotId, q.bookingId);
    if (!b || b.revision !== q.revision)
      throw new HttpError(
        409,
        "STALE_BOOKING",
        "Booking changed or closed; reopen the latest details.",
      );
    if (b.request_key == null)
      throw new HttpError(
        409,
        "LEGACY_BOOKING",
        "Legacy booking is read-only until its billing and terms have been reconciled.",
      );
    if (p.status !== (b.status === "pending" ? "reserved" : "booked"))
      throw new HttpError(
        409,
        "PLOT_STATE_CHANGED",
        "Plot/booking states differ; reconcile before editing.",
      );
    if (
      db
        .prepare(
          "SELECT id FROM plot_sales WHERE organization_id=? AND plot_id=? AND current_owner=1 UNION ALL SELECT id FROM plot_ownership_history WHERE organization_id=? AND plot_id=? AND to_date IS NULL UNION ALL SELECT id FROM resale_listings WHERE organization_id=? AND plot_id=? AND status='active'",
        )
        .get(
          ctx.organizationId,
          plotId,
          ctx.organizationId,
          plotId,
          ctx.organizationId,
          plotId,
        )
    )
      throw new HttpError(
        409,
        "PLOT_ENCUMBERED",
        "Active ownership/sale/resale prevents booking changes.",
      );
    if (q.action !== "cancel" && b.status !== "pending")
      throw new HttpError(
        409,
        "BOOKING_CONFIRMED",
        "Only pending reservations can be confirmed or extended.",
      );
    if (
      q.action === "confirm" &&
      b.expiry_date &&
      Date.parse(String(b.expiry_date)) <= Date.now()
    )
      throw new HttpError(
        409,
        "HOLD_ELAPSED",
        "Hold elapsed. Cancel explicitly before making a fresh reservation. Automatic expiry is Phase E.",
      );
    if (
      q.action === "extend" &&
      (!q.expiryDate ||
        Date.parse(q.expiryDate) <=
          Math.max(Date.now(), Date.parse(String(b.expiry_date || 0))) ||
        Date.parse(q.expiryDate) > Date.now() + 90 * 86400000)
    )
      throw new HttpError(
        400,
        "HOLD_EXPIRY",
        "Extension must move expiry forward to a future time within 90 days.",
      );
    if (q.action !== "extend" && q.expiryDate)
      throw new HttpError(
        400,
        "INVALID_EXPIRY",
        "Expiry is only accepted for extension.",
      );
    const now = nowIso(),
      status =
        q.action === "cancel"
          ? "cancelled"
          : q.action === "confirm"
            ? "confirmed"
            : "pending";
    db.prepare(
      "UPDATE plot_bookings SET status=?,expiry_date=?,closed_at=?,revision=revision+1,updated_at=? WHERE organization_id=? AND id=? AND revision=?",
    ).run(
      status,
      q.action === "confirm"
        ? null
        : q.action === "extend"
          ? q.expiryDate!
          : b.expiry_date,
      q.action === "cancel" ? now : null,
      now,
      ctx.organizationId,
      b.id,
      q.revision,
    );
    if (q.action !== "extend") {
      const next = q.action === "cancel" ? "available" : "booked";
      db.prepare(
        "UPDATE plots SET status=?,status_changed_at=?,updated_at=? WHERE organization_id=? AND id=?",
      ).run(next, now, now, ctx.organizationId, plotId);
      recordAuditLog({
        organizationId: ctx.organizationId,
        actorUserId: ctx.sub,
        action: "plot.status.changed.by_staff",
        entityType: "plot",
        entityId: plotId,
        metadata: { from: p.status, to: next, bookingId: b.id },
      });
    }
    if (q.action === "cancel")
      cancelPlotTokenInvoice(ctx.organizationId, ctx.sub, String(b.id));
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: `plot.booking.${q.action}`,
      entityType: "plot_booking",
      entityId: String(b.id),
      metadata: {
        reason: q.reason,
        expiryDate: q.expiryDate || null,
        revision: q.revision + 1,
      },
    });
    const agent = db
      .prepare(
        "SELECT id FROM users WHERE organization_id=? AND id=? AND status='active' AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, b.agent_id || "");
    notify(
      ctx,
      String(b.id),
      agent ? String(agent.id) : ctx.sub,
      String(p.plot_number),
      `${q.action}:${q.revision + 1}`,
    );
    return plotDetails(ctx, plotId);
  });
}
export function bookingFile(ctx: JwtPayload, plotId: string, fileId: string) {
  ctx = plotAccess(ctx, plotId);
  const f = getDb()
    .prepare(
      `SELECT f.content,f.document_id,f.kind,d.mime_type,d.title FROM plot_booking_files f JOIN plot_bookings b ON b.id=f.booking_id AND b.organization_id=f.organization_id JOIN documents d ON d.id=f.document_id AND d.organization_id=f.organization_id AND d.deleted_at IS NULL WHERE f.organization_id=? AND b.plot_id=? AND f.document_id=?`,
    )
    .get(ctx.organizationId, plotId, fileId);
  if (!f)
    throw new HttpError(404, "FILE_NOT_FOUND", "Booking document not found.");
  recordAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.sub,
    action: "document.downloaded",
    entityType: "document",
    entityId: fileId,
    metadata: { plotId, kind: f.kind },
  });
  return {
    bytes: Buffer.from(f.content as Uint8Array),
    mimeType: String(f.mime_type),
    name: String(f.title),
  };
}
