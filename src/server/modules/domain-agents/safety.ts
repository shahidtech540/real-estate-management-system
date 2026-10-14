import { createHash } from "node:crypto";
import { HttpError, requirePermission } from "@/server/auth/guards";
import type { JwtPayload } from "@/server/auth/crypto";
import { getDb } from "@/server/db";
import { canReadProperty } from "../shared/access";
import type { Citation } from "./contracts";
export type Row = Record<string, unknown>;
export const fingerprint = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function untrustedWarning(text: string) {
  return /ignore.{0,40}(instructions|previous|rules)|system\s*(prompt|message)|developer\s*(message|mode)|<\/?(?:script|system)|jailbreak|(?:api[_ -]?key|secret|password)\s*[:=]|bypass.{0,30}approval|\b(?:shell\.exec|curl\s+https?:|DROP\s+TABLE)\b/i.test(
    text,
  );
}
export function safeText(value: unknown, max = 200) {
  return String(value ?? "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(
      /(?:api[_ -]?key|password|secret|token)\s*[:=]\s*\S+/gi,
      "[credential redacted]",
    )
    .slice(0, max);
}
export function getEntity(
  ctx: JwtPayload,
  table: "leads" | "units" | "invoices" | "maintenance_tickets" | "leases",
  id: string,
): Row {
  const row = getDb()
    .prepare(
      `SELECT * FROM ${table} WHERE organization_id=? AND id=? AND deleted_at IS NULL`,
    )
    .get(ctx.organizationId, id);
  if (!row) throw new HttpError(404, "NOT_FOUND", "Agent source not found.");
  if (
    row.property_id &&
    !canReadProperty(
      ctx,
      String(row.property_id),
      row.tenant_id as string | undefined,
    )
  )
    throw new HttpError(404, "NOT_FOUND", "Agent source not found.");
  return row;
}
export function citation(type: string, row: Row, field: string): Citation {
  return {
    entityType: type,
    id: String(row.id),
    field,
    ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}),
    ...(row.version ? { version: Number(row.version) } : {}),
  };
}
export function futureSlot(value: string) {
  const n = Date.parse(value);
  if (n < Date.now() || n > Date.now() + 30 * 86400000)
    throw new HttpError(
      400,
      "VIEWING_DATE",
      "Proposed scheduling must be in the next 30 days.",
    );
}
export function documentPermission(ctx: JwtPayload, row: Row): boolean {
  if (!ctx.permissions.includes("documents:read")) return false;
  const db = getDb(),
    org = ctx.organizationId,
    type = String(row.entity_type),
    id = String(row.entity_id);
  if (type === "organization") return id === org;
  if (type === "property")
    return (
      !!db
        .prepare(
          "SELECT id FROM properties WHERE organization_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(org, id) && canReadProperty(ctx, id)
    );
  if (type === "unit") {
    const u = db
      .prepare(
        "SELECT property_id FROM units WHERE organization_id=? AND id=? AND deleted_at IS NULL",
      )
      .get(org, id);
    return !!u && canReadProperty(ctx, String(u.property_id));
  }
  if (type === "lease" && ctx.permissions.includes("leases:read")) {
    const l = db
      .prepare(
        "SELECT property_id,tenant_id FROM leases WHERE organization_id=? AND id=? AND deleted_at IS NULL",
      )
      .get(org, id);
    return (
      !!l && canReadProperty(ctx, String(l.property_id), String(l.tenant_id))
    );
  }
  return false;
}
export function insightsMode(question: string) {
  const text = question.toLowerCase();
  if (/income|expense|profit|cash|آمدنی|اخراجات/.test(text)) return "finance";
  if (/arrears|overdue|بقایا/.test(text)) return "arrears";
  if (/maintenance|repair|مرمت/.test(text)) return "maintenance";
  if (/vacan|خالی/.test(text)) return "vacancy";
  if (/occup|units|آباد|یونٹ/.test(text)) return "occupancy";
  return "documents";
}
export function domainPermissions(kind: string, input: unknown): string[] {
  if (kind === "lead") return ["leads:read", "properties:read"];
  if (kind === "listing") return ["listings:read", "properties:read"];
  if (kind === "rent") return ["invoices:read", "payments:read", "leases:read"];
  if (kind === "maintenance") return ["maintenance:read"];
  if (kind === "lease")
    return [
      "leases:read",
      ...((input as Row)?.documentId ? ["documents:read"] : []),
    ];
  const mode = insightsMode(String((input as Row)?.question || ""));
  return mode === "finance"
    ? ["properties:read", "accounting:read"]
    : mode === "arrears"
      ? ["properties:read", "invoices:read"]
      : mode === "maintenance"
        ? ["properties:read", "maintenance:read"]
        : mode === "documents"
          ? ["properties:read", "documents:read", "leases:read"]
          : ["properties:read"];
}
export function requireDomain(ctx: JwtPayload, kind: string, input: unknown) {
  domainPermissions(kind, input).forEach((p) => requirePermission(ctx, p));
}
