import { createHash } from "node:crypto";
import type { SQLOutputValue } from "node:sqlite";
import clipping from "polygon-clipping";
import { z } from "zod";
import { getDb } from "@/server/db";
import { HttpError } from "@/server/auth/guards";
import type { JwtPayload } from "@/server/auth/crypto";
import { atomic, newId, nowIso, valid, moneySchema } from "../shared/domain";
import { recordAuditLog } from "../audit/audit.service";
import { access, sanitizedMap } from "./plot-maps.service";
import { parseSvg } from "./svg";
import { shapeGeometry, measure, type Geometry, type Point } from "./geometry";
import {
  areas,
  calibrationSchema,
  dimensions,
  fromPolygons,
  polygons,
  roadHints,
  scaleFrom,
  type Scale,
} from "./measurements";
import { exportCsv, parseCsv } from "./csv";
type Row = Record<string, SQLOutputValue>;
const number = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{0,63}$/);
const text = z.string().max(200).nullable();
export const plotDataSchema = z
  .object({
    block: text.optional(),
    phase: text.optional(),
    street: text.optional(),
    area_official: z.number().positive().max(1e15).nullable().optional(),
    area_unit: z.enum(["sqft", "sqm", "marla", "kanal"]).optional(),
    dimensions_official: z.string().max(500).nullable().optional(),
    facing: text.optional(),
    is_corner: z.number().int().min(0).max(1).nullable().optional(),
    category: z.enum(["residential", "commercial"]).nullable().optional(),
    price_per_unit_minor: moneySchema.nullable().optional(),
    total_price_minor: moneySchema.nullable().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
    status: z
      .enum(["available", "reserved", "booked", "sold", "resale", "blocked"])
      .optional(),
  })
  .strict();
