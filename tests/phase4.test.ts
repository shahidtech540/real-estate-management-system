import { beforeEach, describe, expect, it, vi } from "vitest";
import { createRequire } from "node:module";
import { SCHEMA_DDL } from "@/server/db/schema";
import { seedDatabase } from "@/server/db/seed";
import { generateOwnerStatements } from "@/server/modules/billing/billing.service";
import { NextRequest } from "next/server";
import { getDb, resetDbForTesting } from "@/server/db";
import { migratePhase4, seedPhase4 } from "@/server/db/phase4";
import { loginWithPassword } from "@/server/modules/auth/auth.service";
import { verifyAccessToken, type JwtPayload } from "@/server/auth/crypto";
import * as m from "@/server/modules/maintenance/maintenance.service";
import * as n from "@/server/modules/notifications/notifications.service";
import * as tickets from "@/app/api/v1/maintenance/tickets/route";
import * as details from "@/app/api/v1/maintenance/tickets/[id]/route";
import * as vendors from "@/app/api/v1/maintenance/vendors/route";
import * as schedules from "@/app/api/v1/maintenance/schedules/route";
import * as cycle from "@/app/api/v1/maintenance/cycle/route";
import * as notifications from "@/app/api/v1/notifications/route";
import * as dispatch from "@/app/api/v1/notifications/dispatch/route";
import * as templates from "@/app/api/v1/notifications/templates/route";
const org = "org_pakland";
let admin: JwtPayload,
  tenant: JwtPayload,
  staff: JwtPayload,
  owner: JwtPayload,
  indus: JwtPayload,
  agent: JwtPayload;
