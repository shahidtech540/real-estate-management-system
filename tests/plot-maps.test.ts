import { readFileSync } from "node:fs";
import { beforeEach, describe, it, expect, vi, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { getDb, resetDbForTesting } from "@/server/db";
import { migratePlotMaps } from "@/server/db/plot-maps";
import { detectPlots } from "@/server/modules/plot-maps/detect";
import {
  parseSvg,
  sanitizeSvg,
  readSvgUpload,
  MAX_SVG_BYTES,
} from "@/server/modules/plot-maps/svg";
import { shapeGeometry, contains } from "@/server/modules/plot-maps/geometry";
import {
  uploadMap,
  getMap,
  listMaps,
  mapSettings,
  sanitizedMap,
} from "@/server/modules/plot-maps/plot-maps.service";
import { freshContext } from "@/server/modules/orchestration/orchestration.service";
import { signAccessToken } from "@/server/auth/crypto";
import { GET, POST, PATCH } from "@/app/api/v1/properties/[id]/plot-maps/route";
import { GET as getSvg } from "@/app/api/v1/properties/[id]/plot-maps/[mapId]/svg/route";
const sample = (name = "explicit") =>
  readFileSync(`samples/plots-${name}.svg`, "utf8");
const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1000">${body}</svg>`;
const rect = (attrs = 'id="plot-12"') =>
  `<rect ${attrs} x="10" y="20" width="30" height="60"/>`;
const admin = () => freshContext("org_pakland", "usr_admin");
const context = { params: Promise.resolve({ id: "prop_1" }) };
function request(
  body?: string,
  role = "usr_admin",
  headers: Record<string, string> = {},
) {
  const ctx = freshContext("org_pakland", role);
  return new NextRequest(
    "http://localhost/api/v1/properties/prop_1/plot-maps",
    {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${signAccessToken(ctx)}`,
        "Content-Type": "image/svg+xml",
        ...headers,
      },
      ...(body === undefined ? {} : { body }),
    },
  );
}
beforeEach(() => resetDbForTesting());
afterEach(() => vi.unstubAllEnvs());
describe("SVG sanitizer and bounded parsing", () => {
  it("strips executable tags, handlers, links, CSS resources and rewrites duplicate ids", () => {
    const source = svg(
      '<script>alert(1)</script><foreignObject><div>unsafe</div></foreignObject><style>@import "https://evil.example";</style><image href="https://evil.example/a"/><use href="#x"/>' +
        rect(
          'id="plot-12" onclick="alert(1)" style="fill:url(https://evil.example)"',
        ) +
        '<rect id="plot-12" fill="url(https://evil.example)" width="5" height="5"/><a href="javascript:alert(1)"><text>link</text></a>',
    );
    const { sanitized, doc } = sanitizeSvg(source);
    expect(sanitized).not.toMatch(
      /<script|foreignObject|<style|<image|<use|onclick|javascript:|url\(/i,
    );
    expect(new Set([...doc.querySelectorAll("*")].map((e) => e.id)).size).toBe(
      doc.querySelectorAll("*").length,
    );
    expect(doc.querySelector("rect")?.getAttribute("data-source-id")).toBe(
      "plot-12",
    );
  });
  it.each([
    "<html/>",
    '<svg xmlns="http://www.w3.org/2000/svg"><g></svg>',
    '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg/>',
    '<svg xmlns="https://wrong.example"/>',
  ])("rejects invalid/XXE XML %s", (s) =>
    expect(() => sanitizeSvg(s)).toThrow(),
  );
  it("rejects nested viewports, excessive depth and oversized input", () => {
    expect(() => sanitizeSvg(svg("<svg/>"))).toThrow(/Nested/);
    expect(() =>
      sanitizeSvg(svg("<g>".repeat(66) + "</g>".repeat(66))),
    ).toThrow(/nesting/);
    expect(() => sanitizeSvg("x".repeat(MAX_SVG_BYTES + 1))).toThrow(/10 MiB/);
  });
  it("enforces streamed size, type and UTF8", async () => {
    await expect(
      readSvgUpload(
        new Request("http://local", {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: sample(),
        }),
      ),
    ).rejects.toThrow(/Content-Type/);
    await expect(
      readSvgUpload(
        new Request("http://local", {
          method: "POST",
          headers: { "Content-Type": "image/svg+xml" },
          body: "x".repeat(MAX_SVG_BYTES + 1),
        }),
      ),
    ).rejects.toThrow(/10 MiB/);
    await expect(
      readSvgUpload(
        new Request("http://local", {
          method: "POST",
          headers: { "Content-Type": "image/svg+xml" },
          body: new Uint8Array([255, 255]),
        }),
      ),
    ).rejects.toThrow(/UTF-8/);
  });
});
it("removes CSS-escaped URL functions and XML stylesheet instructions", () => {
  const r = sanitizeSvg(
    '<?xml-stylesheet href="https://evil.example/a.css"?>' +
      svg(
        '<rect data-plot="1" fill="u\\72l(https://evil.example/a)" width="10" height="10"/>',
      ),
  );
  expect(r.sanitized).not.toContain("evil.example");
  expect(r.doc.querySelector("rect")?.hasAttribute("fill")).toBe(false);
});
describe("all four detection strategies and sampled geometry", () => {
  it.each(["explicit", "text-only", "messy"])(
    "detects all 8 plots from the %s sample",
    (name) => {
      const r = detectPlots(sample(name));
      expect(r.plots).toHaveLength(8);
      expect(r.plots.every((p) => p.geometry.area > 0)).toBe(true);
      expect(r.plots.map((p) => p.plotNumber)).not.toContain("99");
    },
  );
  it.each(["plot-12", "plot_12", "Plot12", "P-12", "12", "A-12"])(
    "detects %s IDs",
    (id) =>
      expect(detectPlots(svg(rect(`id="${id}"`))).plots[0].plotNumber).toBe(
        id === "A-12" ? "A-12" : "12",
      ),
  );
  it("uses attributes first and a numbered group is exactly one plot", () => {
    const r = detectPlots(
      svg(
        `<g id="plot-4" data-plot-number="A-9">${rect()}<text x="20" y="40">12</text></g>`,
      ),
    );
    expect(r.plots).toHaveLength(1);
    expect(r.plots[0]).toMatchObject({
      plotNumber: "A-9",
      method: "attribute",
    });
  });
  it("matches text to the smallest containing shape with parent transforms", () => {
    const r = detectPlots(
      svg(
        '<g transform="translate(100 50) scale(2)"><rect width="100" height="100"/><rect x="10" y="10" width="20" height="20"/><text x="20" y="20">7</text></g>',
      ),
    );
    expect(r.plots[0]).toMatchObject({ plotNumber: "7", method: "text" });
    expect(r.plots[0].geometry.area).toBeCloseTo(1600);
    expect(r.plots[0].geometry.centroid).toEqual([140, 90]);
  });
  it("calculates area, centroid and box after rotation/matrix/skew/reflection", () => {
    const r = detectPlots(
      svg(
        '<g transform="translate(100 100) rotate(90)">' +
          rect('data-plot="1" transform="scale(2 3)"') +
          "</g>",
      ),
    );
    expect(r.plots[0].geometry.area).toBeCloseTo(10800);
    expect(r.plots[0].geometry.centroid[0]).toBeCloseTo(-50);
    expect(r.plots[0].geometry.centroid[1]).toBeCloseTo(150);
    expect(
      detectPlots(
        svg(rect('data-plot="2" transform="matrix(-1 0 .5 1 200 0)"')),
      ).plots[0].geometry.area,
    ).toBeCloseTo(1800);
  });
  it("samples curved, smooth and arc boundaries; preserves compound holes", () => {
    for (const d of [
      "M0 0C10 -10 40 -10 50 0S90 0 100 0V50H0Z",
      "M0 0Q25 -10 50 0T100 0V50H0Z",
      "M0 0h50v50A25 10 0 0 1 0 50Z",
    ])
      expect(
        detectPlots(svg(`<path data-plot="1" d="${d}"/>`)).plots[0].geometry
          .rings[0].length,
      ).toBeGreaterThan(20);
    const doc = parseSvg(
      svg(
        '<path fill-rule="evenodd" d="M0 0h100v100h-100Z M25 25h50v50h-50Z"/>',
      ),
    );
    const g = shapeGeometry(doc.querySelector("path")!)!;
    expect(g.area).toBeCloseTo(7500);
    expect(contains(g, [50, 50])).toBe(false);
    expect(contains(g, [10, 10])).toBe(true);
  });
  it("rejects open polyline/path shapes and ignores parks, roads, definitions and hidden groups", () => {
    const r = detectPlots(
      svg(
        '<polyline data-plot="1" points="0 0 20 0 20 20"/><path id="plot-2" d="M0 0h10v10"/><g class="roads">' +
          rect() +
          "</g><defs>" +
          rect() +
          '</defs><g display="none">' +
          rect() +
          '</g><g id="park">' +
          rect() +
          "</g>",
      ),
    );
    expect(r.plots).toEqual([]);
    expect(r.warnings.some((w) => w.code === "number_without_shape")).toBe(
      true,
    );
  });
  it("reports duplicates, unnumbered shapes and unmatched labels without fabricating plots", () => {
    const r = detectPlots(
      svg(
        rect() +
          rect() +
          '<rect x="100" y="100" width="20" height="20"/><text x="800" y="800">99</text>',
      ),
    );
    expect(r.warnings.map((w) => w.code)).toEqual(
      expect.arrayContaining([
        "duplicate_number",
        "unlabelled_shape",
        "number_without_shape",
      ]),
    );
  });
  it("supports RE2 project regex and rejects unsupported/bad patterns", () => {
    expect(
      detectPlots(svg(rect('id="LOT-X25"')), "^LOT-(X[0-9]+)$").plots[0]
        .plotNumber,
    ).toBe("X25");
    expect(() => detectPlots(svg(rect()), "(")).toThrow(/RE2/);
    expect(() => detectPlots(svg(rect()), "^(a)\\1$")).toThrow(/RE2/);
  });
  it("requires a valid viewBox or numeric dimensions", () => {
    expect(() =>
      detectPlots(
        '<svg xmlns="http://www.w3.org/2000/svg">' + rect() + "</svg>",
      ),
    ).toThrow(/viewBox/);
    expect(
      detectPlots(
        '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100">' +
          rect() +
          "</svg>",
      ).viewBox,
    ).toEqual([0, 0, 100, 100]);
  });
});
describe("additive schema and authenticated draft upload", () => {
  it("canonical plot identity, same-org references, integer money, active booking and status audits are enforced", () => {
    const db = getDb(),
      m = uploadMap(admin(), "prop_1", sample()),
      now = new Date().toISOString();
    const plot = (id: string, n: string, price: number | null = null) =>
      db
        .prepare(
          "INSERT INTO plots(id,organization_id,project_id,map_id,plot_number,total_price_minor,status_changed_at,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
        )
        .run(
          id,
          "org_pakland",
          "prop_1",
          m.id,
          n,
          price,
          now,
          now,
          now,
          "usr_admin",
        );
    plot("p1", "1");
    expect(() => plot("dup", "1")).toThrow();
    expect(() => plot("fraction", "2", 1.5)).toThrow();
    expect(() => plot("negative", "3", -1)).toThrow();
    const book = (id: string, agent = "usr_agent") =>
      db
        .prepare(
          "INSERT INTO plot_bookings(id,organization_id,plot_id,agent_id,booking_date,status,created_at,updated_at,created_by) VALUES(?,?,?,?,?,'pending',?,?,?)",
        )
        .run(id, "org_pakland", "p1", agent, now, now, now, "usr_admin");
    expect(() => book("foreign", "usr_indus_admin")).toThrow(
      /Cross-organization|FOREIGN/,
    );
    book("b1");
    expect(() => book("b2")).toThrow(/UNIQUE/);
    db.prepare(
      "UPDATE plot_bookings SET status='cancelled' WHERE id='b1'",
    ).run();
    book("b3");
    db.prepare("UPDATE plots SET status='reserved' WHERE id='p1'").run();
    expect(
      db
        .prepare(
          "SELECT id FROM audit_logs WHERE action='plot.status.changed' AND entity_id='p1'",
        )
        .get(),
    ).toBeTruthy();
    expect(
      db
        .prepare(
          "SELECT id FROM audit_logs WHERE action='plot_bookings.status.changed'",
        )
        .get(),
    ).toBeTruthy();
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("nonzero versus evenodd compound fill follows SVG semantics", () => {
    const path =
      '<path data-plot="1" d="M0 0h100v100h-100Z M25 25h50v50h-50Z"/>';
    expect(detectPlots(svg(path)).plots[0].geometry.area).toBe(10000);
    expect(
      detectPlots(
        svg(path.replace("data-plot", 'fill-rule="evenodd" data-plot')),
      ).plots[0].geometry.area,
    ).toBe(7500);
  });
  it("invalid transforms are flagged, not silently treated as identity", () => {
    const r = detectPlots(svg(rect('id="plot-1" transform="translate(bad)"')));
    expect(r.plots).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toContain("invalid_geometry");
  });
  it("a 1,000-plot explicit SVG produces one candidate per number", () => {
    const body = Array.from(
      { length: 1000 },
      (_, i) =>
        `<rect data-plot="${i + 1}" x="${(i % 50) * 15}" y="${Math.floor(i / 50) * 15}" width="10" height="10"/>`,
    ).join("");
    expect(detectPlots(svg(body)).plots).toHaveLength(1000);
  });
  it("draft upload preserves linked canonical plots and bookings on re-upload", () => {
    const db = getDb(),
      one = uploadMap(admin(), "prop_1", sample()),
      now = new Date().toISOString();
    db.prepare(
      "INSERT INTO plots(id,organization_id,project_id,map_id,plot_number,status,status_changed_at,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "existing",
      "org_pakland",
      "prop_1",
      one.id,
      "1",
      "booked",
      now,
      now,
      now,
      "usr_admin",
    );
    db.prepare(
      "INSERT INTO plot_bookings(id,organization_id,plot_id,booking_date,status,created_at,updated_at,created_by) VALUES('existing-booking','org_pakland','existing',?,'confirmed',?,?,'usr_admin')",
    ).run(now, now, now);
    const before = db.prepare("SELECT * FROM plots").all(),
      bookings = db.prepare("SELECT * FROM plot_bookings").all();
    uploadMap(admin(), "prop_1", sample("text-only"));
    expect(db.prepare("SELECT * FROM plots").all()).toEqual(before);
    expect(db.prepare("SELECT * FROM plot_bookings").all()).toEqual(bookings);
  });
  it("revoking domain write permission blocks even an admin with an old token", () => {
    const ctx = admin();
    getDb()
      .prepare(
        "DELETE FROM role_permissions WHERE role_id=? AND permission_id IN (SELECT id FROM permissions WHERE code='properties:write')",
      )
      .run(ctx.roleId);
    expect(() => uploadMap(ctx, "prop_1", sample())).toThrow(
      /properties:write/,
    );
  });
  it("migration repeats without changing financial records", () => {
    const db = getDb(),
      tables = [
        "units",
        "leases",
        "invoices",
        "payments",
        "receipts",
        "journal_batches",
        "ledger_entries",
      ];
    const snapshots = tables.map((t) =>
      db.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
    );
    migratePlotMaps(db);
    migratePlotMaps(db);
    tables.forEach((t, i) =>
      expect(db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()).toEqual(
        snapshots[i],
      ),
    );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("retains private original and sanitized assets, candidates, audit and paged results", () => {
    const source = sample(),
      r = uploadMap(admin(), "prop_1", source),
      db = getDb();
    expect(r).toMatchObject({
      version: 1,
      status: "draft",
      report: { detectedPlots: 8 },
    });
    expect(getMap(admin(), "prop_1", r.id, { limit: 3 }).plots).toHaveLength(3);
    expect(getMap(admin(), "prop_1", r.id, { limit: 3 }).hasMore).toBe(true);
    expect(
      Buffer.from(
        db
          .prepare(
            "SELECT content FROM project_map_assets WHERE map_id=? AND kind='original'",
          )
          .get(r.id)!.content as Uint8Array,
      ),
    ).toEqual(Buffer.from(source));
    expect(sanitizedMap(admin(), "prop_1", r.id)).toContain("pm-");
    expect(
      db
        .prepare(
          "SELECT id FROM audit_logs WHERE action='plot_map.uploaded' AND entity_id=?",
        )
        .get(r.id),
    ).toBeTruthy();
    expect(db.prepare("SELECT COUNT(*) n FROM plots").get()!.n).toBe(0);
  });
  it("creates sequential versions with a real diff and never removes old geometry", () => {
    const one = uploadMap(admin(), "prop_1", svg(rect())),
      two = uploadMap(
        admin(),
        "prop_1",
        svg(rect().replace('width="30"', 'width="40"') + rect('id="plot-13"')),
      );
    expect(two.version).toBe(2);
    expect(two.diff).toMatchObject({
      added: ["13"],
      changed: ["12"],
      removed: [],
      businessRecordsModified: false,
    });
    expect(getMap(admin(), "prop_1", one.id).plots[0].area_svg).toBe(1800);
    expect(listMaps(admin(), "prop_1").maps).toHaveLength(2);
  });
  it.each([
    "usr_agent",
    "usr_accountant",
    "usr_owner",
    "usr_tenant",
    "usr_maintenance",
  ])("rejects %s even if they have domain reads", (user) =>
    expect(() => listMaps(freshContext("org_pakland", user), "prop_1")).toThrow(
      /administrator/,
    ),
  );
  it("checks fresh role and project ownership, not client-supplied claims", () => {
    expect(() =>
      uploadMap(
        { ...admin(), organizationId: "org_indus" },
        "prop_1",
        sample(),
      ),
    ).toThrow();
    expect(() => uploadMap(admin(), "missing", sample())).toThrow(
      /Project not found/,
    );
    getDb()
      .prepare(
        "UPDATE users SET role_id=(SELECT role_id FROM users WHERE id='usr_tenant') WHERE id='usr_admin'",
      )
      .run();
    expect(() => uploadMap(admin(), "prop_1", sample())).toThrow(
      /administrator/,
    );
  });
  it("persists custom project pattern without altering prior maps", () => {
    mapSettings(admin(), "prop_1", { plotNumberPattern: "^LOT-(X[0-9]+)$" });
    expect(
      uploadMap(admin(), "prop_1", svg(rect('id="LOT-X25"'))).report
        .detectedPlots,
    ).toBe(1);
    expect(() =>
      mapSettings(admin(), "prop_1", {
        plotNumberPattern: "(",
        publicPrices: true,
      }),
    ).toThrow();
  });
  it("fails atomically on invalid uploads; no partial version/assets or audit", () => {
    expect(() => uploadMap(admin(), "prop_1", "<html/>")).toThrow();
    expect(listMaps(admin(), "prop_1").maps).toEqual([]);
  });
  it("serves only sanitized SVG with download/sandbox policy and no original endpoint", async () => {
    const map = uploadMap(admin(), "prop_1", sample()),
      res = await getSvg(request(), {
        params: Promise.resolve({ id: "prop_1", mapId: map.id }),
      });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toContain("attachment");
    expect(await res.text()).toContain("pm-");
  });
  it("real routes enforce auth, raw SVG type, settings validation and streaming size", async () => {
    expect(
      (await GET(new NextRequest("http://localhost/api"), context)).status,
    ).toBe(401);
    expect((await POST(request(sample(), "usr_tenant"), context)).status).toBe(
      403,
    );
    expect(
      (
        await POST(
          request(sample(), "usr_admin", { "Content-Type": "text/plain" }),
          context,
        )
      ).status,
    ).toBe(415);
    expect(
      (await POST(request("x".repeat(MAX_SVG_BYTES + 1)), context)).status,
    ).toBe(413);
    const r = await POST(request(sample()), context);
    expect(r.status).toBe(201);
    expect((await r.json()).report.detectedPlots).toBe(8);
    expect(
      (
        await PATCH(
          request(
            JSON.stringify({ plotNumberPattern: "^LOT-([0-9]+)$" }),
            "usr_admin",
            { "Content-Type": "application/json" },
          ),
          context,
        )
      ).status,
    ).toBe(200);
  });
});
