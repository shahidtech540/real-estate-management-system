import crypto from "node:crypto";
import { getDb } from "../../db";
import { hashPassword } from "../../auth/crypto";
import { HttpError } from "../../auth/guards";
import { recordAuditLog } from "../audit/audit.service";

export function listBranches(organizationId: string) {
  const db = getDb();
  return db
    .prepare(`
      SELECT
        id,
        organization_id as organizationId,
        code,
        name,
        city,
        address,
        phone,
        is_headquarters as isHeadquarters,
        created_at as createdAt
      FROM branches
      WHERE organization_id = ? AND deleted_at IS NULL
      ORDER BY is_headquarters DESC, name ASC
    `)
    .all(organizationId);
}

export function createBranch(
  organizationId: string,
  actorUserId: string,
  input: {
    code: string;
    name: string;
    city: string;
    address: string;
    phone?: string;
  }
) {
  const db = getDb();
  const id = `br_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO branches (
      id, organization_id, code, name, city, address, phone, is_headquarters, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.city.trim(),
    input.address.trim(),
    input.phone || null,
    now,
    now,
    actorUserId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "admin.branch.created",
    entityType: "branch",
    entityId: id,
    metadata: { code: input.code, name: input.name, city: input.city },
  });

  return db
    .prepare(
      `SELECT id, organization_id as organizationId, code, name, city, address, phone, is_headquarters as isHeadquarters, created_at as createdAt
       FROM branches WHERE id = ? AND organization_id = ?`
    )
    .get(id, organizationId);
}

export function listOrganizationUsers(organizationId: string) {
  const db = getDb();
  return db
    .prepare(`
      SELECT
        u.id,
        u.organization_id as organizationId,
        u.email,
        u.full_name as fullName,
        u.phone,
        u.locale,
        u.two_factor_enabled as twoFactorEnabled,
        u.status,
        u.last_login_at as lastLoginAt,
        u.created_at as createdAt,
        r.id as roleId,
        r.slug as roleSlug,
        r.name as roleName,
        b.id as branchId,
        b.code as branchCode,
        b.name as branchName,
        b.city as branchCity
      FROM users u
      JOIN roles r ON r.id = u.role_id
      LEFT JOIN branches b ON b.id = u.branch_id
      WHERE u.organization_id = ? AND u.deleted_at IS NULL
      ORDER BY u.created_at ASC
    `)
    .all(organizationId);
}

export function createOrganizationUser(
  organizationId: string,
  actorUserId: string,
  input: {
    email: string;
    fullName: string;
    password: string;
    roleSlug: string;
    branchId?: string;
    phone?: string;
    locale?: "en" | "ur";
  }
) {
  const db = getDb();
  const normalizedEmail = input.email.trim().toLowerCase();

  const existing = db
    .prepare("SELECT id FROM users WHERE organization_id = ? AND LOWER(email) = ?")
    .get(organizationId, normalizedEmail);

  if (existing) {
    throw new HttpError(409, "EMAIL_EXISTS", "A user with this email already exists in this organization.");
  }

  const role = db
    .prepare("SELECT id, slug, name FROM roles WHERE organization_id = ? AND slug = ?")
    .get(organizationId, input.roleSlug) as { id: string; slug: string; name: string } | undefined;

  if (!role) {
    throw new HttpError(400, "INVALID_ROLE", `Role '${input.roleSlug}' not found in organization.`);
  }

  if (input.branchId) {
    const branch = db
      .prepare("SELECT id FROM branches WHERE id = ? AND organization_id = ?")
      .get(input.branchId, organizationId);
    if (!branch) {
      throw new HttpError(400, "INVALID_BRANCH", "Branch does not belong to this organization.");
    }
  }

  const id = `usr_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();
  const passwordHash = hashPassword(input.password);

  db.prepare(`
    INSERT INTO users (
      id, organization_id, branch_id, role_id, email, password_hash, full_name, phone, locale,
      two_factor_enabled, status, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.branchId || null,
    role.id,
    normalizedEmail,
    passwordHash,
    input.fullName.trim(),
    input.phone || null,
    input.locale || "en",
    now,
    now,
    actorUserId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "admin.user.created",
    entityType: "user",
    entityId: id,
    metadata: { email: normalizedEmail, roleSlug: role.slug },
  });

  return {
    id,
    organizationId,
    email: normalizedEmail,
    fullName: input.fullName.trim(),
    roleSlug: role.slug,
    roleName: role.name,
    branchId: input.branchId || null,
    status: "active",
  };
}

export function updateOrganizationUser(
  organizationId: string,
  actorUserId: string,
  targetUserId: string,
  input: {
    roleSlug?: string;
    status?: "active" | "suspended";
    branchId?: string;
  }
) {
  const db = getDb();
  const targetUser = db
    .prepare("SELECT id, organization_id as organizationId FROM users WHERE id = ? AND deleted_at IS NULL")
    .get(targetUserId) as { id: string; organizationId: string } | undefined;

  if (!targetUser) {
    throw new HttpError(404, "USER_NOT_FOUND", "Target user not found.");
  }

  if (targetUser.organizationId !== organizationId) {
    recordAuditLog({
      organizationId,
      actorUserId,
      action: "security.cross_tenant_blocked",
      entityType: "user",
      entityId: targetUserId,
    });
    throw new HttpError(
      403,
      "FORBIDDEN_CROSS_TENANT",
      "Cannot modify a user belonging to another organization."
    );
  }

  const now = new Date().toISOString();

  if (input.roleSlug) {
    const role = db
      .prepare("SELECT id FROM roles WHERE organization_id = ? AND slug = ?")
      .get(organizationId, input.roleSlug) as { id: string } | undefined;
    if (!role) {
      throw new HttpError(400, "INVALID_ROLE", "Invalid role slug.");
    }
    db.prepare("UPDATE users SET role_id = ?, updated_at = ? WHERE id = ?").run(
      role.id,
      now,
      targetUserId
    );
  }

  if (input.status) {
    db.prepare("UPDATE users SET status = ?, updated_at = ? WHERE id = ?").run(
      input.status,
      now,
      targetUserId
    );
  }

  if (input.branchId !== undefined) {
    if (input.branchId) {
      const branch = db
        .prepare("SELECT id FROM branches WHERE id = ? AND organization_id = ?")
        .get(input.branchId, organizationId);
      if (!branch) {
        throw new HttpError(400, "INVALID_BRANCH", "Branch does not belong to this organization.");
      }
    }
    db.prepare("UPDATE users SET branch_id = ?, updated_at = ? WHERE id = ?").run(
      input.branchId || null,
      now,
      targetUserId
    );
  }

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "admin.user.updated",
    entityType: "user",
    entityId: targetUserId,
    metadata: { ...input },
  });

  return { updated: true, userId: targetUserId };
}

export function listRolesAndPermissions(organizationId: string) {
  const db = getDb();

  const roles = db
    .prepare(`
      SELECT id, slug, name, description, is_system as isSystem
      FROM roles
      WHERE organization_id = ? AND deleted_at IS NULL
      ORDER BY id ASC
    `)
    .all(organizationId) as Array<{
    id: string;
    slug: string;
    name: string;
    description: string;
    isSystem: number;
  }>;

  const permissions = db
    .prepare(`
      SELECT id, code, module, description
      FROM permissions
      WHERE organization_id = ?
      ORDER BY module ASC, code ASC
    `)
    .all(organizationId) as Array<{
    id: string;
    code: string;
    module: string;
    description: string;
  }>;

  const mappings = db
    .prepare(`
      SELECT rp.role_id as roleId, p.code as permissionCode
      FROM role_permissions rp
      JOIN permissions p ON p.id = rp.permission_id
      WHERE rp.organization_id = ?
    `)
    .all(organizationId) as Array<{ roleId: string; permissionCode: string }>;

  const permsByRole = new Map<string, string[]>();
  for (const m of mappings) {
    const arr = permsByRole.get(m.roleId) || [];
    arr.push(m.permissionCode);
    permsByRole.set(m.roleId, arr);
  }

  return {
    roles: roles.map((r) => ({
      ...r,
      isSystem: Boolean(r.isSystem),
      permissions: permsByRole.get(r.id) || [],
    })),
    permissions,
  };
}

export function toggleRolePermission(
  organizationId: string,
  actorUserId: string,
  input: {
    roleSlug: string;
    permissionCode: string;
    enabled: boolean;
  }
) {
  const db = getDb();
  const role = db
    .prepare("SELECT id, slug FROM roles WHERE organization_id = ? AND slug = ?")
    .get(organizationId, input.roleSlug) as { id: string; slug: string } | undefined;

  if (!role) {
    throw new HttpError(404, "ROLE_NOT_FOUND", `Role '${input.roleSlug}' not found.`);
  }

  const perm = db
    .prepare("SELECT id, code FROM permissions WHERE organization_id = ? AND code = ?")
    .get(organizationId, input.permissionCode) as { id: string; code: string } | undefined;

  if (!perm) {
    throw new HttpError(404, "PERMISSION_NOT_FOUND", `Permission '${input.permissionCode}' not found.`);
  }

  const now = new Date().toISOString();

  if (input.enabled) {
    db.prepare(`
      INSERT OR IGNORE INTO role_permissions (
        id, organization_id, role_id, permission_id, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      `rp_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
      organizationId,
      role.id,
      perm.id,
      now,
      now,
      actorUserId
    );
  } else {
    db.prepare(
      "DELETE FROM role_permissions WHERE organization_id = ? AND role_id = ? AND permission_id = ?"
    ).run(organizationId, role.id, perm.id);
  }

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "admin.rbac.permission_toggled",
    entityType: "role",
    entityId: role.id,
    metadata: {
      roleSlug: role.slug,
      permissionCode: perm.code,
      enabled: input.enabled,
    },
  });

  return listRolesAndPermissions(organizationId);
}

export function getDashboardSummary(params: {
  organizationId: string;
  roleSlug: string;
  userId: string;
  branchId?: string | null;
}) {
  const db = getDb();
  const orgId = params.organizationId;

  const totalProperties = (
    db
      .prepare("SELECT COUNT(*) as c FROM properties WHERE organization_id = ? AND deleted_at IS NULL")
      .get(orgId) as { c: number }
  ).c;

  const totalUnits = (
    db
      .prepare("SELECT COUNT(*) as c FROM units WHERE organization_id = ? AND deleted_at IS NULL")
      .get(orgId) as { c: number }
  ).c;

  const occupiedUnits = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM units WHERE organization_id = ? AND status = 'rented' AND deleted_at IS NULL"
      )
      .get(orgId) as { c: number }
  ).c;

  const totalOwners = (
    db
      .prepare("SELECT COUNT(*) as c FROM owners WHERE organization_id = ? AND deleted_at IS NULL")
      .get(orgId) as { c: number }
  ).c;

  const totalTenants = (
    db
      .prepare("SELECT COUNT(*) as c FROM tenants WHERE organization_id = ? AND deleted_at IS NULL")
      .get(orgId) as { c: number }
  ).c;

  const activeLeases = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM leases WHERE organization_id = ? AND status = 'active' AND deleted_at IS NULL"
      )
      .get(orgId) as { c: number }
  ).c;

  const invoiceStats = db
    .prepare(`
      SELECT
        COUNT(*) as totalInvoices,
        COALESCE(SUM(total_minor), 0) as totalBilledMinor,
        COALESCE(SUM(paid_minor), 0) as totalCollectedMinor,
        COALESCE(SUM(CASE WHEN status = 'overdue' THEN (total_minor - paid_minor) ELSE 0 END), 0) as arrearsMinor
      FROM invoices
      WHERE organization_id = ? AND deleted_at IS NULL
    `)
    .get(orgId) as {
    totalInvoices: number;
    totalBilledMinor: number;
    totalCollectedMinor: number;
    arrearsMinor: number;
  };

  const properties = db
    .prepare(`
      SELECT
        p.id,
        p.code,
        p.name,
        p.type,
        p.city,
        p.address,
        p.total_units as totalUnits,
        p.status,
        b.name as branchName,
        o.full_name as primaryOwnerName
      FROM properties p
      LEFT JOIN branches b ON b.id = p.branch_id
      LEFT JOIN property_owners po ON po.property_id = p.id AND po.is_primary = 1
      LEFT JOIN owners o ON o.id = po.owner_id
      WHERE p.organization_id = ? AND p.deleted_at IS NULL
      ORDER BY p.id ASC
    `)
    .all(orgId);

  const agents = db
    .prepare(`
      SELECT id, slug, name, description, autonomy_level as autonomyLevel, is_enabled as isEnabled, cost_budget_minor as costBudgetMinor, currency
      FROM agents
      WHERE organization_id = ? AND deleted_at IS NULL
      ORDER BY id ASC
    `)
    .all(orgId);

  return {
    kpis: {
      totalProperties,
      totalUnits,
      occupiedUnits,
      occupancyRatePct: totalUnits > 0 ? Math.round((occupiedUnits / totalUnits) * 1000) / 10 : 0,
      totalOwners,
      totalTenants,
      activeLeases,
      totalInvoices: invoiceStats.totalInvoices,
      totalBilledMinor: invoiceStats.totalBilledMinor,
      totalCollectedMinor: invoiceStats.totalCollectedMinor,
      arrearsMinor: invoiceStats.arrearsMinor,
      currency: "PKR",
    },
    properties,
    agents,
  };
}
