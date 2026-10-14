import crypto from "node:crypto";
import { getDb } from "../../db";
import {
  buildOtpAuthUri,
  generateRefreshToken,
  generateTotpCode,
  generateTotpSecret,
  hashRefreshToken,
  JwtPayload,
  signAccessToken,
  verifyPassword,
  verifyTotpCode,
} from "../../auth/crypto";
import { HttpError } from "../../auth/guards";
import { recordAuditLog } from "../audit/audit.service";

export interface AuthenticatedUserView {
  id: string;
  email: string;
  fullName: string;
  phone: string | null;
  locale: "en" | "ur";
  twoFactorEnabled: boolean;
  status: string;
  organization: {
    id: string;
    slug: string;
    name: string;
    legalName: string;
    defaultCurrency: string;
  };
  branch: {
    id: string;
    code: string;
    name: string;
    city: string;
  } | null;
  role: {
    id: string;
    slug: string;
    name: string;
    description: string;
  };
  permissions: string[];
}

export interface LoginResult {
  requiresTwoFactor: boolean;
  accessToken?: string;
  refreshToken?: string;
  expiresInSeconds?: number;
  user?: AuthenticatedUserView;
}

function loadUserPermissions(roleId: string, organizationId: string): string[] {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT p.code
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ? AND rp.organization_id = ?
      ORDER BY p.code ASC
    `)
    .all(roleId, organizationId) as Array<{ code: string }>;
  return rows.map((r) => r.code);
}

export function buildAuthenticatedUserView(
  userId: string,
  organizationId: string
): AuthenticatedUserView {
  const db = getDb();
  const row = db
    .prepare(`
      SELECT
        u.id,
        u.email,
        u.full_name as fullName,
        u.phone,
        u.locale,
        u.two_factor_enabled as twoFactorEnabled,
        u.status,
        u.organization_id as organizationId,
        u.branch_id as branchId,
        u.role_id as roleId,
        o.slug as orgSlug,
        o.name as orgName,
        o.legal_name as orgLegalName,
        o.default_currency as orgCurrency,
        b.code as branchCode,
        b.name as branchName,
        b.city as branchCity,
        r.slug as roleSlug,
        r.name as roleName,
        r.description as roleDescription
      FROM users u
      JOIN organizations o ON o.id = u.organization_id
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.id = ? AND u.organization_id = ? AND u.deleted_at IS NULL
    `)
    .get(userId, organizationId) as
    | {
        id: string;
        email: string;
        fullName: string;
        phone: string | null;
        locale: string;
        twoFactorEnabled: number;
        status: string;
        organizationId: string;
        branchId: string | null;
        roleId: string;
        orgSlug: string;
        orgName: string;
        orgLegalName: string;
        orgCurrency: string;
        branchCode: string | null;
        branchName: string | null;
        branchCity: string | null;
        roleSlug: string;
        roleName: string;
        roleDescription: string;
      }
    | undefined;

  if (!row) {
    throw new HttpError(404, "USER_NOT_FOUND", "User account not found in organization.");
  }

  const permissions = loadUserPermissions(row.roleId, row.organizationId);

  return {
    id: row.id,
    email: row.email,
    fullName: row.fullName,
    phone: row.phone,
    locale: row.locale === "ur" ? "ur" : "en",
    twoFactorEnabled: Boolean(row.twoFactorEnabled),
    status: row.status,
    organization: {
      id: row.organizationId,
      slug: row.orgSlug,
      name: row.orgName,
      legalName: row.orgLegalName,
      defaultCurrency: row.orgCurrency,
    },
    branch: row.branchId
      ? {
          id: row.branchId,
          code: row.branchCode || "",
          name: row.branchName || "",
          city: row.branchCity || "",
        }
      : null,
    role: {
      id: row.roleId,
      slug: row.roleSlug,
      name: row.roleName,
      description: row.roleDescription,
    },
    permissions,
  };
}

function issueTokensForUser(
  userView: AuthenticatedUserView,
  ipAddress?: string,
  userAgent?: string
): { accessToken: string; refreshToken: string; expiresInSeconds: number } {
  const db = getDb();
  const expiresInSeconds = 900; // 15 minutes
  const refreshExpiresSeconds = 7 * 24 * 3600; // 7 days

  const jwtPayload: Omit<JwtPayload, "iat" | "exp"> = {
    sub: userView.id,
    email: userView.email,
    fullName: userView.fullName,
    organizationId: userView.organization.id,
    organizationSlug: userView.organization.slug,
    branchId: userView.branch ? userView.branch.id : null,
    roleId: userView.role.id,
    roleSlug: userView.role.slug,
    permissions: userView.permissions,
  };

  const accessToken = signAccessToken(jwtPayload, expiresInSeconds);
  const { rawToken, tokenHash } = generateRefreshToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + refreshExpiresSeconds * 1000).toISOString();

  db.prepare(`
    INSERT INTO refresh_tokens (
      id, organization_id, user_id, token_hash, expires_at, ip_address, user_agent, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    `rt_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    userView.organization.id,
    userView.id,
    tokenHash,
    expiresAt,
    ipAddress || "127.0.0.1",
    userAgent || "REMS-Client/1.0",
    now.toISOString(),
    now.toISOString(),
    userView.id
  );

  return { accessToken, refreshToken: rawToken, expiresInSeconds };
}

export function loginWithPassword(input: {
  email: string;
  password: string;
  organizationSlug?: string;
  twoFactorCode?: string;
  ipAddress?: string;
  userAgent?: string;
}): LoginResult {
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();

  let query = `
    SELECT
      u.id, u.organization_id as organizationId, u.password_hash as passwordHash,
      u.status, u.two_factor_enabled as twoFactorEnabled, u.two_factor_secret as twoFactorSecret
    FROM users u
    JOIN organizations o ON o.id = u.organization_id
    WHERE LOWER(u.email) = ? AND u.deleted_at IS NULL
  `;
  const args: string[] = [normalizedEmail];

  if (input.organizationSlug) {
    query += " AND o.slug = ?";
    args.push(input.organizationSlug.trim());
  }

  const userRow = db.prepare(query).get(...args) as
    | {
        id: string;
        organizationId: string;
        passwordHash: string;
        status: string;
        twoFactorEnabled: number;
        twoFactorSecret: string | null;
      }
    | undefined;

  if (!userRow || !verifyPassword(input.password, userRow.passwordHash)) {
    if (userRow) {
      recordAuditLog({
        organizationId: userRow.organizationId,
        actorUserId: userRow.id,
        action: "auth.login.failed",
        entityType: "user",
        entityId: userRow.id,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
        metadata: { reason: "invalid_password" },
      });
    }
    throw new HttpError(401, "INVALID_CREDENTIALS", "Invalid email or password.");
  }

  if (userRow.status !== "active") {
    throw new HttpError(403, "ACCOUNT_SUSPENDED", "This user account is suspended.");
  }

  // Handle Optional 2FA
  if (userRow.twoFactorEnabled && userRow.twoFactorSecret) {
    if (!input.twoFactorCode) {
      return { requiresTwoFactor: true };
    }
    const validOtp = verifyTotpCode(userRow.twoFactorSecret, input.twoFactorCode);
    if (!validOtp) {
      recordAuditLog({
        organizationId: userRow.organizationId,
        actorUserId: userRow.id,
        action: "auth.2fa.failed",
        entityType: "user",
        entityId: userRow.id,
        ipAddress: input.ipAddress,
        userAgent: input.userAgent,
      });
      throw new HttpError(401, "INVALID_2FA_CODE", "Invalid two-factor authentication code.");
    }
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(
    now,
    now,
    userRow.id
  );

  const userView = buildAuthenticatedUserView(userRow.id, userRow.organizationId);
  const tokens = issueTokensForUser(userView, input.ipAddress, input.userAgent);

  recordAuditLog({
    organizationId: userView.organization.id,
    actorUserId: userView.id,
    action: "auth.login.success",
    entityType: "user",
    entityId: userView.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
    metadata: {
      roleSlug: userView.role.slug,
      branchId: userView.branch?.id || null,
    },
  });

  return {
    requiresTwoFactor: false,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresInSeconds: tokens.expiresInSeconds,
    user: userView,
  };
}

export function refreshSession(input: {
  refreshToken: string;
  ipAddress?: string;
  userAgent?: string;
}): {
  accessToken: string;
  refreshToken: string;
  expiresInSeconds: number;
  user: AuthenticatedUserView;
} {
  const db = getDb();
  const tokenHash = hashRefreshToken(input.refreshToken);

  const row = db
    .prepare(`
      SELECT id, organization_id as organizationId, user_id as userId, expires_at as expiresAt, revoked_at as revokedAt
      FROM refresh_tokens
      WHERE token_hash = ?
    `)
    .get(tokenHash) as
    | {
        id: string;
        organizationId: string;
        userId: string;
        expiresAt: string;
        revokedAt: string | null;
      }
    | undefined;

  if (!row || row.revokedAt) {
    throw new HttpError(401, "INVALID_REFRESH_TOKEN", "Refresh token is invalid or revoked.");
  }

  if (new Date(row.expiresAt).getTime() < Date.now()) {
    throw new HttpError(401, "EXPIRED_REFRESH_TOKEN", "Refresh token has expired.");
  }

  const now = new Date().toISOString();
  // Rotate refresh token: revoke the current one
  db.prepare("UPDATE refresh_tokens SET revoked_at = ?, updated_at = ? WHERE id = ?").run(
    now,
    now,
    row.id
  );

  const userView = buildAuthenticatedUserView(row.userId, row.organizationId);
  const tokens = issueTokensForUser(userView, input.ipAddress, input.userAgent);

  recordAuditLog({
    organizationId: userView.organization.id,
    actorUserId: userView.id,
    action: "auth.token.refreshed",
    entityType: "refresh_token",
    entityId: row.id,
    ipAddress: input.ipAddress,
    userAgent: input.userAgent,
  });

  return {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    expiresInSeconds: tokens.expiresInSeconds,
    user: userView,
  };
}

export function logoutSession(input: {
  refreshToken?: string;
  userId?: string;
  organizationId?: string;
}): void {
  const db = getDb();
  const now = new Date().toISOString();
  if (input.refreshToken) {
    const tokenHash = hashRefreshToken(input.refreshToken);
    db.prepare(
      "UPDATE refresh_tokens SET revoked_at = ?, updated_at = ? WHERE token_hash = ?"
    ).run(now, now, tokenHash);
  }
  if (input.userId && input.organizationId) {
    recordAuditLog({
      organizationId: input.organizationId,
      actorUserId: input.userId,
      action: "auth.logout",
      entityType: "user",
      entityId: input.userId,
    });
  }
}

export function setupTwoFactor(
  userId: string,
  organizationId: string
): {
  secret: string;
  otpauthUri: string;
  currentDemoCode: string;
} {
  const db = getDb();
  const userView = buildAuthenticatedUserView(userId, organizationId);
  const secret = generateTotpSecret(20);
  const now = new Date().toISOString();

  db.prepare(
    "UPDATE users SET two_factor_secret = ?, updated_at = ? WHERE id = ? AND organization_id = ?"
  ).run(secret, now, userId, organizationId);

  const otpauthUri = buildOtpAuthUri(userView.email, secret);
  const currentDemoCode = generateTotpCode(secret);

  recordAuditLog({
    organizationId,
    actorUserId: userId,
    action: "auth.2fa.setup_initiated",
    entityType: "user",
    entityId: userId,
  });

  return { secret, otpauthUri, currentDemoCode };
}

export function verifyAndEnableTwoFactor(
  userId: string,
  organizationId: string,
  code: string
): { enabled: boolean } {
  const db = getDb();
  const row = db
    .prepare(
      "SELECT two_factor_secret as secret FROM users WHERE id = ? AND organization_id = ?"
    )
    .get(userId, organizationId) as { secret: string | null } | undefined;

  if (!row || !row.secret) {
    throw new HttpError(400, "2FA_NOT_INITIALIZED", "Please initialize 2FA setup first.");
  }

  if (!verifyTotpCode(row.secret, code)) {
    throw new HttpError(400, "INVALID_2FA_CODE", "Verification code is invalid.");
  }

  const now = new Date().toISOString();
  db.prepare(
    "UPDATE users SET two_factor_enabled = 1, updated_at = ? WHERE id = ? AND organization_id = ?"
  ).run(now, userId, organizationId);

  recordAuditLog({
    organizationId,
    actorUserId: userId,
    action: "auth.2fa.enabled",
    entityType: "user",
    entityId: userId,
  });

  return { enabled: true };
}

export function disableTwoFactor(userId: string, organizationId: string): { enabled: boolean } {
  const db = getDb();
  const now = new Date().toISOString();
  db.prepare(
    "UPDATE users SET two_factor_enabled = 0, two_factor_secret = NULL, updated_at = ? WHERE id = ? AND organization_id = ?"
  ).run(now, userId, organizationId);

  recordAuditLog({
    organizationId,
    actorUserId: userId,
    action: "auth.2fa.disabled",
    entityType: "user",
    entityId: userId,
  });

  return { enabled: false };
}

export function switchUserContext(input: {
  userId: string;
  organizationId: string;
  branchId?: string;
  locale?: "en" | "ur";
}): {
  accessToken: string;
  user: AuthenticatedUserView;
} {
  const db = getDb();
  const now = new Date().toISOString();

  if (input.branchId) {
    const branch = db
      .prepare(
        "SELECT id, organization_id as organizationId FROM branches WHERE id = ? AND deleted_at IS NULL"
      )
      .get(input.branchId) as { id: string; organizationId: string } | undefined;

    if (!branch) {
      throw new HttpError(404, "BRANCH_NOT_FOUND", "Target branch not found.");
    }
    if (branch.organizationId !== input.organizationId) {
      recordAuditLog({
        organizationId: input.organizationId,
        actorUserId: input.userId,
        action: "security.cross_tenant_blocked",
        entityType: "branch",
        entityId: input.branchId,
      });
      throw new HttpError(
        403,
        "FORBIDDEN_CROSS_TENANT",
        "Cannot switch to a branch belonging to another organization."
      );
    }

    db.prepare(
      "UPDATE users SET branch_id = ?, updated_at = ? WHERE id = ? AND organization_id = ?"
    ).run(input.branchId, now, input.userId, input.organizationId);
  }

  if (input.locale && (input.locale === "en" || input.locale === "ur")) {
    db.prepare(
      "UPDATE users SET locale = ?, updated_at = ? WHERE id = ? AND organization_id = ?"
    ).run(input.locale, now, input.userId, input.organizationId);
  }

  const userView = buildAuthenticatedUserView(input.userId, input.organizationId);
  const tokens = issueTokensForUser(userView);

  recordAuditLog({
    organizationId: input.organizationId,
    actorUserId: input.userId,
    action: "auth.context.switched",
    entityType: "user",
    entityId: input.userId,
    metadata: {
      branchId: userView.branch?.id || null,
      locale: userView.locale,
    },
  });

  return {
    accessToken: tokens.accessToken,
    user: userView,
  };
}

export function listDemoAccounts() {
  const db = getDb();
  return db
    .prepare(`
      SELECT
        u.id,
        u.email,
        u.full_name as fullName,
        u.locale,
        u.two_factor_enabled as twoFactorEnabled,
        r.slug as roleSlug,
        r.name as roleName,
        r.description as roleDescription,
        o.id as organizationId,
        o.slug as organizationSlug,
        o.name as organizationName,
        b.name as branchName,
        b.city as branchCity
      FROM users u
      JOIN roles r ON r.id = u.role_id
      JOIN organizations o ON o.id = u.organization_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.deleted_at IS NULL
      ORDER BY o.id DESC, u.id ASC
    `)
    .all();
}
