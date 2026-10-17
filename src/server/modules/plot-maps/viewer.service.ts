import type { JwtPayload } from "@/server/auth/crypto";
import { HttpError } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { atomic, nowIso } from "../shared/domain";
import { access } from "./plot-maps.service";
import { areas, type Scale } from "./measurements";
import { measure, type Point } from "./geometry";
import type {
  PublishedMap,
  ViewerPlot,
  PlotStatus,
  Box,
} from "@/lib/plot-map-viewer";
/** Deliberately admin-only until Phase E. No booking/buyer/owner/report DTO fields. */
export function publishedMap(ctx: JwtPayload, projectId: string): PublishedMap {
  return atomic(() => {
    ctx = access(ctx, projectId);
    const db = getDb(),
      m = db
        .prepare(
          "SELECT m.id,m.version,m.published_at,m.view_box,m.scale_config,a.content,p.name FROM project_maps m JOIN project_map_assets a ON a.organization_id=m.organization_id AND a.map_id=m.id AND a.kind='sanitized' JOIN properties p ON p.id=m.project_id AND p.organization_id=m.organization_id WHERE m.organization_id=? AND m.project_id=? AND m.status='published'",
        )
        .get(ctx.organizationId, projectId);
    if (!m)
      throw new HttpError(
        404,
        "NO_PUBLISHED_MAP",
        "No published map for this project. Upload, review and publish a map first.",
      );
    if (!m.scale_config)
      throw new HttpError(
        409,
        "MAP_UNCALIBRATED",
        "Published map needs calibration. Publish a calibrated version.",
      );
    const s = JSON.parse(String(m.scale_config)) as Scale;
    const rows = db
      .prepare(
        `SELECT g.svg_element_id,g.polygon_points,g.centroid,g.bounding_box,g.area_svg,g.area_calculated,g.dimensions_calculated,g.fill_rule,
    p.id,p.plot_number,p.block,p.phase,p.street,p.status,p.area_official,p.area_unit,p.dimensions_official,p.facing,p.is_corner,p.category,p.total_price_minor,p.currency
    FROM map_plot_geometries g JOIN plots p ON p.id=g.plot_id AND p.organization_id=g.organization_id AND p.project_id=g.project_id
    WHERE g.organization_id=? AND g.project_id=? AND g.map_id=? AND g.excluded=0 AND p.deleted_at IS NULL AND p.map_id=g.map_id ORDER BY p.plot_number,p.id`,
      )
      .all(ctx.organizationId, projectId, m.id);
    const plots: ViewerPlot[] = rows.map((r) => {
      const calc = areas(Number(r.area_svg), s),
        unit = String(r.area_unit || s.areaUnit),
        official = r.area_official == null ? null : Number(r.area_official);
      const sqftPerUnit = {
        sqft: 1,
        sqm: 1 / (0.3048 * 0.3048),
        marla: s.marlaSqFt,
        kanal: s.marlaSqFt * 20,
      };
      const value = official ?? calc.value,
        areaUnit = official === null ? s.areaUnit : unit;
      const filterValue =
        official === null
          ? calc.value
          : (value * (sqftPerUnit[areaUnit as keyof typeof sqftPerUnit] || 1)) /
            sqftPerUnit[s.areaUnit];
      const d = r.dimensions_calculated
        ? (JSON.parse(String(r.dimensions_calculated)) as {
            width: number;
            length: number;
            unit: string;
          })
        : null;
      const rings = JSON.parse(String(r.polygon_points)) as Point[][];
      const legacyEvenodd =
        r.fill_rule == null &&
        Math.abs((measure(rings, "evenodd")?.area || 0) - Number(r.area_svg)) <
          1e-6 &&
        Math.abs((measure(rings, "nonzero")?.area || 0) - Number(r.area_svg)) >
          1e-6;
      return {
        id: String(r.id),
        elementId: String(r.svg_element_id),
        number: String(r.plot_number),
        block: r.block == null ? null : String(r.block),
        phase: r.phase == null ? null : String(r.phase),
        street: r.street == null ? null : String(r.street),
        status: r.status as PlotStatus,
        rings,
        fillRule:
          r.fill_rule === "evenodd" || legacyEvenodd ? "evenodd" : "nonzero",
        centroid: JSON.parse(String(r.centroid)),
        bbox: JSON.parse(String(r.bounding_box)),
        area: {
          value,
          unit: areaUnit,
          source: official === null ? "calculated" : "official",
          filterValue,
        },
        dimensions: r.dimensions_official
          ? { text: String(r.dimensions_official), source: "official" }
          : d
            ? {
                text: `${Number(d.width.toFixed(2))} × ${Number(d.length.toFixed(2))} ${d.unit}`,
                source: "calculated",
              }
            : null,
        facing: r.facing == null ? null : String(r.facing),
        corner: r.is_corner == null ? null : Boolean(r.is_corner),
        category: r.category == null ? null : String(r.category),
        priceMinor:
          r.total_price_minor == null ? null : Number(r.total_price_minor),
        currency: String(r.currency),
      };
    });
    return {
      id: String(m.id),
      version: Number(m.version),
      publishedAt: String(m.published_at || ""),
      loadedAt: nowIso(),
      projectId,
      projectName: String(m.name),
      viewBox: JSON.parse(String(m.view_box)) as Box,
      areaUnit: s.areaUnit,
      svg: Buffer.from(m.content as Uint8Array).toString("utf8"),
      plots,
    };
  });
}
