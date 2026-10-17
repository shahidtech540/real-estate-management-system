import { beforeEach, afterEach, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { getDb, resetDbForTesting } from "@/server/db";
import { freshContext } from "@/server/modules/orchestration/orchestration.service";
import { uploadMap } from "@/server/modules/plot-maps/plot-maps.service";
import {
  editReview,
  reviewMap,
  publishMap,
} from "@/server/modules/plot-maps/review.service";
import { publishedMap } from "@/server/modules/plot-maps/viewer.service";
import {
  createBooking,
  plotDetails,
  bookingOptions,
  changeBooking,
  bookingFile,
} from "@/server/modules/plot-maps/bookings.service";
import { bookingSchedule, parseMajorMoney } from "@/lib/plot-booking";
import { today } from "@/server/modules/shared/domain";
const admin = () => freshContext("org_pakland", "usr_admin");
function setup() {
  const m = uploadMap(
    admin(),
    "prop_1",
    readFileSync("samples/plots-explicit.svg", "utf8"),
  );
  editReview(admin(), "prop_1", m.id, {
    action: "calibrate",
    revision: 0,
    calibration: { unit: "ft", ratio: 1, areaUnit: "sqft" },
  });
  let r = reviewMap(admin(), "prop_1", m.id);
  editReview(admin(), "prop_1", m.id, {
    action: "bulk",
    revision: r.revision,
    elementIds: r.plots.map((p) => p.elementId),
    data: { total_price_minor: 100003, currency: "PKR" },
  });
  r = reviewMap(admin(), "prop_1", m.id);
  publishMap(admin(), "prop_1", m.id, {
    revision: r.revision,
    baselineMapId: r.diff.baselineMapId,
    keepExistingData: true,
    acceptWarnings: true,
    warningReason: "Checked synthetic sample",
    acknowledgeRemoved: true,
  });
  return publishedMap(admin(), "prop_1").plots[0].id;
}
function input(id: string) {
  const p = plotDetails(admin(), id).plot;
  return {
    requestKey: crypto.randomUUID(),
    expectedMapId: p.mapId,
    expectedPriceMinor: p.priceMinor!,
    currency: p.currency,
    newClient: {
      fullName: "Test Buyer",
      phone: "+923001234567",
      cnic: "demo-id-only",
      email: "buyer@example.test",
      address: "Synthetic test address",
    },
    agentId: "usr_agent",
    bookingType: "reserve",
    tokenAmountMinor: 10000,
    bookingDate: today(),
    expiryDate: new Date(Date.now() + 86400000).toISOString(),
    paymentPlan: {
      kind: "installment",
      downPaymentMinor: 20000,
      installments: 3,
      firstDueDate: new Date(Date.now() + 32 * 86400000)
        .toISOString()
        .slice(0, 10),
    },
    notes: "Synthetic booking",
    files: [],
  } as any;
}
beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("REMS_DEPLOYMENT", "demo");
  vi.stubEnv("SQLITE_DB_PATH", ":memory:");
  resetDbForTesting();
});
afterEach(() => {
  resetDbForTesting();
  vi.unstubAllEnvs();
});
it("creates booking, linked CRM lead/client, unpaid billing invoice, real PDFs, actor audit and delivered in-app notifications atomically", async () => {
  const id = setup(),
    old = getDb().prepare("SELECT COUNT(*) n FROM invoices").get()!.n,
    result = await createBooking(admin(), id, input(id));
  expect(result.plot.status).toBe("reserved");
  expect(result.activeBookingId).toBe(result.bookingId);
  const b = result.bookings[0];
  expect(b.status).toBe("pending");
  expect(b.client_cnic).toBe("demo-id-only");
  expect(b.lead_id).toBeTruthy();
  expect(b.invoice).toMatchObject({ status: "pending", amount_minor: 10000 });
  expect(b.files.map((f) => f.kind).sort()).toEqual([
    "confirmation",
    "invoice",
  ]);
  for (const f of b.files)
    expect(
      bookingFile(admin(), id, String(f.id)).bytes.subarray(0, 5).toString(),
    ).toBe("%PDF-");
  expect(getDb().prepare("SELECT COUNT(*) n FROM invoices").get()!.n).toBe(old);
  expect(
    getDb()
      .prepare(
        "SELECT COUNT(*) n FROM notifications WHERE event_key LIKE 'plot-booking:%'",
      )
      .get()!.n,
  ).toBe(2);
  expect(
    getDb()
      .prepare(
        "SELECT actor_user_id FROM audit_logs WHERE action='plot.booking.created'",
      )
      .get()!.actor_user_id,
  ).toBe("usr_admin");
  expect(
    publishedMap(admin(), "prop_1").plots.find((p) => p.id === id)!.status,
  ).toBe("reserved");
});
it("two simultaneous requests have exactly one winner and no orphan side effects", async () => {
  const id = setup(),
    q = input(id),
    results = await Promise.allSettled([
      createBooking(admin(), id, q),
      createBooking(admin(), id, { ...q, requestKey: crypto.randomUUID() }),
    ]);
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  const rejected = results.find(
    (r) => r.status === "rejected",
  ) as PromiseRejectedResult;
  expect(rejected.reason.code).toBe("PLOT_JUST_BOOKED");
  for (const table of ["plot_bookings", "plot_token_invoices"])
    expect(getDb().prepare(`SELECT COUNT(*) n FROM ${table}`).get()!.n).toBe(1);
  expect(
    getDb().prepare("SELECT COUNT(*) n FROM plot_booking_files").get()!.n,
  ).toBe(2);
});
it("idempotent retries, including concurrent retries, create only one complete booking", async () => {
  const id = setup(),
    q = input(id),
    r = await Promise.all([
      createBooking(admin(), id, q),
      createBooking(admin(), id, q),
    ]);
  expect(r[0].bookingId).toBe(r[1].bookingId);
  expect(r.map((x) => x.replayed).sort()).toEqual([false, true]);
  await expect(
    createBooking(admin(), id, { ...q, notes: "different" }),
  ).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
});
it("links an existing client and preserves its existing CRM lead", async () => {
  const id = setup(),
    q = input(id);
  delete q.newClient;
  const client = getDb()
    .prepare(
      "SELECT id,lead_id FROM clients WHERE organization_id=? AND deleted_at IS NULL AND lead_id IS NOT NULL LIMIT 1",
    )
    .get("org_pakland")!;
  q.clientId = client.id;
  const result = await createBooking(admin(), id, q);
  expect(result.bookings[0].lead_id).toBe(client.lead_id);
});
it("full payment / confirmed booking creates booked status without manufacturing received cash", async () => {
  const id = setup(),
    q = input(id);
  q.bookingType = "book";
  q.expiryDate = null;
  q.tokenAmountMinor = 0;
  q.paymentPlan = {
    kind: "full",
    downPaymentMinor: 100003,
    installments: 0,
    firstDueDate: "",
  };
  const old = getDb().prepare("SELECT COUNT(*) n FROM payments").get()!.n,
    r = await createBooking(admin(), id, q);
  expect(r.plot.status).toBe("booked");
  expect(r.bookings[0].invoice!.status).toBe("not_due");
  expect(getDb().prepare("SELECT COUNT(*) n FROM payments").get()!.n).toBe(old);
});
it("confirm, extend and cancel use revisions and preserve activity/history/files", async () => {
  const id = setup(),
    r = await createBooking(admin(), id, input(id)),
    bookingId = r.bookingId,
    expiryDate = new Date(Date.now() + 2 * 86400000).toISOString();
  let d = changeBooking(admin(), id, {
    bookingId,
    revision: 0,
    action: "extend",
    expiryDate,
    reason: "Buyer requested extension",
  });
  expect(d.bookings[0].expiry_date).toBe(expiryDate);
  expect(() =>
    changeBooking(admin(), id, {
      bookingId,
      revision: 0,
      action: "confirm",
      reason: "Confirmed",
    }),
  ).toThrow(/changed/);
  d = changeBooking(admin(), id, {
    bookingId,
    revision: 1,
    action: "confirm",
    reason: "Verified booking terms",
  });
  expect(d.plot.status).toBe("booked");
  expect(d.bookings[0].expiry_date).toBe(null);
  expect(() =>
    changeBooking(admin(), id, {
      bookingId,
      revision: 2,
      action: "extend",
      expiryDate,
      reason: "Attempt",
    }),
  ).toThrow(/pending/);
  d = changeBooking(admin(), id, {
    bookingId,
    revision: 2,
    action: "cancel",
    reason: "Buyer withdrew request",
  });
  expect(d.plot.status).toBe("available");
  expect(d.bookings[0]).toMatchObject({ status: "cancelled", revision: 3 });
  expect(d.bookings[0].closed_at).toBeTruthy();
  expect(d.bookings[0].invoice!.status).toBe("cancelled");
  expect(d.bookings[0].files).toHaveLength(2);
  expect(d.activity.some((a) => a.action === "plot.booking.cancel")).toBe(true);
  const next = await createBooking(admin(), id, input(id));
  expect(next.bookingId).not.toBe(bookingId);
});
for (const [label, patch, code] of [
  ["negative token", { tokenAmountMinor: -1 }, "VALIDATION_ERROR"],
  ["fractional token", { tokenAmountMinor: 1.5 }, "VALIDATION_ERROR"],
  ["excess token", { tokenAmountMinor: 100004 }, "PAYMENT_PLAN"],
  ["stale price", { expectedPriceMinor: 123 }, "PLOT_CHANGED"],
  ["stale map", { expectedMapId: "old" }, "PLOT_CHANGED"],
  ["wrong currency", { currency: "USD" }, "PLOT_CHANGED"],
  ["missing hold", { expiryDate: null }, "HOLD_EXPIRY"],
  ["past hold", { expiryDate: "2000-01-01T00:00:00Z" }, "HOLD_EXPIRY"],
  ["long hold", { expiryDate: "2099-01-01T00:00:00Z" }, "HOLD_EXPIRY"],
  ["invalid date", { bookingDate: "2026-02-30" }, "VALIDATION_ERROR"],
  ["backdate", { bookingDate: "2000-01-01" }, "BOOKING_DATE"],
  ["foreign agent", { agentId: "usr_indus_admin" }, "INVALID_AGENT"],
  [
    "unknown client",
    { clientId: "missing", newClient: undefined },
    "CLIENT_NOT_FOUND",
  ],
  ["extra field", { status: "sold" }, "VALIDATION_ERROR"],
  [
    "bad phone",
    { newClient: { fullName: "AB", phone: "x" } },
    "VALIDATION_ERROR",
  ],
  [
    "bad email",
    { newClient: { fullName: "AB", phone: "03001234567", email: "invalid" } },
    "VALIDATION_ERROR",
  ],
] as const)
  it(`rejects ${label} without side effects`, async () => {
    const id = setup();
    await expect(
      createBooking(admin(), id, { ...input(id), ...patch }),
    ).rejects.toMatchObject({ code });
    expect(
      getDb().prepare("SELECT COUNT(*) n FROM plot_bookings").get()!.n,
    ).toBe(0);
    expect(plotDetails(admin(), id).plot.status).toBe("available");
  });
