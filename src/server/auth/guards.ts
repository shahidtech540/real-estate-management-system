import { NextRequest } from "next/server";
import { JwtPayload, verifyAccessToken } from "./crypto";
import { recordAuditLog } from "../modules/audit/audit.service";

export class HttpError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function extractAuthContext(req: NextRequest | Request): JwtPayload | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const verified = verifyAccessToken(token);
    if (verified) return verified;
  }

  // Also check cookie header
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)rems_access_token=([^;]+)/);
  if (match && match[1]) {
    const token = decodeURIComponent(match[1]);
    return verifyAccessToken(token);
  }

  return null;
}

export function requireAuth(req: NextRequest | Request): JwtPayload {
  const ctx = extractAuthContext(req);
  if (!ctx) {
    throw new HttpError(401, "UNAUTHORIZED", "Authentication required. Please log in.");
  }
  return ctx;
}

export function requirePermission(ctx: JwtPayload, permissionCode: string): void {
  if (!ctx.permissions.includes(permissionCode)) {
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "security.permission_denied",
      entityType: "permission",
      entityId: permissionCode,
      metadata: {
        roleSlug: ctx.roleSlug,
        requiredPermission: permissionCode,
      },
    });
    throw new HttpError(
      403,
      "FORBIDDEN_PERMISSION",
      `Role '${ctx.roleSlug}' does not have required permission '${permissionCode}'.`
    );
  }
}

export function assertTenantIsolation(
  ctx: JwtPayload,
  resourceOrganizationId: string,
  entityType = "resource",
  entityId = "unknown"
): void {
  if (ctx.organizationId !== resourceOrganizationId) {
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "security.cross_tenant_blocked",
      entityType,
      entityId,
      metadata: {
        actorOrganizationId: ctx.organizationId,
        targetOrganizationId: resourceOrganizationId,
      },
    });
    throw new HttpError(
      403,
      "FORBIDDEN_CROSS_TENANT",
      "Cross-organization data access is strictly prohibited."
    );
  }
}
