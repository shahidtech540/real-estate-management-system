import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import { getDb, resetDbForTesting } from "@/server/db";
import { freshContext } from "@/server/modules/orchestration/orchestration.service";
import { signAccessToken } from "@/server/auth/crypto";
import { uploadMap } from "@/server/modules/plot-maps/plot-maps.service";
import {
  reviewMap,
  editReview,
  publishMap,
} from "@/server/modules/plot-maps/review.service";
import { publishedMap } from "@/server/modules/plot-maps/viewer.service";
import { GET } from "@/app/api/v1/properties/[id]/plot-maps/viewer/route";
import {
  cameraForPlot,
  constrainCamera,
  directionalPlot,
  emptyMapFilters,
  findPlot,
  fitCamera,
  matchesMapFilters,
  pathFor,
  plotAriaLabel,
  plotStatuses,
  statusCounts,
  tooltipPosition,
  validateMapFilters,
  zoomAt,
  type ViewerPlot,
} from "@/lib/plot-map-viewer";
const admin = () => freshContext("org_pakland", "usr_admin");
function draft() {
  return uploadMap(
    admin(),
    "prop_1",
    readFileSync("samples/plots-explicit.svg", "utf8"),
  ).id;
}
function calibrate(id: string, areaUnit = "sqft") {
  return editReview(admin(), "prop_1", id, {
    action: "calibrate",
    revision: reviewMap(admin(), "prop_1", id).revision,
    calibration: { unit: "ft", ratio: 1, areaUnit },
  });
}
function pub(id: string) {
  const r = reviewMap(admin(), "prop_1", id);
  return publishMap(admin(), "prop_1", id, {
    revision: r.revision,
    baselineMapId: r.diff.baselineMapId,
    keepExistingData: true,
    acceptWarnings: true,
    warningReason: "Compared synthetic sample",
    acknowledgeRemoved: true,
  });
}
function setup() {
  const id = draft();
  calibrate(id);
  pub(id);
  return id;
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
describe("published map read model", () => {
  it("does not expose draft or archived maps", () => {
    const one = draft();
    expect(() => publishedMap(admin(), "prop_1")).toThrow(/No published map/);
    calibrate(one);
    pub(one);
    const two = draft();
    expect(publishedMap(admin(), "prop_1").id).toBe(one);
    calibrate(two);
    pub(two);
    expect(publishedMap(admin(), "prop_1").id).toBe(two);
  });
  it("reads only sanitized bytes with matched canonical IDs, not original SVG or draft geometry", () => {
    const id = setup(),
      m = publishedMap(admin(), "prop_1");
    expect(m.id).toBe(id);
    expect(m.plots).toHaveLength(8);
    for (const p of m.plots) {
      expect(p.elementId).toMatch(/^pm-/);
      expect(p.id).toMatch(/^plot_/);
      expect(m.svg).toContain(`id="${p.elementId}"`);
    }
    expect(m).not.toHaveProperty("original_svg_path");
    expect(m).not.toHaveProperty("report");
    expect(m.plots[0]).not.toHaveProperty("review_json");
  });
  it("prefers official values and converts sizes to the calibrated filter unit", () => {
    const id = draft();
    calibrate(id);
    const r = reviewMap(admin(), "prop_1", id);
    editReview(admin(), "prop_1", id, {
      action: "bulk",
      revision: r.revision,
      elementIds: [r.plots[0].elementId],
      data: {
        area_official: 2,
        area_unit: "marla",
        dimensions_official: "30 x 18.15 ft",
        facing: "North",
        is_corner: 1,
        total_price_minor: 12345,
        block: "A",
      },
    });
    pub(id);
    const p = publishedMap(admin(), "prop_1").plots[0];
    expect(p.area).toEqual({
      value: 2,
      unit: "marla",
      source: "official",
      filterValue: 544.5,
    });
    expect(p.dimensions).toEqual({ text: "30 x 18.15 ft", source: "official" });
    expect(p.corner).toBe(true);
    expect(p.priceMinor).toBe(12345);
  });
  it("falls back to clearly marked calculated measurements and leaves unknown flags null", () => {
    setup();
    const p = publishedMap(admin(), "prop_1").plots[0];
    expect(p.area.source).toBe("calculated");
    expect(p.dimensions?.source).toBe("calculated");
    expect(p.corner).toBeNull();
    expect(p.facing).toBeNull();
    expect(p.priceMinor).toBeNull();
  });
  it("returns current canonical status/price rather than stale review metadata", () => {
    setup();
    getDb()
      .prepare(
        "UPDATE plots SET status='sold',total_price_minor=45600 WHERE plot_number='1'",
      )
      .run();
    const p = publishedMap(admin(), "prop_1").plots.find(
      (p) => p.number === "1",
    )!;
    expect(p.status).toBe("sold");
    expect(p.priceMinor).toBe(45600);
  });
  it("does not serialize buyer/agent/owner/CNIC/booking/financial-history rows", () => {
    setup();
    const db = getDb(),
      p = db.prepare("SELECT id FROM plots LIMIT 1").get()!.id,
      now = new Date().toISOString();
    db.prepare(
      "INSERT INTO plot_bookings(id,organization_id,plot_id,booking_date,status,notes,created_at,updated_at,created_by) VALUES('secret-booking','org_pakland',?,?,'confirmed','PRIVATE BUYER CNIC 1234',?,?,'usr_admin')",
    ).run(p, now, now, now);
    expect(JSON.stringify(publishedMap(admin(), "prop_1"))).not.toMatch(
      /PRIVATE BUYER|secret-booking|token_amount|client_id|owner_id|agent_id|notes/,
    );
  });
  it("excludes soft-deleted plots and explicitly excluded geometry", () => {
    setup();
    getDb()
      .prepare("UPDATE plots SET deleted_at='2026-10-17' WHERE plot_number='1'")
      .run();
    expect(publishedMap(admin(), "prop_1").plots).toHaveLength(7);
  });
  it("supports calibrated square-meter official size conversion", () => {
    const id = draft();
    calibrate(id, "sqm");
    const r = reviewMap(admin(), "prop_1", id);
    editReview(admin(), "prop_1", id, {
      action: "bulk",
      revision: r.revision,
      elementIds: [r.plots[0].elementId],
      data: { area_official: 100, area_unit: "sqft" },
    });
    pub(id);
    expect(
      publishedMap(admin(), "prop_1").plots[0].area.filterValue,
    ).toBeCloseTo(9.290304);
  });
  it("is read-only for units, plots, finance and map rows", () => {
    setup();
    const tables = [
        "plots",
        "map_plot_geometries",
        "project_maps",
        "units",
        "plot_bookings",
      ],
      before = tables.map((t) => getDb().prepare(`SELECT * FROM ${t}`).all());
    publishedMap(admin(), "prop_1");
    expect(
      tables.map((t) => getDb().prepare(`SELECT * FROM ${t}`).all()),
    ).toEqual(before);
  });
  it.each(["usr_agent", "usr_accountant", "usr_owner", "usr_tenant"])(
    "denies %s until Phase E explicitly introduces read roles",
    (user) => {
      setup();
      expect(() =>
        publishedMap(freshContext("org_pakland", user), "prop_1"),
      ).toThrow(/administrator/);
    },
  );
  it("denies cross-org projects and permission downgrades on an old context", () => {
    setup();
    expect(() =>
      publishedMap(freshContext("org_indus", "usr_indus_admin"), "prop_1"),
    ).toThrow(/organization/);
    const ctx = admin();
    getDb()
      .prepare(
        "DELETE FROM role_permissions WHERE role_id=? AND permission_id IN (SELECT id FROM permissions WHERE code='properties:write')",
      )
      .run(ctx.roleId);
    expect(() => publishedMap(ctx, "prop_1")).toThrow(/properties:write/);
  });
  it("serves authenticated no-store JSON; unauthenticated and draft-only requests fail", async () => {
    const c = { params: Promise.resolve({ id: "prop_1" }) },
      url = "http://localhost/api/v1/properties/prop_1/plot-maps/viewer";
    expect((await GET(new NextRequest(url), c)).status).toBe(401);
    const headers = { Authorization: `Bearer ${signAccessToken(admin())}` };
    expect((await GET(new NextRequest(url, { headers }), c)).status).toBe(404);
    setup();
    const r = await GET(new NextRequest(url, { headers }), c);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toContain("no-store");
    expect((await r.json()).plots).toHaveLength(8);
  });
});
describe("browser-safe viewer interactions", () => {
  const p: ViewerPlot = {
    id: "p1",
    elementId: "pm-1",
    number: "A-12",
    block: "North",
    phase: null,
    street: null,
    status: "available",
    rings: [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
    ],
    fillRule: "nonzero",
    centroid: [5, 5],
    bbox: [0, 0, 10, 10],
    area: { value: 5, unit: "marla", source: "official", filterValue: 1361.25 },
    dimensions: { text: "30 × 45 ft", source: "official" },
    facing: "North",
    corner: true,
    category: "residential",
    priceMinor: 123456,
    currency: "PKR",
  };
  it("finds exact plot number case-insensitively without substring ambiguity", () => {
    expect(findPlot([p], " a-12 ")).toBe(p);
    expect(findPlot([p], "12")).toBeNull();
  });
  it("status counters include all six statuses including zero", () => {
    const counts = statusCounts([p, { ...p, id: "p2", status: "sold" }]);
    expect(counts.available).toBe(1);
    expect(counts.sold).toBe(1);
    expect(counts.booked).toBe(0);
    expect(Object.keys(counts)).toHaveLength(6);
    expect(plotStatuses).toHaveLength(6);
  });
  it("filters status/block/facing/corner cumulatively", () => {
    expect(
      matchesMapFilters(p, {
        ...emptyMapFilters,
        status: "available",
        block: "North",
        facing: "North",
        corner: "yes",
      }),
    ).toBe(true);
    expect(matchesMapFilters(p, { ...emptyMapFilters, status: "sold" })).toBe(
      false,
    );
    expect(
      matchesMapFilters(
        { ...p, corner: null },
        { ...emptyMapFilters, corner: "no" },
      ),
    ).toBe(false);
  });
  it("uses common calibrated area unit and minor-unit-safe major price ranges", () => {
    expect(
      matchesMapFilters(p, {
        ...emptyMapFilters,
        minArea: "1000",
        maxArea: "1400",
        minPrice: "1234.56",
        maxPrice: "1234.56",
      }),
    ).toBe(true);
    expect(matchesMapFilters(p, { ...emptyMapFilters, maxArea: "1000" })).toBe(
      false,
    );
    expect(
      matchesMapFilters(p, { ...emptyMapFilters, minPrice: "1234.57" }),
    ).toBe(false);
    expect(
      matchesMapFilters(
        { ...p, priceMinor: null },
        { ...emptyMapFilters, minPrice: "0" },
      ),
    ).toBe(false);
  });
  it.each([
    { minArea: "-1" },
    { minArea: "NaN" },
    { minPrice: "Infinity" },
    { minArea: "4", maxArea: "3" },
    { minPrice: "100", maxPrice: "1" },
  ])("reports invalid ranges %j", (change) => {
    expect(validateMapFilters({ ...emptyMapFilters, ...change })).toBeTruthy();
  });
  it("accepts valid inclusive range zero", () => {
    expect(
      validateMapFilters({ ...emptyMapFilters, minPrice: "0", maxPrice: "0" }),
    ).toBeNull();
  });
  it("keeps pointer world coordinate anchored during zoom with clamped limits", () => {
    const a = zoomAt({ ...fitCamera }, 2, [100, 80]);
    expect(a).toEqual({ scale: 2, x: -100, y: -80 });
    expect(zoomAt(a, 1, [100, 80])).toEqual(fitCamera);
    expect(zoomAt(a, 100, [0, 0]).scale).toBe(32);
    expect(zoomAt(a, 0.01, [0, 0]).scale).toBe(1);
  });
  it("fits nonzero-origin SVG viewBoxes and prevents impossible panning", () => {
    const c = cameraForPlot([-50, -25, 0, 25], [-100, -50, 400, 200], 800, 400);
    expect(c.scale).toBeGreaterThan(1);
    expect(Number.isFinite(c.x + c.y)).toBe(true);
    expect(cameraForPlot([0, 0, 1, 1], [0, 0, 100, 100], 0, 0)).toEqual(
      fitCamera,
    );
    const b = constrainCamera({ scale: 100, x: 1e9, y: -1e9 }, 500, 300);
    expect(b.scale).toBe(32);
    expect(b.x).toBe(468);
    expect(b.y).toBe(32 - 300 * 32);
  });
  it.each([
    [390, 844],
    [1440, 900],
    [375, 260],
  ])("keeps tooltip inside viewport %j", (w, h) => {
    for (const point of [
      [0, 0],
      [w - 1, h - 1],
      [w / 2, h / 2],
    ] as [number, number][]) {
      const [x, y] = tooltipPosition(
        point,
        [Math.min(300, w - 24), Math.min(220, h - 24)],
        [w, h],
      );
      expect(x).toBeGreaterThanOrEqual(12);
      expect(y).toBeGreaterThanOrEqual(12);
      expect(x + Math.min(300, w - 24)).toBeLessThanOrEqual(w - 12);
      expect(y + Math.min(220, h - 24)).toBeLessThanOrEqual(h - 12);
    }
  });
  it("spatial arrow navigation skips plots behind the current one", () => {
    const right = { ...p, id: "r", centroid: [25, 5] as [number, number] },
      left = { ...p, id: "l", centroid: [-10, 5] as [number, number] },
      down = { ...p, id: "d", centroid: [5, 25] as [number, number] };
    expect(directionalPlot(p, [p, left, right, down], "ArrowRight")?.id).toBe(
      "r",
    );
    expect(directionalPlot(p, [p, left, right, down], "ArrowDown")?.id).toBe(
      "d",
    );
    expect(
      directionalPlot(p, [p, left, right, down], "ArrowUp"),
    ).toBeUndefined();
  });
  it("produces non-color ARIA labels and preserves compound path boundaries", () => {
    expect(plotAriaLabel(p)).toContain("5 marla (official), Available");
    expect(
      pathFor([
        [
          [0, 0],
          [1, 0],
          [1, 1],
        ],
        [
          [0.2, 0.2],
          [0.4, 0.2],
          [0.4, 0.4],
        ],
      ]).match(/Z/g),
    ).toHaveLength(2);
  });
});
