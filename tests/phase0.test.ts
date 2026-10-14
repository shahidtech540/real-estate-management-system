import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDbForTesting, getDb } from "@/server/db";
import { DEMO_PASSWORD } from "@/server/db/seed";
import {
  hashPassword,
  verifyPassword,
  signAccessToken,
  verifyAccessToken,
  generateTotpSecret,
  generateTotpCode,
  verifyTotpCode,
  buildOtpAuthUri,
} from "@/server/auth/crypto";
import {
  assertTenantIsolation,
  HttpError,
  requireAuth,
  requirePermission,
} from "@/server/auth/guards";
import {
  loginWithPassword,
  refreshSession,
  logoutSession,
  setupTwoFactor,
  verifyAndEnableTwoFactor,
  disableTwoFactor,
  switchUserContext,
  listDemoAccounts,
} from "@/server/modules/auth/auth.service";
import {
  listBranches,
  createBranch,
  listOrganizationUsers,
  createOrganizationUser,
  updateOrganizationUser,
  listRolesAndPermissions,
  toggleRolePermission,
  getDashboardSummary,
} from "@/server/modules/admin/admin.service";
import { listAuditLogs } from "@/server/modules/audit/audit.service";
import { formatCompactPkr, formatMinorCurrency } from "@/lib/format";
import { t } from "@/lib/i18n";

// Route handlers
import { GET as healthGet } from "@/app/api/v1/health/route";
import { GET as loginGet, POST as loginPost } from "@/app/api/v1/auth/login/route";
import { GET as meGet } from "@/app/api/v1/auth/me/route";
import { POST as refreshPost } from "@/app/api/v1/auth/refresh/route";
import { POST as logoutPost } from "@/app/api/v1/auth/logout/route";
import { POST as contextPost } from "@/app/api/v1/auth/context/route";
import { POST as twoFactorPost } from "@/app/api/v1/auth/2fa/route";
import {
  GET as usersGet,
  POST as usersPost,
  PATCH as usersPatch,
} from "@/app/api/v1/admin/users/route";
import { GET as rolesGet, PATCH as rolesPatch } from "@/app/api/v1/admin/roles/route";
import { GET as branchesGet, POST as branchesPost } from "@/app/api/v1/admin/branches/route";
import { GET as auditGet } from "@/app/api/v1/admin/audit-logs/route";