const editSchema = z.discriminatedUnion("action", [
  z
    .object({
      action: z.literal("calibrate"),
      revision: z.number().int().nonnegative(),
      calibration: calibrationSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("assign"),
      revision: z.number().int().nonnegative(),
      elementId: z.string().max(100),
      plotNumber: number,
    })
    .strict(),
  z
    .object({
      action: z.literal("exclude"),
      revision: z.number().int().nonnegative(),
      elementIds: z.array(z.string().max(100)).min(1).max(500),
    })
    .strict(),
  z
    .object({
      action: z.literal("bulk"),
      revision: z.number().int().nonnegative(),
      elementIds: z.array(z.string().max(100)).min(1).max(500),
      data: plotDataSchema,
    })
    .strict(),
  z
    .object({
      action: z.literal("merge"),
      revision: z.number().int().nonnegative(),
      elementIds: z.array(z.string().max(100)).min(2).max(50),
      plotNumber: number,
    })
    .strict(),
  z
    .object({
      action: z.literal("split"),
      revision: z.number().int().nonnegative(),
      elementId: z.string().max(100),
      axis: z.enum(["x", "y"]),
      at: z.number().finite().min(-1e9).max(1e9),
      numbers: z.tuple([number, number]),
    })
    .strict(),
]);
function fail(code: string, message: string, status = 400): never {
  throw new HttpError(status, code, message);
}
function mapRow(ctx: JwtPayload, projectId: string, mapId: string) {
  const m = getDb()
    .prepare(
      "SELECT * FROM project_maps WHERE id=? AND organization_id=? AND project_id=?",
    )
    .get(mapId, ctx.organizationId, projectId);
  if (!m) fail("MAP_NOT_FOUND", "Map not found.", 404);
  return m;
}
function rows(ctx: JwtPayload, mapId: string) {
  return getDb()
    .prepare(
      "SELECT * FROM map_plot_geometries WHERE organization_id=? AND map_id=? ORDER BY plot_number,id",
    )
    .all(ctx.organizationId, mapId);
}
function geometry(r: Row): Geometry {
  const rings = JSON.parse(String(r.polygon_points)) as Point[][];
  let fillRule: Geometry["fillRule"] =
    r.fill_rule === "evenodd" ? "evenodd" : "nonzero";
  // Phase A stored filled area but no rule. Infer only when upgrading old rows.
  if (r.fill_rule == null) {
    const n = measure(rings, "nonzero"),
      e = measure(rings, "evenodd");
    if (
      e &&
      Math.abs(e.area - Number(r.area_svg)) < 1e-6 &&
      (!n || Math.abs(n.area - Number(r.area_svg)) > 1e-6)
    )
      fillRule = "evenodd";
  }
  const raw: Geometry = {
    rings,
    area: Number(r.area_svg),
    centroid: JSON.parse(String(r.centroid)),
    bbox: JSON.parse(String(r.bounding_box)),
    fillRule,
  };
  return rings.length > 1 ? fromPolygons(polygons(raw)) || raw : raw;
}
function canonical(ctx: JwtPayload, projectId: string) {
  return getDb()
    .prepare("SELECT * FROM plots WHERE organization_id=? AND project_id=?")
    .all(ctx.organizationId, projectId);
}
function protectedPlot(ctx: JwtPayload, p: Row) {
  return (
    !["available", "blocked"].includes(String(p.status)) ||
    [
      "plot_bookings",
      "plot_sales",
      "plot_ownership_history",
      "resale_listings",
    ].some((t) =>
      Boolean(
        getDb()
          .prepare(
            `SELECT id FROM ${t} WHERE organization_id=? AND plot_id=? LIMIT 1`,
          )
          .get(ctx.organizationId, p.id),
      ),
    )
  );
}
function baseData(p: Row | undefined) {
  return p
    ? Object.fromEntries(
        Object.keys(plotDataSchema.shape)
          .filter((k) => p[k] !== null && p[k] !== undefined)
          .map((k) => [k, p[k]]),
      )
    : {};
}
function effective(r: Row, old: Row[]) {
  return {
    ...baseData(old.find((p) => p.plot_number === r.plot_number)),
    ...JSON.parse(String(r.review_json)),
  } as z.infer<typeof plotDataSchema>;
}
function assertDraft(m: Row, revision: number) {
  if (m.status !== "draft")
    fail("MAP_READ_ONLY", "Only a draft may be changed.", 409);
  if (Number(m.revision) !== revision)
    fail(
      "STALE_MAP",
      "Another editor changed this map. Reload before saving.",
      409,
    );
}
function audit(
  ctx: JwtPayload,
  id: string,
  action: string,
  metadata: Record<string, unknown>,
) {
  recordAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.sub,
    entityType: action.startsWith("plot.") ? "plot" : "project_map",
    entityId: id,
    action,
    metadata,
  });
}
function bump(ctx: JwtPayload, id: string) {
  getDb()
    .prepare(
      "UPDATE project_maps SET revision=revision+1,updated_at=? WHERE id=? AND organization_id=?",
    )
    .run(nowIso(), id, ctx.organizationId);
}
function storeGeometry(
  ctx: JwtPayload,
  m: Row,
  elementId: string,
  n: string,
  g: Geometry,
  method = "manual",
  metadata: unknown = {},
) {
  const db = getDb(),
    now = nowIso(),
    hash = createHash("sha256")
      .update(JSON.stringify({ rings: g.rings, fillRule: g.fillRule }))
      .digest("hex");
  if (g.rings.flat().length > 10000 || g.area <= 0 || !Number.isFinite(g.area))
    fail("GEOMETRY_LIMIT", "Invalid or overly complex edited geometry.");
  db.prepare(
    `INSERT INTO map_plot_geometries(id,organization_id,project_id,map_id,plot_number,svg_element_id,detection_method,confidence,polygon_points,centroid,bounding_box,area_svg,geometry_hash,created_at,updated_at,created_by,fill_rule,review_json)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(organization_id,map_id,svg_element_id) DO UPDATE SET plot_number=excluded.plot_number,excluded=0,updated_at=excluded.updated_at`,
  ).run(
    newId("geometry"),
    ctx.organizationId,
    m.project_id,
    m.id,
    n,
    elementId,
    method,
    1,
    JSON.stringify(g.rings),
    JSON.stringify(g.centroid),
    JSON.stringify(g.bbox),
    g.area,
    hash,
    now,
    now,
    ctx.sub,
    g.fillRule,
    JSON.stringify(metadata),
  );
}
function appendPath(ctx: JwtPayload, m: Row, g: Geometry) {
  const doc = parseSvg(sanitizedMap(ctx, String(m.project_id), String(m.id))),
    id = newId("pm-edit"),
    p = doc.createElementNS("http://www.w3.org/2000/svg", "path");
  const d = g.rings
    .map((r) => "M" + r.map((p) => p.join(" ")).join("L") + "Z")
    .join(" ");
  if (d.length > 100000)
    fail("GEOMETRY_LIMIT", "Edited outline exceeds path complexity limit.");
  p.setAttribute("id", id);
  p.setAttribute("d", d);
  p.setAttribute("fill-rule", "evenodd");
  p.setAttribute("fill", "#dbeafe");
  p.setAttribute("stroke", "#475569");
  doc.documentElement.appendChild(p);
  const source = doc.documentElement.outerHTML;
  if (Buffer.byteLength(source) > 10 * 1024 * 1024)
    fail("SVG_SIZE", "Edited SVG exceeds 10 MiB.");
  getDb()
    .prepare(
      "UPDATE project_map_assets SET content=? WHERE organization_id=? AND map_id=? AND kind='sanitized'",
    )
    .run(Buffer.from(source), ctx.organizationId, m.id);
  return id;
}
function sourceGeometry(ctx: JwtPayload, m: Row, id: string) {
  const doc = parseSvg(sanitizedMap(ctx, String(m.project_id), String(m.id))),
    el = doc.getElementById(id);
  if (!el) fail("SHAPE_NOT_FOUND", "Select a shape in this sanitized map.");
  for (let p: Element | null = el; p; p = p.parentElement)
    if (
      ["defs", "clipPath", "mask", "symbol", "pattern"].includes(p.localName) ||
      p.getAttribute("display") === "none" ||
      p.getAttribute("visibility") === "hidden"
    )
      fail(
        "SHAPE_HIDDEN",
        "Flatten hidden/definition shapes before assigning plots.",
      );
  const g =
    el.localName === "g"
      ? measure(
          [...el.querySelectorAll("path,polygon,rect,polyline")].flatMap(
            (s) => shapeGeometry(s)?.rings || [],
          ),
        )
      : shapeGeometry(el);
  if (!g) fail("SHAPE_INVALID", "This element is not a closed usable shape.");
  return g;
}
function validateData(
  ctx: JwtPayload,
  r: Row,
  data: z.infer<typeof plotDataSchema>,
  old: Row[],
) {
  const p = old.find((p) => p.plot_number === r.plot_number),
    status = data.status;
  if (
    status &&
    status !== p?.status &&
    !["available", "blocked"].includes(status)
  )
    fail(
      "STATUS_WORKFLOW",
      "Booking/sale/resale statuses must use their dedicated future workflow, not review/CSV.",
    );
  if (p && protectedPlot(ctx, p) && status && status !== p.status)
    fail(
      "PROTECTED_PLOT",
      "Cannot change the status of a plot with business history in map review.",
    );
}
function bindUnit(
  ctx: JwtPayload,
  m: Row,
  r: Row,
  data: z.infer<typeof plotDataSchema>,
  old: Row[],
) {
  if (
    (data.area_official != null || data.price_per_unit_minor != null) &&
    !data.area_unit &&
    !effective(r, old).area_unit
  ) {
    const scale = m.scale_config
      ? (JSON.parse(String(m.scale_config)) as Scale)
      : null;
    return {
      ...data,
      area_unit: (scale?.areaUnit ||
        getDb()
          .prepare(
            "SELECT area_unit FROM plot_area_settings WHERE organization_id=?",
          )
          .get(ctx.organizationId)?.area_unit ||
        "marla") as Scale["areaUnit"],
    };
  }
  return data;
}
export function editReview(
  ctx: JwtPayload,
  projectId: string,
  mapId: string,
  input: unknown,
) {
  const q = valid(editSchema, input);
  return atomic(() => {
    ctx = access(ctx, projectId);
    const m = mapRow(ctx, projectId, mapId);
    assertDraft(m, q.revision);
    const db = getDb(),
      all = rows(ctx, mapId),
      old = canonical(ctx, projectId);
    if (q.action === "calibrate") {
      const scale = scaleFrom(q.calibration);
      if (
        !Number.isFinite(scale.ratio) ||
        scale.ratio < 1e-9 ||
        scale.ratio > 1e6
      )
        fail("SCALE_INVALID", "Scale ratio exceeds the supported range.");
      db.prepare(
        "UPDATE project_maps SET scale_config=? WHERE id=? AND organization_id=?",
      ).run(JSON.stringify(scale), mapId, ctx.organizationId);
      db.prepare(
        "INSERT INTO plot_area_settings(organization_id,area_unit,marla_sqft,updated_at,created_by,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id) DO UPDATE SET area_unit=excluded.area_unit,marla_sqft=excluded.marla_sqft,updated_at=excluded.updated_at",
      ).run(
        ctx.organizationId,
        scale.areaUnit,
        scale.marlaSqFt,
        nowIso(),
        ctx.sub,
        nowIso(),
      );
    } else if (q.action === "assign") {
      const existing = all.find((r) => r.svg_element_id === q.elementId);
      if (existing) {
        db.prepare(
          "UPDATE map_plot_geometries SET plot_number=?,excluded=0,updated_at=? WHERE id=? AND organization_id=?",
        ).run(q.plotNumber, nowIso(), existing.id, ctx.organizationId);
      } else
        storeGeometry(
          ctx,
          m,
          q.elementId,
          q.plotNumber,
          sourceGeometry(ctx, m, q.elementId),
        );
    } else if (q.action === "split") {
      const r = all.find(
        (r) => r.svg_element_id === q.elementId && !r.excluded,
      );
      if (!r) fail("SHAPE_NOT_FOUND", "Select one active plot to split.");
      if (q.numbers[0] === q.numbers[1])
        fail("DUPLICATE_NUMBER", "Split plot numbers must differ.");
      const g = geometry(r),
        [x0, y0, x1, y1] = g.bbox,
        margin = Math.max(x1 - x0, y1 - y0, 1),
        index = q.axis === "x" ? 0 : 1;
      if (q.at <= g.bbox[index] || q.at >= g.bbox[index + 2])
        fail(
          "SPLIT_OUTSIDE",
          "Split coordinate must lie inside the plot bounds.",
        );
      const clip: Point[][] =
        q.axis === "x"
          ? [
              [
                [x0 - margin, y0 - margin],
                [q.at, y0 - margin],
                [q.at, y1 + margin],
                [x0 - margin, y1 + margin],
              ],
            ]
          : [
              [
                [x0 - margin, y0 - margin],
                [x1 + margin, y0 - margin],
                [x1 + margin, q.at],
                [x0 - margin, q.at],
              ],
            ];
      const a = fromPolygons(clipping.intersection(polygons(g), clip)),
        b = fromPolygons(clipping.difference(polygons(g), clip));
      if (!a || !b) fail("SPLIT_EMPTY", "Cut must create two nonempty plots.");
      db.prepare(
        "UPDATE map_plot_geometries SET excluded=1 WHERE id=? AND organization_id=?",
      ).run(r.id, ctx.organizationId);
      const inherited = JSON.parse(String(r.review_json));
      for (const key of [
        "area_official",
        "dimensions_official",
        "total_price_minor",
        "facing",
        "is_corner",
        "status",
      ])
        delete inherited[key];
      [a, b].forEach((part, i) =>
        storeGeometry(
          ctx,
          m,
          appendPath(ctx, m, part),
          q.numbers[i],
          part,
          "split",
          inherited,
        ),
      );
    } else {
      const ids = [...new Set(q.elementIds)],
        selected = ids.map((id) => all.find((r) => r.svg_element_id === id));
      if (q.action === "exclude") {
        for (const id of ids) {
          const r = all.find((r) => r.svg_element_id === id);
          if (!r) storeGeometry(ctx, m, id, "", sourceGeometry(ctx, m, id));
          db.prepare(
            "UPDATE map_plot_geometries SET excluded=1,updated_at=? WHERE organization_id=? AND map_id=? AND svg_element_id=?",
          ).run(nowIso(), ctx.organizationId, mapId, id);
        }
      } else {
        if (selected.some((r) => !r || r.excluded))
          fail("SHAPE_NOT_FOUND", "Select active plots from this draft.");
        const selectedRows = selected as Row[];
        if (q.action === "bulk")
          for (const r of selectedRows) {
            const data = bindUnit(ctx, m, r, q.data, old);
            validateData(ctx, r, data, old);
            db.prepare(
              "UPDATE map_plot_geometries SET review_json=?,updated_at=? WHERE id=? AND organization_id=?",
            ).run(
              JSON.stringify({
                ...JSON.parse(String(r.review_json)),
                ...data,
              }),
              nowIso(),
              r.id,
              ctx.organizationId,
            );
          }
        else {
          if (ids.length < 2)
            fail("MERGE_COUNT", "Select at least two different plots.");
          const g = fromPolygons(
            clipping.union(
              polygons(geometry(selectedRows[0])),
              ...selectedRows.slice(1).map((r) => polygons(geometry(r))),
            ),
          );
          if (!g) fail("MERGE_EMPTY", "Cannot merge empty shapes.");
          for (const r of selectedRows)
            db.prepare(
              "UPDATE map_plot_geometries SET excluded=1 WHERE id=? AND organization_id=?",
            ).run(r.id, ctx.organizationId);
          storeGeometry(
            ctx,
            m,
            appendPath(ctx, m, g),
            q.plotNumber,
            g,
            "merge",
          );
        }
      }
    }
    const active = rows(ctx, mapId).filter((r) => !r.excluded);
    if (
      active.length > 5000 ||
      active.reduce((n, r) => n + geometry(r).rings.flat().length, 0) >
        100000 ||
      rows(ctx, mapId).length > 10000
    )
      fail(
        "MAP_COMPLEXITY",
        "Review limit: 5,000 active plots / 100,000 points / 10,000 total candidates.",
      );
    bump(ctx, mapId);
    audit(ctx, mapId, `plot_map.review.${q.action}`, {
      revision: q.revision + 1,
      input: q,
    });
    return { revision: q.revision + 1 };
  });
}
function currentPublished(ctx: JwtPayload, projectId: string) {
  return (
    getDb()
      .prepare(
        "SELECT id FROM project_maps WHERE organization_id=? AND project_id=? AND status='published'",
      )
      .get(ctx.organizationId, projectId)?.id || null
  );
}
function diff(ctx: JwtPayload, projectId: string, active: Row[]) {
  const baselineMapId = currentPublished(ctx, projectId),
    baseline = baselineMapId
      ? rows(ctx, String(baselineMapId)).filter((r) => !r.excluded)
      : [],
    numbers = new Map(
      active.map((r) => [String(r.plot_number), String(r.geometry_hash)]),
    ),
    prev = new Map(
      baseline.map((r) => [String(r.plot_number), String(r.geometry_hash)]),
    );
  return {
    baselineMapId,
    added: [...numbers.keys()].filter((n) => !prev.has(n)),
    removed: [...prev.keys()].filter((n) => !numbers.has(n)),
    changed: [...numbers.keys()].filter(
      (n) => prev.has(n) && numbers.get(n) !== prev.get(n),
    ),
    unchanged: [...numbers.keys()].filter(
      (n) => numbers.get(n) === prev.get(n),
    ),
  };
}
function issues(
  ctx: JwtPayload,
  projectId: string,
  m: Row,
  all: Row[],
  old: Row[],
) {
  const active = all.filter((r) => !r.excluded),
    errors: { code: string; message: string }[] = [],
    warnings: { code: string; message: string; elementId?: string }[] = [];
  if (!m.scale_config)
    errors.push({
      code: "calibration_required",
      message: "Calibrate this map before publishing.",
    });
  if (!active.length)
    errors.push({
      code: "no_plots",
      message: "At least one active plot is required.",
    });
  const nums = new Set<string>();
  for (const r of active) {
    if (!number.safeParse(r.plot_number).success)
      errors.push({
        code: "missing_number",
        message: `Assign a valid number to ${r.svg_element_id}.`,
      });
    if (nums.has(String(r.plot_number)))
      errors.push({
        code: "duplicate_number",
        message: `Duplicate plot number ${r.plot_number}.`,
      });
    nums.add(String(r.plot_number));
    try {
      validateData(ctx, r, effective(r, old), old);
    } catch (e) {
      errors.push({
        code: "protected_status",
        message: e instanceof Error ? e.message : "Invalid status",
      });
    }
  }
  for (const p of old)
    if (
      !p.deleted_at &&
      !nums.has(String(p.plot_number)) &&
      protectedPlot(ctx, p)
    )
      errors.push({
        code: "protected_removal",
        message: `Plot ${p.plot_number} has business history/status and must remain on the map.`,
      });
  const original = JSON.parse(String(m.report_json)).warnings as {
    code: string;
    message: string;
    elementId?: string;
  }[];
  for (const w of original) {
    if (["duplicate_number", "area_outlier", "no_plots"].includes(w.code))
      continue;
    const r = all.find((r) => r.svg_element_id === w.elementId);
    if (r) continue;
    warnings.push(w);
  }
  const median = active.map((r) => Number(r.area_svg)).sort((a, b) => a - b)[
    Math.floor(active.length / 2)
  ];
  for (const r of active)
    if (Number(r.area_svg) < median * 0.05 || Number(r.area_svg) > median * 20)
      warnings.push({
        code: "area_outlier",
        message: `Plot ${r.plot_number} has a suspicious area.`,
        elementId: String(r.svg_element_id),
      });
  const sorted = [...active].sort(
    (a, b) => geometry(a).bbox[0] - geometry(b).bbox[0],
  );
  let comparisons = 0,
    intersections = 0;
  const polys = new Map<string, ReturnType<typeof polygons>>();
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i],
      ga = geometry(a);
    for (let j = i + 1; j < sorted.length; j++) {
      const b = sorted[j],
        gb = geometry(b);
      if (gb.bbox[0] >= ga.bbox[2]) break;
      if (gb.bbox[1] >= ga.bbox[3] || gb.bbox[3] <= ga.bbox[1]) continue;
      if (++comparisons > 2000) {
        errors.push({
          code: "overlap_budget",
          message:
            "Too many overlapping bounds; simplify/separate candidates before publishing.",
        });
        return { errors, warnings };
      }
      for (const r of [a, b])
        if (!polys.has(String(r.id)))
          polys.set(String(r.id), polygons(geometry(r)));
      const overlap = fromPolygons(
        clipping.intersection(
          polys.get(String(a.id))!,
          polys.get(String(b.id))!,
        ),
      );
      if (overlap && overlap.area > Math.min(ga.area, gb.area) * 1e-5) {
        if (++intersections <= 100)
          warnings.push({
            code: "overlap",
            message: `Plots ${a.plot_number} and ${b.plot_number} overlap.`,
            elementId: String(a.svg_element_id),
          });
      }
    }
  }
  if (intersections > 100)
    warnings.push({
      code: "overlap_truncated",
      message: `${intersections} overlapping pairs; showing the first 100.`,
    });
  return {
    errors,
    warnings:
      warnings.length > 500
        ? [
            ...warnings.slice(0, 499),
            {
              code: "warnings_truncated",
              message: `${warnings.length} total warnings; first 499 shown. Fix or explicitly accept all, including unshown source diagnostics.`,
            },
          ]
        : warnings,
  };
}
export function reviewMap(ctx: JwtPayload, projectId: string, mapId: string) {
  ctx = access(ctx, projectId);
  const m = mapRow(ctx, projectId, mapId),
    all = rows(ctx, mapId),
    old = canonical(ctx, projectId),
    scale = m.scale_config
      ? (JSON.parse(String(m.scale_config)) as Scale)
      : null;
  const doc = parseSvg(sanitizedMap(ctx, projectId, mapId)),
    roads: Geometry[] = [],
    shapes: {
      elementId: string;
      sourceId: string;
      area: number;
      nonPlot: boolean;
    }[] = [];
  for (const el of doc.querySelectorAll("path,polygon,rect,polyline")) {
    try {
      const g = shapeGeometry(el);
      if (!g) continue;
      let label = "",
        nonPlot = false,
        road = false;
      for (let p: Element | null = el; p; p = p.parentElement) {
        label +=
          " " +
          (p.getAttribute("data-source-id") || "") +
          " " +
          (p.getAttribute("class") || "");
        if (
          ["defs", "clipPath", "mask", "symbol", "pattern"].includes(
            p.localName,
          ) ||
          p.getAttribute("display") === "none" ||
          p.getAttribute("visibility") === "hidden"
        )
          nonPlot = true;
      }
      road = /(?:^|[-_\s])(roads?|streets?)(?:$|[-_\s\d])/i.test(label);
      nonPlot ||=
        road || /(?:^|[-_\s])(park|boundary|legend|title|compass)/i.test(label);
      if (road && roads.length < 100) roads.push(g);
      shapes.push({
        elementId: el.id,
        sourceId: el.getAttribute("data-source-id") || "",
        area: g.area,
        nonPlot,
      });
    } catch {
      /* Invalid shapes remain in original diagnostics. */
    }
  }
  const activePoints = all
    .filter((r) => !r.excluded)
    .reduce((n, r) => n + geometry(r).rings.flat().length, 0);
  // Road inference is best-effort, bounded separately from required measurement work.
  const roadPointCount = roads.reduce((n, g) => n + g.rings.flat().length, 0),
    infer = activePoints * roadPointCount < 2000000;
  const defaults = getDb()
    .prepare(
      "SELECT area_unit,marla_sqft FROM plot_area_settings WHERE organization_id=?",
    )
    .get(ctx.organizationId);
  return {
    id: mapId,
    status: String(m.status),
    version: Number(m.version),
    revision: Number(m.revision),
    viewBox: JSON.parse(String(m.view_box)),
    scale,
    defaults: {
      areaUnit: String(defaults?.area_unit || "marla"),
      marlaSqFt: Number(defaults?.marla_sqft || 272.25),
    },
    diff: diff(
      ctx,
      projectId,
      all.filter((r) => !r.excluded),
    ),
    validation: issues(ctx, projectId, m, all, old),
    shapes,
    plots: all.map((r) => {
      const g = geometry(r),
        data = effective(r, old);
      return {
        id: String(r.id),
        elementId: String(r.svg_element_id),
        plotNumber: String(r.plot_number),
        method: String(r.detection_method),
        confidence: Number(r.confidence),
        excluded: Boolean(r.excluded),
        rings: g.rings,
        fillRule: g.fillRule,
        areaSvg: g.area,
        bbox: g.bbox,
        centroid: g.centroid,
        data,
        calculated: scale
          ? {
              area: areas(g.area, scale),
              dimensions: dimensions(g, scale),
              ...(infer
                ? roadHints(g, roads, scale.northUp)
                : {
                    facingCalculated: null,
                    cornerCalculated: null,
                    roadInference:
                      "Too complex for automatic road inference; set official values.",
                  }),
            }
          : null,
      };
    }),
  };
}
export function importReviewCsv(
  ctx: JwtPayload,
  projectId: string,
  mapId: string,
  input: unknown,
) {
  const q = valid(
    z
      .object({ revision: z.number().int().nonnegative(), csv: z.string() })
      .strict(),
    input,
  );
  return atomic(() => {
    ctx = access(ctx, projectId);
    const m = mapRow(ctx, projectId, mapId);
    assertDraft(m, q.revision);
    const active = rows(ctx, mapId).filter((r) => !r.excluded),
      old = canonical(ctx, projectId),
      seen = new Set<string>();
    for (const csv of parseCsv(q.csv)) {
      const n = valid(number, csv.plot_number);
      if (seen.has(n)) fail("CSV_DUPLICATE", `Duplicate CSV plot ${n}.`);
      seen.add(n);
      const matching = active.filter((r) => r.plot_number === n);
      if (matching.length !== 1)
        fail("CSV_MATCH", `Plot ${n} must match exactly one active candidate.`);
      const data: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(csv)) {
        if (k === "plot_number" || v === "") continue;
        if (
          ["is_corner", "price_per_unit_minor", "total_price_minor"].includes(
            k,
          ) &&
          !/^\d+$/.test(v)
        )
          fail(
            "CSV_INTEGER",
            `${k} must be an integer minor-unit/boolean value for plot ${n}.`,
          );
        data[k] = [
          "area_official",
          "is_corner",
          "price_per_unit_minor",
          "total_price_minor",
        ].includes(k)
          ? Number(v)
          : v;
      }
      const r = matching[0],
        parsed = bindUnit(ctx, m, r, valid(plotDataSchema, data), old);
      validateData(ctx, r, parsed, old);
      getDb()
        .prepare(
          "UPDATE map_plot_geometries SET review_json=?,updated_at=? WHERE id=? AND organization_id=?",
        )
        .run(
          JSON.stringify({ ...JSON.parse(String(r.review_json)), ...parsed }),
          nowIso(),
          r.id,
          ctx.organizationId,
        );
    }
    bump(ctx, mapId);
    audit(ctx, mapId, "plot_map.csv.imported", {
      rows: seen.size,
      revision: q.revision + 1,
    });
    return { imported: seen.size, revision: q.revision + 1 };
  });
}
export function exportReviewCsv(
  ctx: JwtPayload,
  projectId: string,
  mapId: string,
) {
  ctx = access(ctx, projectId);
  const m = mapRow(ctx, projectId, mapId),
    old = canonical(ctx, projectId),
    s = m.scale_config ? (JSON.parse(String(m.scale_config)) as Scale) : null;
  return exportCsv(
    rows(ctx, mapId)
      .filter((r) => !r.excluded)
      .map((r) => ({
        plot_number: r.plot_number,
        ...effective(r, old),
        area_unit: effective(r, old).area_unit || s?.areaUnit || "marla",
        status: effective(r, old).status || "available",
      })),
  );
}
export function publishMap(
  ctx: JwtPayload,
  projectId: string,
  mapId: string,
  input: unknown,
) {
  const q = valid(
    z
      .object({
        revision: z.number().int().nonnegative(),
        baselineMapId: z.string().nullable(),
        keepExistingData: z.boolean(),
        acceptWarnings: z.boolean(),
        warningReason: z.string().trim().max(1000).default(""),
        acknowledgeRemoved: z.boolean(),
      })
      .strict(),
    input,
  );
  return atomic(() => {
    ctx = access(ctx, projectId);
    const db = getDb(),
      m = mapRow(ctx, projectId, mapId);
    assertDraft(m, q.revision);
    if (currentPublished(ctx, projectId) !== q.baselineMapId)
      fail(
        "STALE_BASELINE",
        "Published map changed. Reload the review/diff before publishing.",
        409,
      );
    const all = rows(ctx, mapId),
      active = all.filter((r) => !r.excluded),
      old = canonical(ctx, projectId),
      validation = issues(ctx, projectId, m, all, old),
      d = diff(ctx, projectId, active);
    if (validation.errors.length)
      fail(
        "PUBLISH_INVALID",
        validation.errors.map((e) => e.message).join(" "),
      );
    if (
      validation.warnings.length &&
      (!q.acceptWarnings || q.warningReason.length < 3)
    )
      fail(
        "WARNINGS_REQUIRED",
        "Review all warnings and provide an acceptance reason.",
      );
    if (d.removed.length && !q.acknowledgeRemoved)
      fail(
        "REMOVALS_REQUIRED",
        "Acknowledge removed plots in the displayed diff.",
      );
    const s = JSON.parse(String(m.scale_config)) as Scale,
      now = nowIso(),
      numbers = new Set(active.map((r) => r.plot_number));
    for (const p of old)
      if (!numbers.has(p.plot_number) && !p.deleted_at)
        db.prepare(
          "UPDATE plots SET deleted_at=?,updated_at=? WHERE organization_id=? AND id=?",
        ).run(now, now, ctx.organizationId, p.id);
    const defaultCurrency = String(
      db
        .prepare("SELECT default_currency FROM organizations WHERE id=?")
        .get(ctx.organizationId)?.default_currency || "PKR",
    );
    for (const r of active) {
      const p = old.find((p) => p.plot_number === r.plot_number);
      if (p && !q.keepExistingData && protectedPlot(ctx, p))
        fail(
          "KEEP_DATA_REQUIRED",
          `Keep existing data is required for plot ${r.plot_number}.`,
        );
      const data = {
        ...(q.keepExistingData
          ? baseData(p)
          : {
              block: null,
              phase: null,
              street: null,
              area_official: null,
              dimensions_official: null,
              facing: null,
              is_corner: null,
              category: null,
              price_per_unit_minor: null,
              total_price_minor: null,
              currency: String(p?.currency || defaultCurrency),
            }),
        ...JSON.parse(String(r.review_json)),
      } as z.infer<typeof plotDataSchema>;
      data.currency ||= defaultCurrency;
      validateData(ctx, r, data, old);
      const a = areas(geometry(r).area, s),
        unit = data.area_unit || s.areaUnit;
      let total = data.total_price_minor ?? null;
      if (data.price_per_unit_minor != null && total === null)
        total = valid(
          moneySchema,
          Math.round(
            data.price_per_unit_minor * (data.area_official ?? a[unit]),
          ),
        );
      const status = data.status || String(p?.status || "available"),
        id = String(p?.id || newId("plot"));
      if (p) {
        const fields = {
          ...data,
          map_id: mapId,
          area_unit: unit,
          total_price_minor: total,
          status,
          deleted_at: null,
          updated_at: now,
          status_changed_at: status !== p.status ? now : p.status_changed_at,
        };
        const entries = Object.entries(fields);
        db.prepare(
          `UPDATE plots SET ${entries.map(([k]) => `${k}=?`).join(",")} WHERE id=? AND organization_id=?`,
        ).run(
          ...entries.map(([, v]) => v as string | number | null),
          id,
          ctx.organizationId,
        );
      } else {
        db.prepare(
          "INSERT INTO plots(id,organization_id,project_id,map_id,plot_number,area_unit,status,status_changed_at,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
        ).run(
          id,
          ctx.organizationId,
          projectId,
          mapId,
          r.plot_number,
          unit,
          status,
          now,
          now,
          now,
          ctx.sub,
        );
        const entries = Object.entries({ ...data, total_price_minor: total });
        if (entries.length)
          db.prepare(
            `UPDATE plots SET ${entries.map(([k]) => `${k}=?`).join(",")} WHERE id=? AND organization_id=?`,
          ).run(
            ...entries.map(([, v]) => v as string | number | null),
            id,
            ctx.organizationId,
          );
        audit(ctx, id, "plot.created", {
          projectId,
          plotNumber: r.plot_number,
          status,
        });
      }
      if (p && p.status !== status)
        audit(ctx, id, "plot.status.changed", {
          from: p.status,
          to: status,
          mapId,
        });
      db.prepare(
        "UPDATE map_plot_geometries SET plot_id=?,area_calculated=?,dimensions_calculated=?,updated_at=? WHERE organization_id=? AND id=?",
      ).run(
        id,
        a.value,
        JSON.stringify(dimensions(geometry(r), s)),
        now,
        ctx.organizationId,
        r.id,
      );
    }
    if (d.baselineMapId)
      db.prepare(
        "UPDATE project_maps SET status='archived',updated_at=? WHERE id=? AND organization_id=?",
      ).run(now, d.baselineMapId, ctx.organizationId);
    db.prepare(
      "UPDATE project_maps SET status='published',published_at=?,updated_at=?,revision=revision+1,diff_json=? WHERE id=? AND organization_id=?",
    ).run(
      now,
      now,
      JSON.stringify({ ...d, businessRecordsModified: true }),
      mapId,
      ctx.organizationId,
    );
    audit(ctx, mapId, "plot_map.published", {
      revision: q.revision + 1,
      keepExistingData: q.keepExistingData,
      diff: d,
      warnings: validation.warnings,
      warningReason: q.warningReason,
    });
    return {
      id: mapId,
      status: "published",
      plots: active.length,
      revision: q.revision + 1,
    };
  });
}