function context(email: string) {
  return verifyAccessToken(
    loginWithPassword({ email, password: "Password123!" }).accessToken!,
  )!;
}
function token(ctx: JwtPayload) {
  return loginWithPassword({ email: ctx.email, password: "Password123!" })
    .accessToken;
}
function req(
  path: string,
  method = "GET",
  body?: unknown,
  ctx: JwtPayload = admin,
) {
  return new NextRequest(`http://localhost:3000/api/v1/${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token(ctx)}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}
const issue = {
  unitId: "unit_1",
  title: "Kitchen drain blocked",
  description: "Water accumulates in the sink.",
  category: "plumbing",
  priority: "high",
};
const vendor = {
  name: "Verified plumber",
  tradeCategory: "plumbing",
  phone: "+923001234567",
  baseRateMinor: 300000,
};
function opened() {
  return m.createTicket(tenant, issue);
}
function assigned() {
  const t = opened();
  m.triageTicket(staff, t.id, {
    category: "plumbing",
    priority: "high",
    note: "Inspect the drain joint",
  });
  return m.assignWorkOrder(staff, t.id, {
    vendorId: "ven_plumber",
    scheduledAt: new Date(Date.now() + 3600000).toISOString(),
    estimatedCostMinor: 300000,
  });
}
function completed() {
  const d = assigned(),
    workOrderId = d.orders[0].id;
  m.updateWorkOrder(staff, d.ticket.id, {
    workOrderId,
    status: "in_progress",
    note: "On site",
  });
  return m.updateWorkOrder(staff, d.ticket.id, {
    workOrderId,
    status: "completed",
    actualCostMinor: 280000,
    note: "Joint repaired and tested",
  });
}
beforeEach(() => {
  vi.unstubAllEnvs();
  const db = resetDbForTesting();
  for (const table of [
    "vendor_reviews",
    "maintenance_events",
    "work_orders",
    "preventive_runs",
    "preventive_schedules",
    "maintenance_tickets",
    "notifications",
    "notification_templates",
  ])
    db.exec(`DELETE FROM ${table}`);
  admin = context("admin@pakland.pk");
  tenant = context("tenant@pakland.pk");
  staff = context("maintenance@pakland.pk");
  owner = context("owner@pakland.pk");
  indus = context("admin@indusvalley.pk");
  agent = context("agent@pakland.pk");
});
describe("Phase 4 maintenance", () => {
  it("adds Phase 4 to an existing Phase 3 schema without changing portfolio or rent data", () => {
    const { DatabaseSync } = createRequire(import.meta.url)(
      "node:sqlite",
    ) as typeof import("node:sqlite");
    const old = new DatabaseSync(":memory:");
    old.exec(SCHEMA_DDL);
    seedDatabase(old);
    const before = old
      .prepare("SELECT * FROM invoices ORDER BY id")
      .all();
    expect(
      old
        .prepare("PRAGMA table_info(vendors)")
        .all()
        .some((c) => c.name === "available"),
    ).toBe(false);
    migratePhase4(old);
    seedPhase4(old);
    migratePhase4(old);
    seedPhase4(old);
    expect(
      old
        .prepare(
          "SELECT * FROM invoices ORDER BY id",
        )
        .all(),
    ).toEqual(before);
    expect(
      old.prepare("SELECT COUNT(*) AS n FROM maintenance_tickets").get()!.n,
    ).toBe(1);
    old.close();
  });
  it("uses completed actual maintenance costs in owner statements, not estimates", () => {
    const d = completed();
    const period = new Date().toISOString().slice(0, 7);
    const statement = generateOwnerStatements(org, admin.sub, period).find(
      (s) => s.ownerId === "own_1",
    )!;
    expect(statement.expensesMinor).toBe(Math.round(280000 * 0.7));
    expect(
      statement.lineItems.find((l) => l.propertyId === d.ticket.property_id)!
        .ownerShareExpensesMinor,
    ).toBe(196000);
  });

  it("migrates and seeds idempotently without resetting existing data", () => {
    const t = opened();
    migratePhase4(getDb());
    seedPhase4(getDb());
    expect(m.getTicket(tenant, t.id).title).toBe(issue.title);
    expect(getDb().prepare("SELECT COUNT(*) AS n FROM vendors").get()!.n).toBe(
      3,
    );
  });
  it("runs tenant ticket → staff triage → assignment → cost → tenant confirmation", () => {
    const d = completed();
    expect(d.ticket.status).toBe("completed");
    expect(d.orders[0].actual_cost_minor).toBe(280000);
    const closed = m.confirmTicket(tenant, d.ticket.id, {
      accepted: true,
      rating: 5,
      note: "Working correctly",
    });
    expect(closed.ticket.status).toBe("closed");
    expect(closed.ticket.confirmed_at).toBeTruthy();
    expect(
      m.listVendors(staff).find((v) => v.id === "ven_plumber")!.rating,
    ).toBe(5);
    expect(closed.events.map((e) => e.type)).toEqual([
      "opened",
      "triaged",
      "scheduled",
      "in_progress",
      "completed",
      "tenant_confirmed",
    ]);
    expect(n.listNotifications(tenant, {}).total).toBe(6);
    expect(m.vendorHistory(staff, "ven_plumber", {}).total).toBe(1);
  });
  it("uses priority SLA from original creation, not triage time", () => {
    const t = opened();
    expect(Date.parse(t.sla_due_at) - Date.parse(t.created_at)).toBe(
      4 * 3600000,
    );
    const triaged = m.triageTicket(staff, t.id, {
      category: "plumbing",
      priority: "emergency",
      note: "Flooding escalating",
    });
    expect(Date.parse(triaged.sla_due_at) - Date.parse(t.created_at)).toBe(
      3600000,
    );
  });
  it("enforces tenant current-unit and same-organization scope", () => {
    expect(() =>
      m.createTicket(tenant, { ...issue, unitId: "unit_2" }),
    ).toThrow("No current lease");
    expect(() => m.createTicket(indus, issue)).toThrow("Unit not found");
    const t = opened();
    expect(() => m.getTicket(indus, t.id)).toThrow("Ticket not found");
    expect(m.maintenanceBoard(indus, {}).tickets).toHaveLength(0);
    expect(() => m.createTicket(owner, issue)).toThrow("required permission");
  });
  it("scopes owners to owned properties and tenants to their profile", () => {
    const own = opened();
    const other = m.createTicket(admin, { ...issue, unitId: "unit_4" });
    expect(m.maintenanceBoard(tenant, {}).tickets.map((t) => t.id)).toEqual([
      own.id,
    ]);
    expect(() => m.getTicket(tenant, other.id)).toThrow("Record not found");
    getDb()
      .prepare(
        "DELETE FROM property_owners WHERE owner_id IN (SELECT id FROM owners WHERE user_id=?)",
      )
      .run(owner.sub);
    expect(m.maintenanceBoard(owner, {}).tickets).toHaveLength(0);
    expect(() => m.getTicket(owner, own.id)).toThrow("Record not found");
  });
  it("validates photos, money, categories and bounded pagination", () => {
    for (const bad of [
      { priority: "urgent" },
      { category: "gas" },
      { photos: ["https://evil.invalid/x"] },
      { photos: ["data:image/png;base64,PHN2Zz4="] },
      { photos: Array(6).fill("bad") },
    ])
      expect(() => m.createTicket(tenant, { ...issue, ...bad })).toThrow();
    expect(() =>
      m.saveVendor(staff, { ...vendor, baseRateMinor: -1 }),
    ).toThrow();
    expect(() =>
      m.saveVendor(staff, { ...vendor, baseRateMinor: 0.5 }),
    ).toThrow();
    expect(() => m.maintenanceBoard(staff, { limit: 1000 })).toThrow();
    expect(() => m.maintenanceBoard(staff, { page: 0 })).toThrow();
  });
  it("accepts private raster photos and omits payloads from ticket lists", () => {
    const image =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
    const t = m.createTicket(tenant, { ...issue, photos: [image] });
    expect(JSON.parse(t.photos_json)).toEqual([image]);
    expect(m.maintenanceBoard(tenant, {}).tickets[0].photos_json).toBe("[]");
  });
  it("blocks invalid lifecycle transitions and cross-ticket work orders", () => {
    const t = opened();
    expect(() => m.assignWorkOrder(staff, t.id, {})).toThrow();
    expect(() =>
      m.confirmTicket(tenant, t.id, {
        accepted: true,
        rating: 4,
        note: "Done",
      }),
    ).toThrow("Only completed");
    const d = assigned();
    expect(() =>
      m.updateWorkOrder(staff, t.id, {
        workOrderId: d.orders[0].id,
        status: "in_progress",
        note: "Start",
      }),
    ).toThrow("Work order not found");
    expect(() =>
      m.updateWorkOrder(staff, d.ticket.id, {
        workOrderId: d.orders[0].id,
        status: "completed",
        note: "Done",
        actualCostMinor: 10,
      }),
    ).toThrow("Invalid work-order");
    expect(() =>
      m.assignWorkOrder(staff, d.ticket.id, {
        vendorId: "ven_plumber",
        scheduledAt: new Date().toISOString(),
        estimatedCostMinor: 0,
      }),
    ).toThrow("Triage");
  });
  it("rejects wrong-trade, unavailable, foreign or past-dated assignments atomically", () => {
    const t = opened();
    m.triageTicket(staff, t.id, {
      category: "plumbing",
      priority: "medium",
      note: "Inspect",
    });
    const base = {
      scheduledAt: new Date(Date.now() + 3600000).toISOString(),
      estimatedCostMinor: 100,
    };
    expect(() =>
      m.assignWorkOrder(staff, t.id, { ...base, vendorId: "ven_electric" }),
    ).toThrow("trade category");
    expect(() =>
      m.assignWorkOrder(staff, t.id, { ...base, vendorId: "foreign" }),
    ).toThrow("Vendor not found");
    getDb()
      .prepare("UPDATE vendors SET available=0 WHERE id='ven_plumber'")
      .run();
    expect(() =>
      m.assignWorkOrder(staff, t.id, { ...base, vendorId: "ven_plumber" }),
    ).toThrow("unavailable");
    expect(() =>
      m.assignWorkOrder(staff, t.id, {
        ...base,
        vendorId: "ven_electric",
        scheduledAt: "2020-01-01T00:00:00.000Z",
      }),
    ).toThrow("past");
    expect(m.getTicket(staff, t.id).status).toBe("triaged");
    expect(m.ticketDetail(staff, t.id).orders).toHaveLength(0);
  });
  it("requires final costs and keeps completed costs immutable", () => {
    const d = assigned(),
      workOrderId = d.orders[0].id;
    m.updateWorkOrder(staff, d.ticket.id, {
      workOrderId,
      status: "in_progress",
      note: "Started",
    });
    expect(() =>
      m.updateWorkOrder(staff, d.ticket.id, {
        workOrderId,
        status: "completed",
        note: "Fixed",
      }),
    ).toThrow("final actual cost");
    m.updateWorkOrder(staff, d.ticket.id, {
      workOrderId,
      status: "completed",
      note: "Fixed",
      actualCostMinor: 0,
    });
    expect(() =>
      m.updateWorkOrder(staff, d.ticket.id, {
        workOrderId,
        status: "cancelled",
        note: "Undo",
      }),
    ).toThrow("immutable");
  });
  it("cancels an active order back to triage and allows reassignment", () => {
    const d = assigned();
    m.updateWorkOrder(staff, d.ticket.id, {
      workOrderId: d.orders[0].id,
      status: "cancelled",
      note: "Vendor unable to attend",
    });
    expect(m.getTicket(tenant, d.ticket.id).status).toBe("triaged");
    expect(
      m.assignWorkOrder(staff, d.ticket.id, {
        vendorId: "ven_plumber",
        scheduledAt: new Date(Date.now() + 3600000).toISOString(),
        estimatedCostMinor: 0,
      }).orders,
    ).toHaveLength(2);
  });
  it("allows tenant reopening without erasing cost history; coordinator cannot impersonate confirmation", () => {
    const d = completed();
    expect(() =>
      m.confirmTicket(staff, d.ticket.id, {
        accepted: true,
        rating: 5,
        note: "Fixed",
      }),
    ).toThrow("admin:manage");
    expect(() =>
      m.confirmTicket(tenant, d.ticket.id, { accepted: true, note: "Fixed" }),
    ).toThrow("Rate");
    expect(
      m.confirmTicket(tenant, d.ticket.id, {
        accepted: false,
        note: "Still leaking",
      }).ticket.status,
    ).toBe("triaged");
    expect(
      m.ticketDetail(tenant, d.ticket.id).orders[0].actual_cost_minor,
    ).toBe(280000);
  });
  it("audits explicit administrator closure and rejects repeat confirmation", () => {
    const d = completed();
    expect(() =>
      m.confirmTicket(admin, d.ticket.id, { accepted: true, note: "OK" }),
    ).toThrow("explanatory note");
    const result = m.confirmTicket(admin, d.ticket.id, {
      accepted: true,
      note: "Tenant confirmed via office telephone.",
    });
    expect(result.events.at(-1)!.type).toBe("admin_closed");
    expect(result.ticket.rating).toBeNull();
    expect(() =>
      m.confirmTicket(tenant, d.ticket.id, {
        accepted: true,
        rating: 5,
        note: "OK",
      }),
    ).toThrow("Only completed");
  });
  it("escalates an SLA once, across repeated cycles, and stops after completion", () => {
    const t = opened();
    const ref = new Date(Date.parse(t.sla_due_at) + 1000).toISOString();
    expect(m.runMaintenanceCycle(staff, ref).escalated).toBe(1);
    const count = n.listNotifications(admin, {}).total;
    expect(m.runMaintenanceCycle(staff, ref).escalated).toBe(0);
    expect(n.listNotifications(admin, {}).total).toBe(count);
    expect(
      m
        .ticketDetail(staff, t.id)
        .events.filter((e) => e.type === "sla_breached"),
    ).toHaveLength(1);
    const d = completed();
    m.runMaintenanceCycle(
      staff,
      new Date(Date.now() + 10 * 86400000).toISOString(),
    );
    expect(
      m
        .ticketDetail(staff, d.ticket.id)
        .events.some((e) => e.type === "sla_breached"),
    ).toBe(false);
  });
  it("generates preventive tickets once, advances missed intervals, supports pause/update", () => {
    const due = "2026-01-01T00:00:00.000Z";
    const s = m.saveSchedule(staff, {
      unitId: "unit_1",
      title: "Generator service",
      category: "electrical",
      intervalDays: 90,
      nextDueAt: due,
    });
    const ref = new Date().toISOString();
    expect(m.runMaintenanceCycle(staff, ref).generated).toBe(1);
    expect(m.runMaintenanceCycle(staff, ref).generated).toBe(0);
    const saved = m.maintenanceBoard(staff, {}).schedules[0];
    expect(saved.next_due_at > ref).toBe(true);
    m.saveSchedule(
      staff,
      {
        unitId: "unit_1",
        title: "Generator service",
        category: "electrical",
        intervalDays: 90,
        nextDueAt: due,
        active: false,
      },
      s.id,
    );
    expect(m.runMaintenanceCycle(staff, ref).generated).toBe(0);
    expect(() =>
      m.saveSchedule(
        indus,
        {
          unitId: "unit_1",
          title: "Bad schedule",
          category: "electrical",
          intervalDays: 90,
          nextDueAt: due,
        },
        s.id,
      ),
    ).toThrow();
  });
  it("creates/updates vendors, bounds history and denies unauthorized directory access", () => {
    const v = m.saveVendor(staff, vendor);
    expect(v.rating).toBe(0);
    expect(v.available).toBe(1);
    expect(
      m.saveVendor(staff, { ...vendor, available: false }, v.id).available,
    ).toBe(0);
    expect(m.vendorHistory(staff, v.id, {}).total).toBe(0);
    expect(() => m.listVendors(tenant)).toThrow("vendors:manage");
    expect(() => m.saveVendor(indus, vendor, v.id)).toThrow("not found");
    expect(() => m.vendorHistory(indus, v.id, {})).toThrow("not found");
    expect(() =>
      m.saveSchedule(staff, {
        unitId: "unit_1",
        title: "Schedule",
        category: "hvac",
        intervalDays: 0,
        nextDueAt: new Date().toISOString(),
      }),
    ).toThrow();
  });
  it("paginates and filters ticket lists", () => {
    for (let i = 0; i < 4; i++) opened();
    const first = m.maintenanceBoard(staff, {
      page: 1,
      limit: 2,
      search: "Kitchen",
      status: "open",
    });
    const second = m.maintenanceBoard(staff, { page: 2, limit: 2 });
    expect(first.total).toBe(4);
    expect(first.tickets).toHaveLength(2);
    expect(second.tickets.map((t) => t.id)).not.toEqual(
      first.tickets.map((t) => t.id),
    );
  });
});
describe("Phase 4 notification delivery", () => {
  const message = () => ({
    userId: tenant.sub,
    channel: "email",
    subject: "Repair scheduled",
    body: "Please arrange access.",
    consent: true,
    requestKey: "unique-request-001",
  });
  it("requires external-contact consent, recipient scoping and administrator permission", () => {
    expect(() =>
      n.composeNotification(admin, { ...message(), consent: false }),
    ).toThrow("permission to contact");
    expect(() => n.composeNotification(staff, message())).toThrow(
      "admin:manage",
    );
    expect(() => n.composeNotification(indus, message())).toThrow(
      "Recipient not found",
    );
    expect(() => n.listNotifications(tenant, { outbox: true })).toThrow(
      "admin:manage",
    );
  });
  it("queues idempotently, rejects changed payload and never resends processed messages", async () => {
    const a = n.composeNotification(admin, message());
    expect(n.composeNotification(admin, message()).id).toBe(a.id);
    expect(() =>
      n.composeNotification(admin, { ...message(), subject: "Different" }),
    ).toThrow("different message");
    expect(await n.dispatchNotifications(org)).toEqual({
      delivered: 1,
      failed: 0,
    });
    expect(n.listNotifications(admin, { outbox: true }).items[0].status).toBe(
      "mock_sent",
    );
    expect(await n.dispatchNotifications(org)).toEqual({
      delivered: 0,
      failed: 0,
    });
  });
  it("delivers in-app immediately and only recipient can mark read", () => {
    const a = n.composeNotification(admin, {
      ...message(),
      channel: "in_app",
      consent: false,
    });
    expect(n.listNotifications(tenant, {}).items[0].status).toBe("delivered");
    expect(() => n.markRead(admin, a.id)).toThrow("not found");
    expect(n.markRead(tenant, a.id).read).toBe(true);
    expect(n.markRead(tenant, a.id).read).toBe(true);
    expect(n.listNotifications(tenant, {}).items[0].read_at).toBeTruthy();
  });
  it("fails closed in live mode instead of claiming real delivery", async () => {
    vi.stubEnv("NOTIFICATION_PROVIDER_MODE", "live");
    n.composeNotification(admin, message());
    expect(await n.dispatchNotifications(org)).toEqual({
      delivered: 0,
      failed: 1,
    });
    const item = n.listNotifications(admin, { outbox: true }).items[0];
    expect(item.status).toBe("failed");
    expect(item.last_error).toContain("No message was sent");
    expect(item.provider_id).toBeNull();
  });
  it("retries with backoff, dead-letters at five attempts and supports audited manual retry", async () => {
    const a = n.composeNotification(admin, message());
    const adapter: n.NotificationAdapter = {
      send: async () => {
        throw new Error("Provider unavailable");
      },
    };
    let reference = Date.now();
    for (let i = 1; i <= 5; i++) {
      const when = new Date(reference).toISOString();
      expect((await n.dispatchNotifications(org, adapter, when)).failed).toBe(
        1,
      );
      const item = n.listNotifications(admin, { outbox: true }).items[0];
      expect(item.attempt_count).toBe(i);
      expect(item.status).toBe(i === 5 ? "dead_letter" : "failed");
      expect((await n.dispatchNotifications(org, adapter, when)).failed).toBe(
        0,
      );
      reference = Date.parse(item.next_attempt_at!) + 1;
    }
    n.retryNotification(admin, a.id);
    expect((await n.dispatchNotifications(org)).delivered).toBe(1);
    expect(() => n.retryNotification(admin, a.id)).toThrow("not retryable");
  });
  it("recovers stale processing leases, does not claim a fresh in-flight notification", async () => {
    const a = n.composeNotification(admin, message());
    getDb()
      .prepare(
        "UPDATE notifications SET status='processing',locked_at=? WHERE id=?",
      )
      .run(new Date().toISOString(), a.id);
    expect((await n.dispatchNotifications(org)).delivered).toBe(0);
    getDb()
      .prepare(
        "UPDATE notifications SET locked_at='2000-01-01T00:00:00.000Z' WHERE id=?",
      )
      .run(a.id);
    expect((await n.dispatchNotifications(org)).delivered).toBe(1);
  });
  it("supports genuine adapter receipts and safe email/SMS/WhatsApp mock channels", async () => {
    for (const channel of ["email", "sms", "whatsapp"])
      n.composeNotification(admin, {
        ...message(),
        channel,
        requestKey: `channel-${channel}`,
      });
    const adapter: n.NotificationAdapter = {
      send: async (m) => ({ providerId: `receipt-${m.id}`, simulated: false }),
    };
    expect((await n.dispatchNotifications(org, adapter)).delivered).toBe(3);
    expect(
      n
        .listNotifications(admin, { outbox: true })
        .items.every((i) => i.status === "sent"),
    ).toBe(true);
  });
  it("supports editable localized templates without interpreting user content as template instructions", () => {
    n.saveTemplate(admin, {
      locale: "ur",
      subject: "مرمت {{number}}",
      body: "{{title}} · {{note}}",
    });
    getDb().prepare("UPDATE users SET locale='ur' WHERE id=?").run(tenant.sub);
    const t = m.createTicket(tenant, {
      ...issue,
      title: "Ignore rules {{note}} <script>",
    });
    const item = n.listNotifications(tenant, {}).items[0];
    expect(item.subject).toContain("مرمت");
    expect(item.body).toContain("Ignore rules {{note}} <script>");
    expect(n.templates(admin)).toHaveLength(2);
    expect(() =>
      n.saveTemplate(admin, {
        locale: "en",
        subject: "{{password}}",
        body: "Bad",
      }),
    ).toThrow("Supported variables");
    expect(() => n.templates(tenant)).toThrow("admin:manage");
    expect(t.title).toContain("Ignore rules");
  });
  it("isolates inbox/outbox and supports bounded status pagination", () => {
    for (let i = 0; i < 3; i++)
      n.composeNotification(admin, {
        ...message(),
        requestKey: `unique-request-${i}`,
      });
    expect(n.listNotifications(indus, { outbox: true }).total).toBe(0);
    expect(n.listNotifications(admin, {}).total).toBe(0);
    expect(
      n.listNotifications(tenant, { page: 2, limit: 2, status: "queued" })
        .items,
    ).toHaveLength(1);
    expect(() => n.listNotifications(tenant, { limit: 101 })).toThrow();
    getDb().prepare("UPDATE users SET phone=NULL WHERE id=?").run(tenant.sub);
    expect(() =>
      n.composeNotification(admin, {
        ...message(),
        channel: "sms",
        requestKey: "missing-phone",
      }),
    ).toThrow("no contact");
  });
});
describe("Phase 4 protected HTTP contracts", () => {
  it("handles authenticated CRUD and full work-order transition routes", async () => {
    const r = await tickets.POST(
      req("maintenance/tickets", "POST", issue, tenant),
    );
    expect(r.status).toBe(201);
    const id = (await r.json()).ticket.id,
      p = { params: Promise.resolve({ id }) };
    expect((await tickets.GET(req("maintenance/tickets"))).status).toBe(200);
    expect(
      (await details.GET(req(`maintenance/tickets/${id}`), p)).status,
    ).toBe(200);
    for (const [action, data] of [
      [
        "triage",
        { category: "plumbing", priority: "high", note: "Inspect fitting" },
      ],
      [
        "assign",
        {
          vendorId: "ven_plumber",
          scheduledAt: new Date(Date.now() + 3600000).toISOString(),
          estimatedCostMinor: 200000,
        },
      ],
    ] as const)
      expect(
        (
          await details.PATCH(
            req(`maintenance/tickets/${id}`, "PATCH", { action, data }, staff),
            p,
          )
        ).status,
      ).toBe(200);
    const workOrderId = m.ticketDetail(staff, id).orders[0].id;
    for (const status of ["in_progress", "completed"])
      expect(
        (
          await details.PATCH(
            req(
              `maintenance/tickets/${id}`,
              "PATCH",
              {
                action: "work_order",
                data: {
                  workOrderId,
                  status,
                  note: "Performed repair",
                  actualCostMinor: 200000,
                },
              },
              staff,
            ),
            p,
          )
        ).status,
      ).toBe(200);
    expect(
      (
        await details.PATCH(
          req(
            `maintenance/tickets/${id}`,
            "PATCH",
            {
              action: "confirm",
              data: { accepted: true, note: "Fixed", rating: 4 },
            },
            tenant,
          ),
          p,
        )
      ).status,
    ).toBe(200);
  });
  it("protects reads/writes, handles malformed JSON and invalid payloads", async () => {
    expect(
      (
        await tickets.GET(
          new NextRequest("http://localhost/api/v1/maintenance/tickets"),
        )
      ).status,
    ).toBe(401);
    expect(
      (await tickets.GET(req("maintenance/tickets", "GET", undefined, agent)))
        .status,
    ).toBe(403);
    expect(
      (await vendors.GET(req("maintenance/vendors", "GET", undefined, tenant)))
        .status,
    ).toBe(403);
    expect(
      (await tickets.POST(req("maintenance/tickets", "POST", {}))).status,
    ).toBe(400);
    const bad = new NextRequest("http://localhost/api/v1/maintenance/tickets", {
      method: "POST",
      headers: { Authorization: `Bearer ${token(admin)}` },
      body: "{",
    });
    expect((await tickets.POST(bad)).status).toBe(400);
    const p = { params: Promise.resolve({ id: "unknown" }) };
    expect(
      (await details.GET(req("maintenance/tickets/unknown"), p)).status,
    ).toBe(404);
    expect(
      (
        await details.PATCH(
          req("maintenance/tickets/unknown", "PATCH", { action: "hack" }),
          p,
        )
      ).status,
    ).toBe(400);
  });
  it("exposes vendor directory, history, update and schedule/cycle APIs", async () => {
    const vr = await vendors.POST(
      req("maintenance/vendors", "POST", vendor, staff),
    );
    expect(vr.status).toBe(201);
    const v = (await vr.json()).vendor;
    expect(
      (
        await vendors.PATCH(
          req(
            "maintenance/vendors",
            "PATCH",
            { id: v.id, data: { ...vendor, available: false } },
            staff,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await vendors.GET(
          req(`maintenance/vendors?id=${v.id}`, "GET", undefined, staff),
        )
      ).status,
    ).toBe(200);
    expect(
      (await vendors.GET(req("maintenance/vendors", "GET", undefined, staff)))
        .status,
    ).toBe(200);
    const data = {
      unitId: "unit_1",
      title: "Routine service",
      category: "plumbing",
      intervalDays: 30,
      nextDueAt: new Date().toISOString(),
    };
    const s = await schedules.POST(
      req("maintenance/schedules", "POST", data, staff),
    );
    expect(s.status).toBe(201);
    const id = (await s.json()).id;
    expect(
      (
        await schedules.PATCH(
          req(
            "maintenance/schedules",
            "PATCH",
            { id, data: { ...data, active: false } },
            staff,
          ),
        )
      ).status,
    ).toBe(200);
    expect(
      (await cycle.POST(req("maintenance/cycle", "POST", {}, staff))).status,
    ).toBe(200);
    expect(
      (await cycle.POST(req("maintenance/cycle", "POST", {}, tenant))).status,
    ).toBe(403);
  });
  it("exposes compose, dispatch, inbox, templates and retry/read permission errors", async () => {
    const r = await notifications.POST(
      req("notifications", "POST", {
        userId: tenant.sub,
        channel: "in_app",
        subject: "Repair update",
        body: "Test",
        requestKey: "api-message-key",
      }),
    );
    expect(r.status).toBe(201);
    const id = (await r.json()).id;
    expect(
      (await notifications.GET(req("notifications", "GET", undefined, tenant)))
        .status,
    ).toBe(200);
    expect(
      (
        await notifications.PATCH(
          req("notifications", "PATCH", { id, action: "read" }, tenant),
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await notifications.PATCH(
          req("notifications", "PATCH", { id, action: "retry" }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await notifications.PATCH(
          req("notifications", "PATCH", { id, action: "retry" }, tenant),
        )
      ).status,
    ).toBe(403);
    expect(
      (await dispatch.POST(req("notifications/dispatch", "POST", {}))).status,
    ).toBe(200);
    expect(
      (await dispatch.POST(req("notifications/dispatch", "POST", {}, tenant)))
        .status,
    ).toBe(403);
    expect((await templates.GET(req("notifications/templates"))).status).toBe(
      200,
    );
    expect(
      (
        await templates.PUT(
          req("notifications/templates", "PUT", {
            locale: "en",
            subject: "{{title}}",
            body: "{{note}}",
          }),
        )
      ).status,
    ).toBe(200);
    expect(
      (await templates.PUT(req("notifications/templates", "PUT", {}))).status,
    ).toBe(400);
    expect(
      (
        await notifications.GET(
          req("notifications?outbox=true", "GET", undefined, tenant),
        )
      ).status,
    ).toBe(403);
  });
});