it("forces all CRM/billing/file/audit side effects to roll back on downstream failure", async () => {
  const id = setup(),
    counts = ["clients", "leads", "audit_logs", "notifications"].map(
      (t) => getDb().prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n,
    );
  getDb().exec(
    "CREATE TRIGGER fail_booking_files BEFORE INSERT ON plot_booking_files BEGIN SELECT RAISE(ABORT,'simulated storage failure'); END;",
  );
  await expect(createBooking(admin(), id, input(id))).rejects.toThrow(
    /simulated storage failure/,
  );
  expect(plotDetails(admin(), id).plot.status).toBe("available");
  expect(
    ["clients", "leads", "audit_logs", "notifications"].map(
      (t) => getDb().prepare(`SELECT COUNT(*) n FROM ${t}`).get()!.n,
    ),
  ).toEqual(counts);
  expect(
    getDb().prepare("SELECT COUNT(*) n FROM plot_token_invoices").get()!.n,
  ).toBe(0);
});
it("rejects invalid attachment signatures and stores real private file bytes", async () => {
  const id = setup(),
    q = input(id);
  q.files = [
    {
      name: "id.pdf",
      category: "id_copy",
      mimeType: "application/pdf",
      base64: Buffer.from("<script>alert(1)</script>").toString("base64"),
    },
  ];
  await expect(createBooking(admin(), id, q)).rejects.toMatchObject({
    code: "INVALID_ATTACHMENT",
  });
  q.files[0].base64 = Buffer.from("%PDF-1.7\n synthetic upload bytes").toString(
    "base64",
  );
  const r = await createBooking(admin(), id, q),
    file = r.bookings[0].files.find((f) => f.kind === "id_copy")!;
  expect(bookingFile(admin(), id, String(file.id)).bytes.toString()).toContain(
    "synthetic upload",
  );
  expect(() => bookingFile(admin(), id, "missing")).toThrow(/not found/);
});
for (const user of [
  "usr_agent",
  "usr_accountant",
  "usr_maintenance",
  "usr_owner",
  "usr_tenant",
])
  it(`denies Phase D APIs to ${user} until Phase E role policy`, async () => {
    const id = setup(),
      ctx = freshContext("org_pakland", user);
    expect(() => plotDetails(ctx, id)).toThrow();
    expect(() => bookingOptions(ctx, id, "Test")).toThrow();
    await expect(createBooking(ctx, id, input(id))).rejects.toThrow();
  });
