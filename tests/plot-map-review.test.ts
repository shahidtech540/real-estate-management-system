import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { getDb, resetDbForTesting } from "@/server/db";
import { migratePlotMaps } from "@/server/db/plot-maps";
import { freshContext } from "@/server/modules/orchestration/orchestration.service";
import {
  uploadMap,
  sanitizedMap,
} from "@/server/modules/plot-maps/plot-maps.service";
import {
  reviewMap,
  editReview,
  importReviewCsv,
  exportReviewCsv,
  publishMap,
} from "@/server/modules/plot-maps/review.service";
import {
  calibrationSchema,
  scaleFrom,
  areas,
  dimensions,
  roadHints,
  fromPolygons,
  polygons,
} from "@/server/modules/plot-maps/measurements";
import { parseCsv, exportCsv } from "@/server/modules/plot-maps/csv";
import { measure } from "@/server/modules/plot-maps/geometry";
import { parseSvg } from "@/server/modules/plot-maps/svg";
import { signAccessToken } from "@/server/auth/crypto";
import {
  GET as getReview,
  PATCH as patchReview,
} from "@/app/api/v1/properties/[id]/plot-maps/[mapId]/review/route";
import {
  GET as getCsv,
  POST as postCsv,
} from "@/app/api/v1/properties/[id]/plot-maps/[mapId]/csv/route";
import { POST as postPublish } from "@/app/api/v1/properties/[id]/plot-maps/[mapId]/publish/route";
const admin = () => freshContext("org_pakland", "usr_admin");
const svg = (s: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${s}</svg>`;
const rect = (n: string, x = 0) =>
  `<rect id="plot-${n}" x="${x}" width="10" height="10"/>`;
const create = (body = rect("1")) => uploadMap(admin(), "prop_1", svg(body)).id;
const read = (id: string) => reviewMap(admin(), "prop_1", id);
const edit = (id: string, input: Record<string, unknown>) =>
  editReview(admin(), "prop_1", id, { revision: read(id).revision, ...input });
const calibrate = (id: string) =>
  edit(id, {
    action: "calibrate",
    calibration: { unit: "ft", ratio: 1, areaUnit: "sqft" },
  });
const pub = (id: string, extra = {}) => {
  const r = read(id);
  return publishMap(admin(), "prop_1", id, {
    revision: r.revision,
    baselineMapId: r.diff.baselineMapId,
    keepExistingData: true,
    acceptWarnings: true,
    warningReason: "Reviewed approved layout",
    acknowledgeRemoved: true,
    ...extra,
  });
};
const body = (id: string, action: Record<string, unknown>) => ({
  revision: read(id).revision,
  ...action,
});
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
describe("calibration and measurements", () => {
  it("feet, meters, configured marla/kanal convert correctly", () => {
    const s = scaleFrom(
      calibrationSchema.parse({
        unit: "ft",
        ratio: 2,
        areaUnit: "marla",
        marlaSqFt: 225,
      }),
    );
    const a = areas(225, s);
    expect(a.sqft).toBe(900);
    expect(a.marla).toBe(4);
    expect(a.kanal).toBe(0.2);
    const meters = areas(100, { ...s, unit: "m", ratio: 1 });
    expect(meters.sqm).toBeCloseTo(100);
    expect(meters.sqft).toBeCloseTo(1076.39104167);
  });
  it("two-point calibration produces the correct ratio", () => {
    expect(
      scaleFrom(
        calibrationSchema.parse({
          unit: "ft",
          points: [
            [0, 0],
            [3, 4],
          ],
          distance: 50,
        }),
      ).ratio,
    ).toBe(10);
  });
  it.each([
    {
      unit: "ft",
      points: [
        [0, 0],
        [0, 0],
      ],
      distance: 10,
    },
    {
      unit: "ft",
      ratio: 1,
      points: [
        [0, 0],
        [1, 1],
      ],
      distance: 1,
    },
    { unit: "m" },
    { unit: "ft", ratio: 0 },
    { unit: "yd", ratio: 1 },
    { unit: "ft", ratio: 1, distance: 5 },
    { unit: "ft", ratio: 1, marlaSqFt: 0 },
  ])("rejects invalid calibration %j", (q) => {
    expect(calibrationSchema.safeParse(q).success).toBe(false);
  });
  it("rotated rectangular dimensions follow real edges rather than axis-aligned bounds", () => {
    const g = measure([
      [
        [0, 0],
        [3, 3],
        [9, -3],
        [6, -6],
      ],
    ])!;
    const d = dimensions(g, {
      unit: "ft",
      ratio: 1,
      areaUnit: "sqft",
      marlaSqFt: 272.25,
      northUp: false,
    });
    expect(d.width).toBeCloseTo(Math.sqrt(18));
    expect(d.length).toBeCloseTo(Math.sqrt(72));
  });
  it("north-up facing and adjacent-road corner hints are optional and approximate", () => {
    const g = measure([
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ])!,
      north = measure([
        [
          [-5, -2],
          [15, -2],
          [15, -1],
          [-5, -1],
        ],
      ])!,
      east = measure([
        [
          [11, -5],
          [12, -5],
          [12, 15],
          [11, 15],
        ],
      ])!;
    expect(roadHints(g, [], true).cornerCalculated).toBeNull();
    expect(roadHints(g, [north], false).facingCalculated).toBeNull();
    const h = roadHints(g, [north, east], true);
    expect(h.facingCalculated).toContain("North");
    expect(h.facingCalculated).toContain("East");
    expect(h.cornerCalculated).toBe(true);
  });
  it("compound fill normalization retains holes and ignores redundant nonzero inner rings", () => {
    const rings: [number, number][][] = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      [
        [2, 2],
        [8, 2],
        [8, 8],
        [2, 8],
      ],
    ];
    expect(
      fromPolygons(polygons(measure(rings, "evenodd")!))?.area,
    ).toBeCloseTo(64);
    expect(
      fromPolygons(polygons(measure(rings, "nonzero")!))?.area,
    ).toBeCloseTo(100);
  });
  it("calibration uses org defaults for future maps without mutating older snapshots", () => {
    const one = create();
    edit(one, {
      action: "calibrate",
      calibration: { unit: "ft", ratio: 2, areaUnit: "kanal", marlaSqFt: 225 },
    });
    const two = create();
    expect(read(two).defaults).toEqual({ areaUnit: "kanal", marlaSqFt: 225 });
    calibrate(two);
    expect(read(one).scale?.marlaSqFt).toBe(225);
    expect(read(one).plots[0].calculated?.area.sqft).toBe(400);
  });
});
describe("draft review and geometry edits", () => {
  it.each(["explicit", "text-only", "messy"])(
    "sample %s calibrates and publishes eight plots",
    (name) => {
      const id = uploadMap(
        admin(),
        "prop_1",
        readFileSync(`samples/plots-${name}.svg`, "utf8"),
      ).id;
      calibrate(id);
      expect(pub(id).plots).toBe(8);
      expect(
        getDb().prepare("SELECT id FROM plots WHERE map_id=?").all(id),
      ).toHaveLength(8);
    },
  );
  it("duplicate plot numbers are blocking and fixable", () => {
    const id = create(rect("1") + rect("1", 20));
    calibrate(id);
    expect(
      read(id).validation.errors.some((e) => e.code === "duplicate_number"),
    ).toBe(true);
    expect(() => pub(id)).toThrow(/Duplicate/);
    edit(id, {
      action: "assign",
      elementId: read(id).plots[1].elementId,
      plotNumber: "2",
    });
    expect(read(id).validation.errors).toEqual([]);
    expect(pub(id).status).toBe("published");
  });
  it("an unnumbered shape can be assigned, excluded and restored", () => {
    const id = create('<rect width="10" height="10"/>'),
      shape = read(id).shapes[0].elementId;
    edit(id, { action: "assign", elementId: shape, plotNumber: "A-4" });
    expect(read(id).plots[0].plotNumber).toBe("A-4");
    edit(id, { action: "exclude", elementIds: [shape] });
    expect(read(id).plots[0].excluded).toBe(true);
    edit(id, { action: "assign", elementId: shape, plotNumber: "5" });
    expect(read(id).plots[0].excluded).toBe(false);
  });
  it("admins can override road-layer exclusion", () => {
    const id = create('<g id="roads"><rect width="10" height="10"/></g>');
    expect(read(id).plots).toHaveLength(0);
    edit(id, {
      action: "assign",
      elementId: read(id).shapes[0].elementId,
      plotNumber: "99",
    });
    expect(read(id).plots[0].plotNumber).toBe("99");
  });
  it("hidden definitions cannot become invisible bookable plots", () => {
    const id = create('<defs><rect width="10" height="10"/></defs>');
    expect(() =>
      edit(id, {
        action: "assign",
        elementId: read(id).shapes[0].elementId,
        plotNumber: "99",
      }),
    ).toThrow(/Flatten/);
  });
  it("overlap is diagnosed; touching neighbors are not overlaps", () => {
    const overlapping = create(rect("1") + rect("2", 5));
    expect(
      read(overlapping).validation.warnings.some((w) => w.code === "overlap"),
    ).toBe(true);
    const touching = create(rect("1") + rect("2", 10));
    expect(
      read(touching).validation.warnings.some((w) => w.code === "overlap"),
    ).toBe(false);
  });
  it("merge unions overlapping areas and creates real sanitized SVG paths", () => {
    const id = create(rect("1") + rect("2", 5));
    edit(id, {
      action: "merge",
      elementIds: read(id).plots.map((p) => p.elementId),
      plotNumber: "A",
    });
    const r = read(id),
      p = r.plots.find((p) => !p.excluded)!;
    expect(p.areaSvg).toBeCloseTo(150);
    expect(
      parseSvg(sanitizedMap(admin(), "prop_1", id)).getElementById(p.elementId),
    ).toBeTruthy();
    expect(r.plots.filter((p) => p.excluded)).toHaveLength(2);
  });
  it("split partitions geometry without duplicating official area/price", () => {
    const id = create(),
      r = read(id).plots[0];
    edit(id, {
      action: "bulk",
      elementIds: [r.elementId],
      data: { area_official: 80, total_price_minor: 5000, block: "A" },
    });
    edit(id, {
      action: "split",
      elementId: r.elementId,
      axis: "x",
      at: 4,
      numbers: ["1A", "1B"],
    });
    const parts = read(id).plots.filter((p) => !p.excluded);
    expect(parts.map((p) => p.areaSvg).sort((a, b) => a - b)).toEqual([40, 60]);
    for (const p of parts) {
      expect(p.data.area_official).toBeUndefined();
      expect(p.data.total_price_minor).toBeUndefined();
      expect(p.data.block).toBe("A");
    }
  });
  it("bad splits and repeated merge selections roll back with no edits", () => {
    const id = create(),
      p = read(id).plots[0],
      before = read(id);
    expect(() =>
      edit(id, {
        action: "split",
        elementId: p.elementId,
        axis: "y",
        at: 100,
        numbers: ["2", "3"],
      }),
    ).toThrow(/inside/);
    expect(() =>
      edit(id, {
        action: "merge",
        elementIds: [p.elementId, p.elementId],
        plotNumber: "2",
      }),
    ).toThrow(/two different/);
    expect(read(id)).toEqual(before);
  });
  it("bulk official values stay distinct from calculations and only apply on publish", () => {
    const id = create();
    calibrate(id);
    edit(id, {
      action: "bulk",
      elementIds: [read(id).plots[0].elementId],
      data: {
        area_official: 125,
        area_unit: "sqft",
        dimensions_official: "25 x 5 ft",
        block: "North",
        price_per_unit_minor: 200,
      },
    });
    const r = read(id);
    expect(r.plots[0].calculated?.area.value).toBe(100);
    expect(r.plots[0].data.area_official).toBe(125);
    expect(getDb().prepare("SELECT * FROM plots").all()).toHaveLength(0);
    pub(id);
    const p = getDb().prepare("SELECT * FROM plots").get()!;
    expect(p.area_official).toBe(125);
    expect(p.total_price_minor).toBe(25000);
  });
  it("stale revisions reject concurrent writes", () => {
    const id = create();
    const revision = read(id).revision;
    calibrate(id);
    expect(() =>
      editReview(admin(), "prop_1", id, {
        action: "exclude",
        revision,
        elementIds: [read(id).plots[0].elementId],
      }),
    ).toThrow(/Another editor/);
    expect(read(id).plots[0].excluded).toBe(false);
  });
  it("invalid number/fields and fractional money are rejected", () => {
    const id = create(),
      elementId = read(id).plots[0].elementId;
    expect(() =>
      edit(id, { action: "assign", elementId, plotNumber: "<script>" }),
    ).toThrow();
    expect(() =>
      edit(id, {
        action: "bulk",
        elementIds: [elementId],
        data: { total_price_minor: 1.1 },
      }),
    ).toThrow();
    expect(() =>
      edit(id, {
        action: "bulk",
        elementIds: [elementId],
        data: { map_id: "evil" },
      }),
    ).toThrow();
  });
});
describe("CSV, publication and preservation", () => {
  it("CSV round trips quoted commas, escaped quotes, multiline fields and CRLF", () => {
    const out = exportCsv([
      {
        plot_number: "1",
        block: 'A, "North"\nSecond',
        total_price_minor: 1500,
      },
    ]);
    expect(parseCsv(out)[0].block).toBe('A, "North"\nSecond');
  });
  it.each([
    "plot_number,evil\n1,2",
    "plot_number,plot_number\n1,2",
    'plot_number,block\n1,"bad',
    'plot_number,block\n1,"x"oops',
    "plot_number,block\n1",
  ])("rejects malformed/unknown CSV %s", (csv) => {
    expect(() => parseCsv(csv)).toThrow();
  });
  it("CSV export neutralizes spreadsheet formulas", () => {
    expect(
      exportCsv([{ plot_number: "1", block: '=HYPERLINK("evil")' }]),
    ).toContain("'=HYPERLINK");
  });
  it("CSV matches by plot number and leaves blank columns unchanged", () => {
    const id = create(),
      el = read(id).plots[0].elementId;
    edit(id, { action: "bulk", elementIds: [el], data: { block: "Old" } });
    importReviewCsv(
      admin(),
      "prop_1",
      id,
      body(id, {
        csv: "plot_number,block,phase,total_price_minor\r\n1,,Two,1500",
      }),
    );
    expect(read(id).plots[0].data).toMatchObject({
      block: "Old",
      phase: "Two",
      total_price_minor: 1500,
    });
    expect(
      parseCsv(exportReviewCsv(admin(), "prop_1", id))[0].total_price_minor,
    ).toBe("1500");
  });
  it.each([
    "plot_number,block\n1,A\n99,B",
    "plot_number,block\n1,A\n1,B",
    "plot_number,total_price_minor\n1,1.5",
    "plot_number,total_price_minor\n1,1e3",
    "plot_number,status\n1,sold",
  ])("CSV batch rollback on invalid input %s", (csv) => {
    const id = create(),
      before = read(id);
    expect(() =>
      importReviewCsv(admin(), "prop_1", id, body(id, { csv })),
    ).toThrow();
    expect(read(id)).toEqual(before);
  });
  it("uncalibrated/empty maps cannot publish even accepting warnings", () => {
    const id = create();
    expect(() => pub(id)).toThrow(/Calibrate/);
    calibrate(id);
    edit(id, { action: "exclude", elementIds: [read(id).plots[0].elementId] });
    expect(() => pub(id)).toThrow(/At least one/);
  });
  it("overlap warnings require an explicit acceptance reason", () => {
    const id = create(rect("1") + rect("2", 5));
    calibrate(id);
    expect(() => pub(id, { acceptWarnings: false })).toThrow(/warnings/);
    expect(() => pub(id, { warningReason: "" })).toThrow(/warnings/);
    expect(pub(id).status).toBe("published");
  });
  it("published maps are immutable and audited; only one map stays published", () => {
    const one = create();
    calibrate(one);
    pub(one);
    expect(() => calibrate(one)).toThrow(/Only a draft/);
    const two = create();
    calibrate(two);
    pub(two);
    expect(read(one).status).toBe("archived");
    expect(read(two).status).toBe("published");
    expect(
      getDb()
        .prepare("SELECT * FROM audit_logs WHERE action='plot_map.published'")
        .all(),
    ).toHaveLength(2);
    expect(getDb().prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("publish compare-and-swap rejects a stale published baseline", () => {
    const one = create(),
      two = create();
    calibrate(one);
    calibrate(two);
    const stale = read(two);
    pub(one);
    expect(() =>
      publishMap(admin(), "prop_1", two, {
        revision: stale.revision,
        baselineMapId: null,
        keepExistingData: true,
        acceptWarnings: true,
        warningReason: "Reviewed",
        acknowledgeRemoved: true,
      }),
    ).toThrow(/Published map changed/);
    expect(read(one).status).toBe("published");
    expect(read(two).status).toBe("draft");
  });
  it("reupload preserves canonical identity, bookings, sales, ownership and official data", () => {
    const one = create();
    calibrate(one);
    edit(one, {
      action: "bulk",
      elementIds: [read(one).plots[0].elementId],
      data: {
        block: "Original",
        area_official: 150,
        area_unit: "sqft",
        total_price_minor: 90000,
      },
    });
    pub(one);
    const db = getDb(),
      p = db.prepare("SELECT * FROM plots").get()!,
      now = new Date().toISOString();
    db.prepare(
      "INSERT INTO plot_bookings(id,organization_id,plot_id,booking_date,status,created_at,updated_at,created_by) VALUES('history','org_pakland',?,?,'confirmed',?,?,'usr_admin')",
    ).run(p.id, now, now, now);
    db.prepare("UPDATE plots SET status='booked' WHERE id=?").run(p.id);
    const bookings = db.prepare("SELECT * FROM plot_bookings").all();
    const two = create();
    calibrate(two);
    expect(() => pub(two, { keepExistingData: false })).toThrow(
      /Keep existing data/,
    );
    pub(two);
    const after = db.prepare("SELECT * FROM plots").get()!;
    expect(after.id).toBe(p.id);
    expect(after.block).toBe("Original");
    expect(after.total_price_minor).toBe(90000);
    expect(after.status).toBe("booked");
    expect(after.map_id).toBe(two);
    expect(db.prepare("SELECT * FROM plot_bookings").all()).toEqual(bookings);
  });
  it("protected plots cannot be removed, renumbered, merged away or reset by CSV", () => {
    const one = create();
    calibrate(one);
    pub(one);
    getDb().prepare("UPDATE plots SET status='sold'").run();
    const two = create(rect("2"));
    calibrate(two);
    expect(
      read(two).validation.errors.some((e) => e.code === "protected_removal"),
    ).toBe(true);
    expect(() => pub(two)).toThrow(/business history/);
    const three = create();
    calibrate(three);
    expect(() =>
      importReviewCsv(
        admin(),
        "prop_1",
        three,
        body(three, { csv: "plot_number,status\n1,available" }),
      ),
    ).toThrow(/business history/);
  });
  it("unused removed plots archive only after acknowledgement and can reuse identity later", () => {
    const one = create(rect("1") + rect("2", 20));
    calibrate(one);
    pub(one);
    const id = getDb()
      .prepare("SELECT id FROM plots WHERE plot_number='2'")
      .get()!.id;
    const two = create();
    calibrate(two);
    expect(() => pub(two, { acknowledgeRemoved: false })).toThrow(
      /Acknowledge/,
    );
    pub(two);
    expect(
      getDb().prepare("SELECT deleted_at FROM plots WHERE id=?").get(id)!
        .deleted_at,
    ).toBeTruthy();
    const three = create(rect("1") + rect("2", 20));
    calibrate(three);
    pub(three);
    expect(
      getDb()
        .prepare("SELECT id,deleted_at FROM plots WHERE plot_number='2'")
        .get(),
    ).toEqual({ id, deleted_at: null });
  });
  it("replacement mode clears unprotected old official fields without replacing identity", () => {
    const one = create();
    calibrate(one);
    edit(one, {
      action: "bulk",
      elementIds: [read(one).plots[0].elementId],
      data: { block: "Old", area_official: 300 },
    });
    pub(one);
    const id = getDb().prepare("SELECT id FROM plots").get()!.id;
    const two = create();
    calibrate(two);
    pub(two, { keepExistingData: false });
    expect(
      getDb().prepare("SELECT id,block,area_official FROM plots").get(),
    ).toEqual({ id, block: null, area_official: null });
  });
  it("money overflow aborts publication atomically", () => {
    const id = create();
    calibrate(id);
    edit(id, {
      action: "bulk",
      elementIds: [read(id).plots[0].elementId],
      data: { price_per_unit_minor: 1000000000000 },
    });
    expect(() => pub(id)).toThrow();
    expect(getDb().prepare("SELECT * FROM plots").all()).toHaveLength(0);
    expect(read(id).status).toBe("draft");
  });
  it("no source units/leases/invoices/ledger writes on publish; migration repeats safely", () => {
    const db = getDb(),
      tables = ["units", "leases", "invoices", "ledger_entries"].filter((t) =>
        db
          .prepare(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
          )
          .get(t),
      );
    const before = tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all());
    const id = create();
    calibrate(id);
    pub(id);
    migratePlotMaps(db);
    migratePlotMaps(db);
    expect(tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all())).toEqual(
      before,
    );
    expect(read(id).status).toBe("published");
  });
});
it("old Phase A evenodd rows infer their stored fill rule before geometry edits", () => {
  const id = create(
    '<path id="plot-1" fill-rule="evenodd" d="M0 0h10v10h-10Z M2 2h6v6h-6Z"/>' +
      rect("2", 20),
  );
  getDb()
    .prepare("UPDATE map_plot_geometries SET fill_rule=NULL WHERE map_id=?")
    .run(id);
  edit(id, {
    action: "merge",
    elementIds: read(id).plots.map((p) => p.elementId),
    plotNumber: "1",
  });
  expect(read(id).plots.find((p) => !p.excluded)?.areaSvg).toBeCloseTo(164);
});
it("official area/price unit is bound when edited, not reinterpreted on later calibration", () => {
  const id = create();
  calibrate(id);
  edit(id, {
    action: "bulk",
    elementIds: [read(id).plots[0].elementId],
    data: { area_official: 150 },
  });
  edit(id, {
    action: "calibrate",
    calibration: { unit: "m", ratio: 1, areaUnit: "sqm" },
  });
  expect(read(id).plots[0].data.area_unit).toBe("sqft");
  pub(id);
  expect(
    getDb().prepare("SELECT area_official,area_unit FROM plots").get(),
  ).toEqual({ area_official: 150, area_unit: "sqft" });
});
it("review and publication handle 1,000 regularly spaced plot candidates", () => {
  const id = create(
    Array.from(
      { length: 1000 },
      (_, i) =>
        `<rect data-plot="${i + 1}" x="${(i % 50) * 15}" y="${Math.floor(i / 50) * 15}" width="10" height="10"/>`,
    ).join(""),
  );
  calibrate(id);
  expect(read(id).plots).toHaveLength(1000);
  expect(pub(id).plots).toBe(1000);
}, 15000);
it("sale, ownership and resale history remain byte-for-byte intact on a matching reupload", () => {
  const one = create();
  calibrate(one);
  pub(one);
  const db = getDb(),
    p = db.prepare("SELECT id FROM plots").get()!.id,
    client = db
      .prepare(
        "SELECT id FROM clients WHERE organization_id='org_pakland' LIMIT 1",
      )
      .get()!.id,
    owner = db
      .prepare(
        "SELECT id FROM owners WHERE organization_id='org_pakland' LIMIT 1",
      )
      .get()!.id,
    now = new Date().toISOString();
  db.prepare(
    "INSERT INTO plot_sales(id,organization_id,plot_id,buyer_id,sale_price_minor,sale_date,payment_status,current_owner,created_at,updated_at,created_by) VALUES('sale','org_pakland',?,?,100000,?,'paid',1,?,?,'usr_admin')",
  ).run(p, client, now, now, now);
  db.prepare(
    "INSERT INTO plot_ownership_history(id,organization_id,plot_id,owner_id,from_date,transfer_type,price_minor,created_at,updated_at,created_by) VALUES('ownership','org_pakland',?,?,?,'sale',100000,?,?,'usr_admin')",
  ).run(p, owner, now, now, now);
  db.prepare(
    "INSERT INTO resale_listings(id,organization_id,plot_id,seller_id,asking_price_minor,listed_date,status,created_at,updated_at,created_by) VALUES('resale','org_pakland',?,?,150000,?,'active',?,?,'usr_admin')",
  ).run(p, owner, now, now, now);
  db.prepare("UPDATE plots SET status='resale' WHERE id=?").run(p);
  const tables = ["plot_sales", "plot_ownership_history", "resale_listings"],
    before = tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all());
  const two = create();
  calibrate(two);
  pub(two);
  expect(tables.map((t) => db.prepare(`SELECT * FROM ${t}`).all())).toEqual(
    before,
  );
  expect(db.prepare("SELECT id,status FROM plots").get()).toEqual({
    id: p,
    status: "resale",
  });
});
it("numbered groups union overlapping children and respect child evenodd holes", () => {
  const id = create(
    '<g id="plot-1"><rect width="10" height="10"/><rect x="5" width="10" height="10"/></g><g id="plot-2" transform="translate(30)"><path fill-rule="evenodd" d="M0 0h10v10h-10Z M2 2h6v6h-6Z"/></g>',
  );
  expect(read(id).plots.map((p) => p.areaSvg)).toEqual([150, 64]);
});
describe("permissions and HTTP contracts", () => {
  it.each(["usr_agent", "usr_accountant", "usr_owner", "usr_tenant"])(
    "%s is denied draft/review/write/export/publish",
    (user) => {
      const id = create(),
        ctx = freshContext("org_pakland", user);
      expect(() => reviewMap(ctx, "prop_1", id)).toThrow(/administrator/);
      expect(() => exportReviewCsv(ctx, "prop_1", id)).toThrow(/administrator/);
      expect(() =>
        editReview(ctx, "prop_1", id, {
          revision: 0,
          action: "calibrate",
          calibration: { unit: "ft", ratio: 1 },
        }),
      ).toThrow(/administrator/);
    },
  );
  it("cross-org map and revoked permissions are denied", () => {
    const id = create(),
      ctx = freshContext("org_indus", "usr_indus_admin");
    expect(() => reviewMap(ctx, "prop_1", id)).toThrow(/organization/);
    const a = admin();
    getDb()
      .prepare(
        "DELETE FROM role_permissions WHERE role_id=? AND permission_id IN (SELECT id FROM permissions WHERE code='properties:write')",
      )
      .run(a.roleId);
    expect(() => reviewMap(a, "prop_1", id)).toThrow(/properties:write/);
  });
  it("authenticated review/CSV/publish route sequence works and anonymous fails", async () => {
    const id = create(),
      c = { params: Promise.resolve({ id: "prop_1", mapId: id }) },
      url = `http://localhost/api/v1/properties/prop_1/plot-maps/${id}`,
      token = signAccessToken(admin()),
      headers = {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      };
    expect((await getReview(new NextRequest(url + "/review"), c)).status).toBe(
      401,
    );
    expect(
      (await getReview(new NextRequest(url + "/review", { headers }), c))
        .status,
    ).toBe(200);
    const p = await patchReview(
      new NextRequest(url + "/review", {
        method: "PATCH",
        headers,
        body: JSON.stringify(
          body(id, {
            action: "calibrate",
            calibration: { unit: "ft", ratio: 1 },
          }),
        ),
      }),
      c,
    );
    expect(p.status).toBe(200);
    expect(
      (
        await postCsv(
          new NextRequest(url + "/csv", {
            method: "POST",
            headers,
            body: JSON.stringify(
              body(id, { csv: "plot_number,block\n1,Imported" }),
            ),
          }),
          c,
        )
      ).status,
    ).toBe(200);
    const csv = await getCsv(new NextRequest(url + "/csv", { headers }), c);
    expect(csv.headers.get("content-type")).toContain("text/csv");
    expect(await csv.text()).toContain("Imported");
    const r = read(id);
    const published = await postPublish(
      new NextRequest(url + "/publish", {
        method: "POST",
        headers,
        body: JSON.stringify({
          revision: r.revision,
          baselineMapId: null,
          keepExistingData: true,
          acceptWarnings: true,
          warningReason: "Reviewed",
          acknowledgeRemoved: true,
        }),
      }),
      c,
    );
    expect(published.status).toBe(200);
    expect((await published.json()).status).toBe("published");
  });
});
