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
