import type { JwtPayload } from "@/server/auth/crypto";
import { HttpError } from "@/server/auth/guards";
import { getDb } from "@/server/db";
export function canReadProperty(
  ctx: JwtPayload,
  propertyId: string,
  tenantId?: string,
): boolean {
  if (ctx.roleSlug === "tenant")
    return !!getDb()
      .prepare(
        "SELECT id FROM tenants WHERE organization_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, ctx.sub, tenantId || "");
  if (ctx.roleSlug === "owner")
    return !!getDb()
      .prepare(
        "SELECT o.id FROM owners o JOIN property_owners po ON po.owner_id = o.id WHERE o.organization_id = ? AND o.user_id = ? AND po.property_id = ? AND o.deleted_at IS NULL AND po.deleted_at IS NULL AND po.organization_id = o.organization_id",
      )
      .get(ctx.organizationId, ctx.sub, propertyId);
  return true;
}
export function canReadOwner(ctx: JwtPayload, ownerId: string) {
  if (ctx.roleSlug === "tenant") return false;
  return (
    ctx.roleSlug !== "owner" ||
    !!getDb()
      .prepare(
        "SELECT id FROM owners WHERE organization_id = ? AND user_id = ? AND id = ? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, ctx.sub, ownerId)
  );
}
export function assertReadable(
  ctx: JwtPayload,
  propertyId: string,
  tenantId?: string,
) {
  if (!canReadProperty(ctx, propertyId, tenantId))
    throw new HttpError(404, "NOT_FOUND", "Record not found.");
}
/** Entity-scoped vault visibility; portal roles never inherit the whole org vault. */
export function canReadDocument(
  ctx: JwtPayload,
  type: string,
  id: string,
): boolean {
  const tables: Record<string, string> = {
      property: "properties",
      unit: "units",
      owner: "owners",
      tenant: "tenants",
      lease: "leases",
      organization: "organizations",
    },
    table = tables[type];
  if (!table) return false;
  const row = getDb()
    .prepare(
      `SELECT * FROM ${table} WHERE id=? ${type === "organization" ? "" : "AND organization_id=?"} AND deleted_at IS NULL`,
    )
    .get(id, ...(type === "organization" ? [] : [ctx.organizationId]));
  if (!row || (type === "organization" && id !== ctx.organizationId))
    return false;
  if (type === "lease" && !ctx.permissions.includes("leases:read"))
    return false;
  if (!["owner", "tenant"].includes(ctx.roleSlug)) return true;
  if (type === "owner")
    return ctx.roleSlug === "owner" && canReadOwner(ctx, id);
  if (type === "tenant")
    return ctx.roleSlug === "tenant" && row.user_id === ctx.sub;
  if (type === "lease")
    return canReadProperty(ctx, String(row.property_id), String(row.tenant_id));
  if (!["property", "unit"].includes(type)) return false;
  const property = type === "property" ? id : String(row.property_id);
  if (ctx.roleSlug === "owner") return canReadProperty(ctx, property);
  return !!getDb()
    .prepare(
      `SELECT l.id FROM leases l JOIN tenants t ON t.id=l.tenant_id AND t.organization_id=l.organization_id WHERE l.organization_id=? AND l.property_id=? ${type === "unit" ? "AND l.unit_id=?" : ""} AND l.status IN ('active','expiring','renewed') AND l.deleted_at IS NULL AND t.deleted_at IS NULL AND t.user_id=?`,
    )
    .get(
      ctx.organizationId,
      property,
      ...(type === "unit" ? [id] : []),
      ctx.sub,
    );
}