describe("Phase 0: Plan, ERD, Seed Dataset, Auth, RBAC & Multi-Tenancy", () => {
  beforeEach(() => {
    resetDbForTesting();
  });

  it("initializes all 32 ERD tables and seeds the full demo dataset (3 owners, 10 properties, 30 units, 20 tenants, 240 invoices)", () => {
    const db = getDb();
    const orgs = db.prepare("SELECT COUNT(*) as c FROM organizations").get() as { c: number };
    const owners = db
      .prepare("SELECT COUNT(*) as c FROM owners WHERE organization_id = 'org_pakland'")
      .get() as { c: number };
    const properties = db
      .prepare("SELECT COUNT(*) as c FROM properties WHERE organization_id = 'org_pakland'")
      .get() as { c: number };
    const units = db
      .prepare("SELECT COUNT(*) as c FROM units WHERE organization_id = 'org_pakland'")
      .get() as { c: number };
    const tenants = db
      .prepare("SELECT COUNT(*) as c FROM tenants WHERE organization_id = 'org_pakland'")
      .get() as { c: number };
    const invoices = db
      .prepare("SELECT COUNT(*) as c FROM invoices WHERE organization_id = 'org_pakland'")
      .get() as { c: number };

    expect(orgs.c).toBe(2);
    expect(owners.c).toBe(3);
    expect(properties.c).toBe(10);
    expect(units.c).toBe(30);
    expect(tenants.c).toBe(20);
    expect(invoices.c).toBe(240);

    const accounts = listDemoAccounts();
    expect(accounts.length).toBe(6);
  });

  it("hashes passwords, signs/verifies JWTs, and generates/verifies RFC 6238 TOTP codes", () => {
    const hash = hashPassword("MySecretPass99!");
    expect(verifyPassword("MySecretPass99!", hash)).toBe(true);
    expect(verifyPassword("WrongPass", hash)).toBe(false);
    expect(verifyPassword("MySecretPass99!", "invalid$hash")).toBe(false);

    const token = signAccessToken(
      {
        sub: "usr_admin",
        email: "admin@fahadrealestate.test",
        fullName: "Tariq Mahmood",
        organizationId: "org_pakland",
        organizationSlug: "pakland-developers",
        branchId: "br_isb",
        roleId: "role_org_pakland_admin",
        roleSlug: "admin",
        permissions: ["admin:manage"],
      },
      60
    );

    const decoded = verifyAccessToken(token);
    expect(decoded).not.toBeNull();
    expect(decoded?.sub).toBe("usr_admin");
    expect(verifyAccessToken(`${token}tampered`)).toBeNull();

    // Expired token check
    const expired = signAccessToken(
      {
        sub: "usr_admin",
        email: "admin@fahadrealestate.test",
        fullName: "Tariq Mahmood",
        organizationId: "org_pakland",
        organizationSlug: "pakland-developers",
        branchId: "br_isb",
        roleId: "role_org_pakland_admin",
        roleSlug: "admin",
        permissions: [],
      },
      -10
    );
    expect(verifyAccessToken(expired)).toBeNull();

    // TOTP 2FA check
    const secret = generateTotpSecret();
    const uri = buildOtpAuthUri("admin@fahadrealestate.test", secret);
    expect(uri).toContain("otpauth://totp/");
    const code = generateTotpCode(secret);
    expect(code).toMatch(/^\d{6}$/);
    expect(verifyTotpCode(secret, code)).toBe(true);
    expect(verifyTotpCode(secret, "abc")).toBe(false);
  });

  it("authenticates all 6 roles with distinct RBAC permissions and rotates refresh tokens", () => {
    const roleEmails = [
      { email: "admin@fahadrealestate.test", roleSlug: "admin", minPerms: 35 },
      { email: "agent@fahadrealestate.test", roleSlug: "agent", minPerms: 10 },
      { email: "accountant@fahadrealestate.test", roleSlug: "accountant", minPerms: 10 },
      { email: "maintenance@fahadrealestate.test", roleSlug: "maintenance_staff", minPerms: 8 },
      { email: "owner@fahadrealestate.test", roleSlug: "owner", minPerms: 8 },
      { email: "tenant@fahadrealestate.test", roleSlug: "tenant", minPerms: 5 },
    ];

    for (const item of roleEmails) {
      const res = loginWithPassword({
        email: item.email,
        password: DEMO_PASSWORD,
      });
      expect(res.requiresTwoFactor).toBe(false);
      expect(res.user?.role.slug).toBe(item.roleSlug);
      expect(res.user?.permissions.length).toBeGreaterThanOrEqual(item.minPerms);
    }

    // Refresh token rotation
    const adminLogin = loginWithPassword({
      email: "admin@fahadrealestate.test",
      password: DEMO_PASSWORD,
    });
    const firstRefreshToken = adminLogin.refreshToken!;
    const rotated = refreshSession({ refreshToken: firstRefreshToken });
    expect(rotated.accessToken).toBeTruthy();
    expect(rotated.refreshToken).not.toBe(firstRefreshToken);

    // Reusing old refresh token must fail
    expect(() => refreshSession({ refreshToken: firstRefreshToken })).toThrowError(HttpError);

    // Logout revokes current refresh token
    logoutSession({
      refreshToken: rotated.refreshToken,
      userId: rotated.user.id,
      organizationId: rotated.user.organization.id,
    });
    expect(() => refreshSession({ refreshToken: rotated.refreshToken })).toThrowError(HttpError);
  });

  it("supports full TOTP 2FA setup, login challenge, verification, and disablement", () => {
    const setup = setupTwoFactor("usr_admin", "org_pakland");
    expect(setup.secret).toBeTruthy();
    expect(setup.currentDemoCode).toMatch(/^\d{6}$/);

    const enabled = verifyAndEnableTwoFactor("usr_admin", "org_pakland", setup.currentDemoCode);
    expect(enabled.enabled).toBe(true);

    // Login without 2FA code prompts for 2FA
    const challenge = loginWithPassword({
      email: "admin@fahadrealestate.test",
      password: DEMO_PASSWORD,
    });
    expect(challenge.requiresTwoFactor).toBe(true);
    expect(challenge.accessToken).toBeUndefined();

    // Login with valid 2FA code succeeds
    const validLogin = loginWithPassword({
      email: "admin@fahadrealestate.test",
      password: DEMO_PASSWORD,
      twoFactorCode: setup.currentDemoCode,
    });
    expect(validLogin.requiresTwoFactor).toBe(false);
    expect(validLogin.accessToken).toBeTruthy();

    // Disable 2FA
    const disabled = disableTwoFactor("usr_admin", "org_pakland");
    expect(disabled.enabled).toBe(false);
  });

  it("enforces RBAC permissions and strict multi-tenancy isolation between organizations", () => {
    const tenantLogin = loginWithPassword({
      email: "tenant@fahadrealestate.test",
      password: DEMO_PASSWORD,
    });
    const tenantCtx = verifyAccessToken(tenantLogin.accessToken!)!;

    // Tenant does not have admin:manage
    expect(() => requirePermission(tenantCtx, "admin:manage")).toThrowError(HttpError);

    // Cross-tenant isolation check
    expect(() => assertTenantIsolation(tenantCtx, "org_indus", "property", "prop_indus_1")).toThrowError(
      HttpError
    );

    // Admin in org_pakland cannot modify user in org_indus
    expect(() =>
      updateOrganizationUser("org_pakland", "usr_admin", "usr_indus_admin", {
        status: "suspended",
      })
    ).toThrowError(HttpError);

    // Admin in org_pakland cannot switch to a branch in org_indus
    expect(() =>
      switchUserContext({
        userId: "usr_admin",
        organizationId: "org_pakland",
        branchId: "br_indus_khi",
      })
    ).toThrowError(HttpError);

    // Compare portfolio counts between org_pakland (10 properties) and org_indus (1 property)
    const paklandSummary = getDashboardSummary({
      organizationId: "org_pakland",
      roleSlug: "admin",
      userId: "usr_admin",
    });
    const indusSummary = getDashboardSummary({
      organizationId: "org_indus",
      roleSlug: "admin",
      userId: "usr_indus_admin",
    });
    expect(paklandSummary.kpis.totalProperties).toBe(10);
    expect(indusSummary.kpis.totalProperties).toBe(1);
  });

  it("manages users, branches, RBAC role permissions, and audit logs via service and API route handlers", async () => {
    // Health route
    const healthRes = await healthGet();
    const healthJson = await healthRes.json();
    expect(healthJson.status).toBe("ok");
    expect(healthJson.metrics.companyProperties).toBe(10);

    // GET demo accounts
    const demoRes = await loginGet();
    const demoJson = await demoRes.json();
    expect(demoJson.accounts.length).toBe(6);

    // POST login via route handler
    const loginReq = new NextRequest("http://localhost:3000/api/v1/auth/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@fahadrealestate.test", password: DEMO_PASSWORD }),
      headers: { "content-type": "application/json" },
    });
    const loginRes = await loginPost(loginReq);
    const loginData = await loginRes.json();
    expect(loginRes.status).toBe(200);
    const token = loginData.accessToken as string;
    const authHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    // GET /api/v1/auth/me
    const meRes = await meGet(
      new NextRequest("http://localhost:3000/api/v1/auth/me", { headers: authHeaders })
    );
    expect(meRes.status).toBe(200);

    // POST /api/v1/auth/context (switch branch + locale)
    const ctxRes = await contextPost(
      new NextRequest("http://localhost:3000/api/v1/auth/context", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ branchId: "br_lhr", locale: "ur" }),
      })
    );
    expect(ctxRes.status).toBe(200);

    // POST /api/v1/admin/users (create new user)
    const createUserRes = await usersPost(
      new NextRequest("http://localhost:3000/api/v1/admin/users", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          email: "newagent@fahadrealestate.test",
          fullName: "Hassan Ali",
          password: "Password123!",
          roleSlug: "agent",
          branchId: "br_isb",
        }),
      })
    );
    expect(createUserRes.status).toBe(201);
    const createdUserData = await createUserRes.json();

    // PATCH /api/v1/admin/users
    const patchUserRes = await usersPatch(
      new NextRequest("http://localhost:3000/api/v1/admin/users", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          userId: createdUserData.user.id,
          roleSlug: "accountant",
        }),
      })
    );
    expect(patchUserRes.status).toBe(200);

    // GET /api/v1/admin/users
    const listUsersRes = await usersGet(
      new NextRequest("http://localhost:3000/api/v1/admin/users", { headers: authHeaders })
    );
    expect(listUsersRes.status).toBe(200);

    // GET & PATCH /api/v1/admin/roles
    const getRolesRes = await rolesGet(
      new NextRequest("http://localhost:3000/api/v1/admin/roles", { headers: authHeaders })
    );
    expect(getRolesRes.status).toBe(200);

    const patchRoleRes = await rolesPatch(
      new NextRequest("http://localhost:3000/api/v1/admin/roles", {
        method: "PATCH",
        headers: authHeaders,
        body: JSON.stringify({
          roleSlug: "agent",
          permissionCode: "reports:export",
          enabled: true,
        }),
      })
    );
    expect(patchRoleRes.status).toBe(200);

    // GET & POST /api/v1/admin/branches
    const getBranchesRes = await branchesGet(
      new NextRequest("http://localhost:3000/api/v1/admin/branches", { headers: authHeaders })
    );
    expect(getBranchesRes.status).toBe(200);

    const createBranchRes = await branchesPost(
      new NextRequest("http://localhost:3000/api/v1/admin/branches", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({
          code: "FSD-01",
          name: "Faisalabad Canal Branch",
          city: "Faisalabad",
          address: "Main Canal Road, Faisalabad",
        }),
      })
    );
    expect(createBranchRes.status).toBe(201);

    // POST /api/v1/auth/2fa
    const twoFaSetupRes = await twoFactorPost(
      new NextRequest("http://localhost:3000/api/v1/auth/2fa", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ action: "setup" }),
      })
    );
    expect(twoFaSetupRes.status).toBe(200);

    // POST /api/v1/auth/refresh
    const refreshRes = await refreshPost(
      new NextRequest("http://localhost:3000/api/v1/auth/refresh", {
        method: "POST",
        headers: authHeaders,
        body: JSON.stringify({ refreshToken: loginData.refreshToken }),
      })
    );
    expect(refreshRes.status).toBe(200);

    // GET /api/v1/admin/audit-logs
    const auditRes = await auditGet(
      new NextRequest("http://localhost:3000/api/v1/admin/audit-logs?action=admin", {
        headers: authHeaders,
      })
    );
    expect(auditRes.status).toBe(200);
    const auditData = await auditRes.json();
    expect(auditData.total).toBeGreaterThan(0);

    // POST /api/v1/auth/logout
    const logoutRes = await logoutPost(
      new NextRequest("http://localhost:3000/api/v1/auth/logout", {
        method: "POST",
        headers: authHeaders,
      })
    );
    expect(logoutRes.status).toBe(200);

    // Formatters & i18n helpers
    expect(formatMinorCurrency(15000000)).toBe("PKR 150,000");
    expect(formatCompactPkr(2500000000)).toContain("Crore");
    expect(formatCompactPkr(50000000)).toContain("Lakh");
    expect(t("ur", "appName")).toContain("فہد رئیل اسٹیٹ");
    expect(t("en", "appName")).toContain("Fahad Real Estate");
  });
});