it("fresh permissions, cross-organization and missing records are enforced", async () => {
  const id = setup(),
    ctx = admin();
  expect(() =>
    plotDetails(freshContext("org_indus", "usr_indus_admin"), id),
  ).toThrow();
  expect(() => plotDetails(ctx, "missing")).toThrow();
  getDb()
    .prepare(
      "DELETE FROM role_permissions WHERE role_id=? AND permission_id IN(SELECT id FROM permissions WHERE code='invoices:write')",
    )
    .run(ctx.roleId);
  await expect(createBooking(ctx, id, input(id))).rejects.toMatchObject({
    code: "FORBIDDEN_PERMISSION",
  });
});
it("options search exposes only bounded minimal matching clients, never CNIC/address", () => {
  const id = setup();
  expect(bookingOptions(admin(), id, "").clients).toEqual([]);
  const q = bookingOptions(admin(), id, "a");
  expect(q.clients).toEqual([]);
  const d = bookingOptions(admin(), id, "an");
  expect(JSON.stringify(d.clients)).not.toContain("cnic");
  expect(d.defaultAgentId).toBe("usr_admin");
  expect(() => bookingOptions(admin(), id, "x".repeat(101))).toThrow();
});
it("integer schedule sums exactly, uses original month day after February, and rejects invalid plans", () => {
  const lines = bookingSchedule(100003, 10000, "2026-10-17", {
    kind: "installment",
    downPaymentMinor: 20000,
    installments: 3,
    firstDueDate: "2027-01-31",
  });
  expect(lines.reduce((n, l) => n + l.amountMinor, 0)).toBe(100003);
  expect(lines.slice(2).map((l) => l.dueDate)).toEqual([
    "2027-01-31",
    "2027-02-28",
    "2027-03-31",
  ]);
  expect(() =>
    bookingSchedule(10, 11, "2026-10-17", {
      kind: "full",
      downPaymentMinor: 10,
      installments: 0,
      firstDueDate: "",
    }),
  ).toThrow();
  expect(parseMajorMoney("1000.03")).toBe(100003);
  for (const v of ["1.001", "-1", "1e6", "NaN", "Infinity"])
    expect(() => parseMajorMoney(v)).toThrow();
});

