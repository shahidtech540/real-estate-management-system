import { mutationOrigin } from "../security/request";
import { getDb } from "@/server/db";
import { ACCESS_TOKEN_HEADER } from "@/lib/auth-transport";
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

export function extractAuthContext(
  req: NextRequest | Request,
): JwtPayload | null {
  const authHeader = req.headers.get("authorization");
  if (authHeader && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7).trim();
    const verified = verifyAccessToken(token);
    if (verified) return verified;
  }

  // Preview proxies may strip/replace Authorization, while iframe browsers
  // reject third-party cookies. The application header carries the same JWT;
  // it receives exactly the same cryptographic validation, never trusted claims.
  const appToken = req.headers.get(ACCESS_TOKEN_HEADER)?.trim();
  if (appToken) {
    const verified = verifyAccessToken(appToken);
    if (verified) return verified;
  }

  // Also check cookie header
  const cookieHeader = req.headers.get("cookie") || "";
  const match = cookieHeader.match(/(?:^|;\s*)rems_access_token=([^;]+)/);
  if (match && match[1]) {
    try {
      return verifyAccessToken(decodeURIComponent(match[1]));
    } catch {
      return null;
    }
  }

  return null;
}

export function requireAuth(req: NextRequest | Request): JwtPayload {
  const ctx = extractAuthContext(req);
  if (
    !ctx ||
    !getDb()
      .prepare(
        "SELECT u.id FROM users u JOIN organizations o ON o.id=u.organization_id WHERE u.id=? AND u.organization_id=? AND u.status='active' AND u.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL",
      )
      .get(ctx?.sub || "", ctx?.organizationId || "")
  ) {
    throw new HttpError(
      401,
      "UNAUTHORIZED",
      "Authentication required. Please log in.",
    );
  }
  const db = getDb(),
    u = db
      .prepare(
        "SELECT u.*,r.slug role_slug,o.slug org_slug FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id JOIN organizations o ON o.id=u.organization_id WHERE u.id=? AND u.organization_id=? AND r.deleted_at IS NULL",
      )
      .get(ctx.sub, ctx.organizationId)!;
  if (!u) throw new HttpError(401, "UNAUTHORIZED", "Active role not found.");
  if (Number(u.token_version) !== (ctx.tokenVersion || 0))
    throw new HttpError(
      401,
      "SESSION_REVOKED",
      "Session ended. Please sign in again.",
    );
  const headerToken =
    req.headers.get("authorization")?.replace(/^Bearer /, "") ||
    req.headers.get(ACCESS_TOKEN_HEADER) ||
    "";
  mutationOrigin(req, !!verifyAccessToken(headerToken));
  return {
    ...ctx,
    roleId: String(u.role_id),
    roleSlug: String(u.role_slug),
    branchId: u.branch_id as string | null,
    fullName: String(u.full_name),
    email: String(u.email),
    permissions: db
      .prepare(
        "SELECT p.code FROM role_permissions rp JOIN permissions p ON p.id=rp.permission_id AND p.organization_id=rp.organization_id WHERE rp.organization_id=? AND rp.role_id=?",
      )
      .all(ctx.organizationId, String(u.role_id))
      .map((p) => String(p.code)),
  };
}

export function requirePermission(
  ctx: JwtPayload,
  permissionCode: string,
): void {
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
      `Role '${ctx.roleSlug}' does not have required permission '${permissionCode}'.`,
    );
  }
}

export function assertTenantIsolation(
  ctx: JwtPayload,
  resourceOrganizationId: string,
  entityType = "resource",
  entityId = "unknown",
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
      "Cross-organization data access is strictly prohibited.",
    );
  }
}
