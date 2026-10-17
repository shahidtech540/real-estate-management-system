import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/server/db";
import type { JwtPayload } from "@/server/auth/crypto";
import { HttpError, requirePermission } from "@/server/auth/guards";
import { freshContext } from "../orchestration/orchestration.service";
import { atomic, newId, nowIso, valid } from "../shared/domain";
import { recordAuditLog } from "../audit/audit.service";
import { compilePattern, DEFAULT_PLOT_PATTERN, detectPlots } from "./detect";
export function access(ctx: JwtPayload, projectId: string) {
  ctx = freshContext(ctx.organizationId, ctx.sub);
  if (ctx.roleSlug !== "admin")
    throw new HttpError(
      403,
      "PLOT_MAP_ADMIN",
      "Map administration is administrator-only.",
    );
  requirePermission(ctx, "admin:manage");
  requirePermission(ctx, "properties:write");
  if (
    !getDb()
      .prepare(
        "SELECT id FROM properties WHERE id=? AND organization_id=? AND deleted_at IS NULL",
      )
      .get(projectId, ctx.organizationId)
  )
    throw new HttpError(
      404,
      "PROJECT_NOT_FOUND",
      "Project not found in your organization.",
    );
  return ctx;
}
export function mapSettings(
  ctx: JwtPayload,
  projectId: string,
  input: unknown,
) {
  ctx = access(ctx, projectId);
  const q = valid(
    z.object({ plotNumberPattern: z.string().min(1).max(256) }).strict(),
    input,
  );
  compilePattern(q.plotNumberPattern);
  const now = nowIso();
  return atomic(() => {
    getDb()
      .prepare(
        "INSERT INTO plot_map_settings(organization_id,project_id,plot_number_pattern,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?) ON CONFLICT(organization_id,project_id) DO UPDATE SET plot_number_pattern=excluded.plot_number_pattern,updated_at=excluded.updated_at",
      )
      .run(
        ctx.organizationId,
        projectId,
        q.plotNumberPattern,
        now,
        now,
        ctx.sub,
      );
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "plot_map.pattern.updated",
      entityType: "property",
      entityId: projectId,
      metadata: q,
    });
    return q;
  });
}
export function authorizeMapUpload(ctx: JwtPayload, projectId: string) {
  return access(ctx, projectId);
}
export function uploadMap(ctx: JwtPayload, projectId: string, source: string) {
  ctx = access(ctx, projectId);
  const db = getDb(),
    pattern = String(
      db
        .prepare(
          "SELECT plot_number_pattern FROM plot_map_settings WHERE organization_id=? AND project_id=?",
        )
        .get(ctx.organizationId, projectId)?.plot_number_pattern ||
        DEFAULT_PLOT_PATTERN,
    ),
    result = detectPlots(source, pattern),
    id = newId("map"),
    now = nowIso();
  return atomic(() => {
    // Recheck inside the write lock after potentially expensive SVG processing.
    ctx = access(ctx, projectId);
    const version = Number(
      db
        .prepare(
          "SELECT COALESCE(MAX(version),0)+1 n FROM project_maps WHERE organization_id=? AND project_id=?",
        )
        .get(ctx.organizationId, projectId)!.n,
    );
    const previous = db
      .prepare(
        "SELECT id FROM project_maps WHERE organization_id=? AND project_id=? ORDER BY CASE WHEN status='published' THEN 0 ELSE 1 END, version DESC LIMIT 1",
      )
      .get(ctx.organizationId, projectId);
    const old = previous
        ? db
            .prepare(
              "SELECT plot_number,geometry_hash FROM map_plot_geometries WHERE organization_id=? AND map_id=?",
            )
            .all(ctx.organizationId, previous.id as string)
        : [],
      oldByNumber = new Map(
        old.map((p) => [String(p.plot_number), String(p.geometry_hash)]),
      ),
      current = new Map(
        result.plots.map((p) => [p.plotNumber, p.geometryHash]),
      );
    const diff = {
      baselineMapId: previous?.id || null,
      added: [...current.keys()].filter((n) => !oldByNumber.has(n)),
      removed: [...oldByNumber.keys()].filter((n) => !current.has(n)),
      changed: [...current.keys()].filter(
        (n) => oldByNumber.has(n) && oldByNumber.get(n) !== current.get(n),
      ),
      unchanged: [...current.keys()].filter(
        (n) => oldByNumber.get(n) === current.get(n),
      ),
      businessRecordsModified: false,
    };
    const report = {
      detectedPlots: result.plots.length,
      warnings: result.warnings,
      sanitizerRemoved: result.removed,
      measurementUnit: "svg_units",
      calibrationRequired: true,
    };
    db.prepare(
      "INSERT INTO project_maps(id,organization_id,project_id,version,original_svg_path,sanitized_svg_path,view_box,status,detection_config,report_json,diff_json,source_sha256,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,'draft',?,?,?,?,?,?,?)",
    ).run(
      id,
      ctx.organizationId,
      projectId,
      version,
      `sqlite:${id}/original`,
      `sqlite:${id}/sanitized`,
      JSON.stringify(result.viewBox),
      JSON.stringify({
        plotNumberPattern: pattern,
        curveSamples: 32,
        geometryVersion: 2,
      }),
      JSON.stringify(report),
      JSON.stringify(diff),
      createHash("sha256").update(source).digest("hex"),
      now,
      now,
      ctx.sub,
    );
    for (const [kind, content] of [
      ["original", source],
      ["sanitized", result.sanitized],
    ])
      db.prepare(
        "INSERT INTO project_map_assets(organization_id,map_id,kind,content,created_at,created_by) VALUES(?,?,?,?,?,?)",
      ).run(ctx.organizationId, id, kind, Buffer.from(content), now, ctx.sub);
    const insert = db.prepare(
      "INSERT INTO map_plot_geometries(id,organization_id,project_id,map_id,plot_number,svg_element_id,detection_method,confidence,polygon_points,centroid,bounding_box,area_svg,geometry_hash,created_at,updated_at,created_by,fill_rule) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (const p of result.plots)
      insert.run(
        newId("geometry"),
        ctx.organizationId,
        projectId,
        id,
        p.plotNumber,
        p.elementId,
        p.method,
        p.confidence,
        JSON.stringify(p.geometry.rings),
        JSON.stringify(p.geometry.centroid),
        JSON.stringify(p.geometry.bbox),
        p.geometry.area,
        p.geometryHash,
        now,
        now,
        ctx.sub,
        p.geometry.fillRule,
      );
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "plot_map.uploaded",
      entityType: "project_map",
      entityId: id,
      metadata: {
        projectId,
        version,
        detectedPlots: result.plots.length,
        status: "draft",
      },
    });
    return {
      id,
      projectId,
      version,
      status: "draft",
      viewBox: result.viewBox,
      report,
      diff,
    };
  });
}
export function listMaps(ctx: JwtPayload, projectId: string) {
  ctx = access(ctx, projectId);
  const settings = getDb()
    .prepare(
      "SELECT plot_number_pattern FROM plot_map_settings WHERE organization_id=? AND project_id=?",
    )
    .get(ctx.organizationId, projectId);
  return {
    plotNumberPattern: settings?.plot_number_pattern || DEFAULT_PLOT_PATTERN,
    maps: getDb()
      .prepare(
        "SELECT id,version,status,created_at,source_sha256 FROM project_maps WHERE organization_id=? AND project_id=? ORDER BY version DESC LIMIT 50",
      )
      .all(ctx.organizationId, projectId),
  };
}
export function getMap(
  ctx: JwtPayload,
  projectId: string,
  mapId: string,
  input: unknown = {},
) {
  ctx = access(ctx, projectId);
  const q = valid(
      z
        .object({
          page: z.coerce.number().int().min(1).max(10000).default(1),
          limit: z.coerce.number().int().min(1).max(100).default(50),
        })
        .strict(),
      input,
    ),
    db = getDb(),
    row = db
      .prepare(
        "SELECT id,version,status,view_box,report_json,diff_json FROM project_maps WHERE id=? AND organization_id=? AND project_id=?",
      )
      .get(mapId, ctx.organizationId, projectId);
  if (!row) throw new HttpError(404, "MAP_NOT_FOUND", "Map not found.");
  const rows = db
    .prepare(
      "SELECT id,plot_number,svg_element_id,detection_method,confidence,polygon_points,centroid,bounding_box,area_svg FROM map_plot_geometries WHERE organization_id=? AND map_id=? ORDER BY plot_number,id LIMIT ? OFFSET ?",
    )
    .all(ctx.organizationId, mapId, q.limit + 1, (q.page - 1) * q.limit);
  return {
    id: row.id,
    version: row.version,
    status: row.status,
    viewBox: JSON.parse(String(row.view_box)),
    report: JSON.parse(String(row.report_json)),
    diff: JSON.parse(String(row.diff_json)),
    page: q.page,
    limit: q.limit,
    hasMore: rows.length > q.limit,
    plots: rows.slice(0, q.limit).map((p) => ({
      ...p,
      area_svg: Number(p.area_svg),
      polygon_points: JSON.parse(String(p.polygon_points)),
      centroid: JSON.parse(String(p.centroid)),
      bounding_box: JSON.parse(String(p.bounding_box)),
    })),
  };
}
export function sanitizedMap(
  ctx: JwtPayload,
  projectId: string,
  mapId: string,
) {
  ctx = access(ctx, projectId);
  const row = getDb()
    .prepare(
      "SELECT a.content FROM project_map_assets a JOIN project_maps m ON m.id=a.map_id AND m.organization_id=a.organization_id WHERE m.id=? AND m.project_id=? AND m.organization_id=? AND a.kind='sanitized'",
    )
    .get(mapId, projectId, ctx.organizationId);
  if (!row) throw new HttpError(404, "MAP_NOT_FOUND", "Map not found.");
  return Buffer.from(row.content as Uint8Array).toString("utf8");
}