it("independent Node processes share the SQLite write lock: exactly one winner", async () => {
  const { mkdtempSync, rmSync } = await import("node:fs"),
    { tmpdir } = await import("node:os"),
    { fork } = await import("node:child_process");
  const folder = mkdtempSync(`${tmpdir()}/plot-booking-race-`);
  vi.stubEnv("SQLITE_DB_PATH", `${folder}/race.sqlite`);
  resetDbForTesting();
  const id = setup(),
    q = input(id),
    workers: [ReturnType<typeof fork>, ReturnType<typeof fork>] = [0, 1].map(
      () =>
        fork(`${process.cwd()}/tests/fixtures/plot-booking-worker.ts`, [], {
          execArgv: ["--import", "tsx"],
          env: { ...process.env, NODE_ENV: "test" },
          stdio: ["ignore", "pipe", "pipe", "ipc"],
        }),
    ) as any;
  try {
    const ready = workers.map(
      (w) =>
        new Promise<void>((resolve, reject) => {
          w.on("message", (m: any) => {
            if (m.ready) resolve();
          });
          w.on("error", reject);
          w.on("exit", (code) => {
            if (code) reject(new Error(`Worker exited ${code}`));
          });
        }),
    );
    await Promise.all(ready);
    const results = workers.map(
      (w) =>
        new Promise<any>((resolve, reject) => {
          w.on("message", (m: any) => {
            if (m.status) resolve(m);
          });
          w.on("error", reject);
        }),
    );
    workers.forEach((w) =>
      w.send({ plotId: id, input: { ...q, requestKey: crypto.randomUUID() } }),
    );
    const r = await Promise.all(results);
    expect(r.map((x) => x.status).sort()).toEqual([201, 409]);
    expect(r.find((x) => x.status === 409).code).toBe("PLOT_JUST_BOOKED");
    expect(
      getDb().prepare("SELECT COUNT(*) n FROM plot_bookings").get()!.n,
    ).toBe(1);
    expect(
      getDb().prepare("SELECT COUNT(*) n FROM plot_token_invoices").get()!.n,
    ).toBe(1);
    expect(
      getDb().prepare("SELECT COUNT(*) n FROM plot_booking_files").get()!.n,
    ).toBe(2);
  } finally {
    for (const w of workers) w.kill();
    vi.stubEnv("SQLITE_DB_PATH", ":memory:");
    resetDbForTesting();
    rmSync(folder, { recursive: true, force: true });
  }
}, 20000);
it("additive migration upgrades legacy columns and repeats without changing financial records", async () => {
  const { migratePlotBookings } = await import("@/server/db/plot-bookings"),
    db = getDb(),
    tables = [
      "units",
      "leases",
      "invoices",
      "payments",
      "receipts",
      "ledger_entries",
      "owner_statements",
    ],
    old = tables.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all());
  db.exec(
    "DROP INDEX plot_booking_request; ALTER TABLE clients DROP COLUMN address;",
  );
  for (const c of [
    "request_key",
    "input_hash",
    "booking_type",
    "revision",
    "price_minor",
    "map_version_id",
  ])
    db.exec(`ALTER TABLE plot_bookings DROP COLUMN ${c}`);
  migratePlotBookings(db);
  migratePlotBookings(db);
  expect(
    tables.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()),
  ).toEqual(old);
  const id = setup();
  await createBooking(admin(), id, input(id));
  expect(
    tables.map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()),
  ).toEqual(old);
  expect(
    db.prepare("PRAGMA foreign_key_check(plot_token_invoices)").all(),
  ).toEqual([]);
  expect(() =>
    db.prepare("UPDATE plot_bookings SET price_minor=1.5").run(),
  ).toThrow();
});
it("legacy booking/history stays readable but is never silently converted into new billing assumptions", () => {
  const id = setup(),
    now = new Date().toISOString();
  getDb()
    .prepare(
      "INSERT INTO plot_bookings(id,organization_id,plot_id,booking_date,status,created_at,updated_at,created_by) VALUES('legacy','org_pakland',?,?,'confirmed',?,?,'usr_admin')",
    )
    .run(id, today(), now, now);
  getDb().prepare("UPDATE plots SET status='booked' WHERE id=?").run(id);
  const d = plotDetails(admin(), id);
  expect(d.bookings[0].managed).toBe(false);
  expect(d.bookings[0].invoice).toBe(null);
  expect(() =>
    changeBooking(admin(), id, {
      bookingId: "legacy",
      revision: 0,
      action: "cancel",
      reason: "Attempt cancellation",
    }),
  ).toThrow(/Legacy/);
});
it("expired reservations do not auto-release or confirm during Phase D; explicit extension/cancel works", async () => {
  const id = setup(),
    r = await createBooking(admin(), id, input(id));
  getDb()
    .prepare(
      "UPDATE plot_bookings SET expiry_date='2000-01-01T00:00:00Z' WHERE id=?",
    )
    .run(r.bookingId);
  expect(() =>
    changeBooking(admin(), id, {
      bookingId: r.bookingId,
      revision: 0,
      action: "confirm",
      reason: "Attempt confirm",
    }),
  ).toThrow(/elapsed/);
  expect(plotDetails(admin(), id).plot.status).toBe("reserved");
  expect(
    changeBooking(admin(), id, {
      bookingId: r.bookingId,
      revision: 0,
      action: "extend",
      expiryDate: new Date(Date.now() + 86400000).toISOString(),
      reason: "Explicitly renewed hold",
    }).plot.status,
  ).toBe("reserved");
});
it("cancellation will not release a plot with conflicting sale/ownership or status", async () => {
  const id = setup(),
    r = await createBooking(admin(), id, input(id));
  getDb().prepare("UPDATE plots SET status='sold' WHERE id=?").run(id);
  expect(() =>
    changeBooking(admin(), id, {
      bookingId: r.bookingId,
      revision: 0,
      action: "cancel",
      reason: "Attempt cancellation",
    }),
  ).toThrow(/states differ/);
  expect(
    getDb()
      .prepare("SELECT status FROM plot_bookings WHERE id=?")
      .get(r.bookingId)!.status,
  ).toBe("pending");
});
it("attachments reject mismatched encoding, oversize bytes, path filenames and accept PNG/JPEG signatures", async () => {
  const { validateBookingFiles } = await import(
    "@/server/modules/documents/plot-booking-files"
  );
  for (const [mimeType, bytes] of [
    ["image/png", Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])],
    ["image/jpeg", Buffer.from([255, 216, 255, 0])],
  ] as const)
    expect(
      validateBookingFiles([
        {
          name: "test",
          category: "id_copy",
          mimeType,
          base64: bytes.toString("base64"),
        },
      ])[0].bytes,
    ).toEqual(bytes);
  expect(() =>
    validateBookingFiles([
      {
        name: "test.pdf",
        category: "id_copy",
        mimeType: "application/pdf",
        base64: Buffer.from("%PDF-").toString("base64") + "===",
      },
    ]),
  ).toThrow();
  const id = setup(),
    q = input(id);
  q.files = [
    {
      name: "../id.pdf",
      category: "id_copy",
      mimeType: "application/pdf",
      base64: Buffer.from("%PDF-").toString("base64"),
    },
  ];
  await expect(createBooking(admin(), id, q)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  expect(() =>
    validateBookingFiles([
      {
        ...q.files[0],
        name: "x",
        base64: Buffer.concat([
          Buffer.from("%PDF-"),
          Buffer.alloc(2 * 1024 * 1024),
        ]).toString("base64"),
      },
    ]),
  ).toThrow();
});
it("published DTO and unauthorized vault never leak the newly saved booking PII", async () => {
  const { canReadDocument } = await import("@/server/modules/shared/access");
  const id = setup(),
    r = await createBooking(admin(), id, input(id)),
    text = JSON.stringify(publishedMap(admin(), "prop_1"));
  for (const secret of [
    "Test Buyer",
    "demo-id-only",
    "buyer@example.test",
    "Synthetic test address",
  ])
    expect(text).not.toContain(secret);
  expect(canReadDocument(admin(), "plot_booking", r.bookingId)).toBe(true);
  for (const user of [
    "usr_agent",
    "usr_accountant",
    "usr_maintenance",
    "usr_owner",
    "usr_tenant",
  ]) {
    expect(
      canReadDocument(
        freshContext("org_pakland", user),
        "plot_booking",
        r.bookingId,
      ),
    ).toBe(false);
    expect(() =>
      bookingFile(
        freshContext("org_pakland", user),
        id,
        String(r.bookings[0].files[0].id),
      ),
    ).toThrow();
  }
});
it("strict full-plan, installment, expiry and client identity validation rejects ambiguous terms", async () => {
  const id = setup(),
    q = input(id);
  for (const patch of [
    { clientId: "cli_1" },
    { bookingType: "book", expiryDate: q.expiryDate },
    {
      paymentPlan: {
        kind: "full",
        downPaymentMinor: 1,
        installments: 0,
        firstDueDate: "",
      },
    },
    { paymentPlan: { ...q.paymentPlan, firstDueDate: q.bookingDate } },
    { paymentPlan: { ...q.paymentPlan, downPaymentMinor: 9999 } },
    { newClient: { fullName: "AB", phone: "-------" } },
    { bookingType: "book", expiryDate: null, tokenAmountMinor: 1e13 },
  ])
    await expect(
      createBooking(admin(), id, { ...q, ...patch }),
    ).rejects.toThrow();
});
it("database unique active booking index and org references remain a final safety net", async () => {
  const id = setup(),
    r = await createBooking(admin(), id, input(id)),
    now = new Date().toISOString();
  expect(() =>
    getDb()
      .prepare(
        "INSERT INTO plot_bookings(id,organization_id,plot_id,booking_date,status,created_at,updated_at,created_by) VALUES('duplicate','org_pakland',?,?,'pending',?,?,'usr_admin')",
      )
      .run(id, today(), now, now),
  ).toThrow();
  const other = publishedMap(admin(), "prop_1").plots.find((p) => p.id !== id)!;
  getDb()
    .prepare(
      "INSERT INTO clients(id,organization_id,full_name,phone,created_at,updated_at,created_by) VALUES('foreign','org_indus','Foreign test client','03001234567',?,?,'usr_indus_admin')",
    )
    .run(now, now);
  expect(() =>
    getDb()
      .prepare(
        "UPDATE plot_bookings SET client_id=(SELECT id FROM clients WHERE organization_id='org_indus' LIMIT 1) WHERE id=?",
      )
      .run(r.bookingId),
  ).toThrow();
  expect(() =>
    bookingFile(admin(), other.id, String(r.bookings[0].files[0].id)),
  ).toThrow(/not found/);
});
it("route auth, cookie origin, body limits, quotas, private PDFs and invoice register are enforced", async () => {
  const { NextRequest } = await import("next/server"),
    { signAccessToken } = await import("@/server/auth/crypto"),
    { POST, PATCH } = await import("@/app/api/v1/plots/[id]/bookings/route"),
    { GET } = await import("@/app/api/v1/plots/[id]/route"),
    { GET: options } = await import(
      "@/app/api/v1/plots/[id]/booking-options/route"
    ),
    { GET: file } = await import(
      "@/app/api/v1/plots/[id]/files/[fileId]/route"
    ),
    { GET: invoices } = await import(
      "@/app/api/v1/billing/plot-invoices/route"
    );
  const id = setup(),
    c = { params: Promise.resolve({ id }) },
    url = `http://localhost/api/v1/plots/${id}`,
    jwt = signAccessToken(admin());
  const req = (method = "GET", body?: unknown, user = admin()) =>
    new NextRequest(url, {
      method,
      headers: {
        Authorization: `Bearer ${signAccessToken(user)}`,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  expect((await GET(new NextRequest(url), c)).status).toBe(401);
  expect(
    (
      await POST(
        new NextRequest(url, {
          method: "POST",
          headers: {
            cookie: `rems_access_token=${jwt}`,
            origin: "https://evil.test",
          },
          body: "{}",
        }),
        c,
      )
    ).status,
  ).toBe(403);
  expect(
    (await POST(req("POST", { large: "x".repeat(6 * 1024 * 1024) }), c)).status,
  ).toBe(413);
  const denied = freshContext("org_pakland", "usr_agent");
  expect((await GET(req("GET", undefined, denied), c)).status).toBe(403);
  expect((await options(req("GET", undefined, denied), c)).status).toBe(403);
  expect((await POST(req("POST", {}, denied), c)).status).toBe(403);
  expect((await PATCH(req("PATCH", {}, denied), c)).status).toBe(403);
  expect((await invoices(req("GET", undefined, denied))).status).toBe(403);
  const q = input(id),
    created = await POST(req("POST", q), c);
  expect(created.status).toBe(201);
  expect((await POST(req("POST", q), c)).status).toBe(200);
  const result = await created.json(),
    fc = {
      params: Promise.resolve({ id, fileId: result.bookings[0].files[0].id }),
    },
    download = await file(req(), fc);
  expect(download.status).toBe(200);
  expect(download.headers.get("Content-Disposition")).toContain("attachment");
  expect(download.headers.get("Content-Security-Policy")).toContain("sandbox");
  expect(download.headers.get("Cache-Control")).toContain("no-store");
  expect((await file(req("GET", undefined, denied), fc)).status).toBe(403);
  expect(
    (
      await GET(
        req("GET", undefined, freshContext("org_indus", "usr_indus_admin")),
        c,
      )
    ).status,
  ).toBe(404);
  expect((await invoices(req())).status).toBe(200);
  expect((await options(req(), c)).status).toBe(200);
  expect((await GET(req(), c)).headers.get("Cache-Control")).toContain(
    "no-store",
  );
  expect(
    (
      await PATCH(
        req("PATCH", {
          bookingId: result.bookingId,
          revision: 0,
          action: "cancel",
          reason: "Route test cancellation",
        }),
        c,
      )
    ).status,
  ).toBe(200);
  for (let i = 0; i < 31; i++) {
    const response = await POST(req("POST", {}), c);
    if (i === 30) expect(response.status).toBe(429);
  }
});
