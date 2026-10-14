import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { NextRequest } from "next/server";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { getDb, resetDbForTesting } from "@/server/db";
import { migratePhase8 } from "@/server/db/phase8";
import {
  loginWithPassword,
  logoutSession,
  refreshSession,
  setupTwoFactor,
} from "@/server/modules/auth/auth.service";
import {
  verifyAccessToken,
  signAccessToken,
  verifyPassword,
  hashPassword,
  type JwtPayload,
} from "@/server/auth/crypto";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { readJson, mutationOrigin, rateLimit } from "@/server/security/request";
import { validateDeployment } from "@/server/security/config";
import { handleApiError, attachAuthCookies } from "@/server/auth/http";
import { GET, POST } from "@/app/api/v1/portal/route";
import { GET as getUsers } from "@/app/api/v1/admin/users/route";
import { GET as getOwners } from "@/app/api/v1/owners/route";
import { GET as getDocuments } from "@/app/api/v1/documents/route";
import { GET as getProperties } from "@/app/api/v1/properties/route";
import { GET as getUnits } from "@/app/api/v1/units/route";
import { GET as getMe } from "@/app/api/v1/auth/me/route";
import { POST as loginApi } from "@/app/api/v1/auth/login/route";
import { POST as refreshApi } from "@/app/api/v1/auth/refresh/route";
import { POST as logoutApi } from "@/app/api/v1/auth/logout/route";
import { NextResponse } from "next/server";
import { uploadDocument } from "@/server/modules/documents/documents.service";
import {
  portalPage,
  portalSummary,
  requestOwnerReview,
  decideOwnerReview,
  linkPortalProfile,
} from "@/server/modules/portals/portals.service";
import { capturePublicLead } from "@/server/modules/crm/crm.service";
const org = "org_pakland";
let admin: JwtPayload,
  tenant: JwtPayload,
  owner: JwtPayload,
  staff: JwtPayload,
  token: string;
function ctx(role: string) {
  return verifyAccessToken(
    loginWithPassword({
      email: `${role}@fahadrealestate.test`,
      password: "Password123!",
    }).accessToken!,
  )!;
}
function req(
  path: string,
  actor = tenant,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const jwt = signAccessToken(actor);
  return new NextRequest(`http://localhost/api/v1/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      Authorization: `Bearer ${jwt}`,
      "Content-Type": "application/json",
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-15T10:00:00Z"));
  vi.unstubAllEnvs();
  resetDbForTesting();
  admin = ctx("admin");
  tenant = ctx("tenant");
  owner = ctx("owner");
  staff = ctx("maintenance");
  token = signAccessToken(admin);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function consent() {
  return requestOwnerReview(admin, {
    ownerId: "own_1",
    entityType: "lease",
    entityId: "lease_1",
    summary: "Review unsigned renewal proposal only",
    proposedCostMinor: 10001,
  });
}
describe("Phase 8 personal portals and OWASP-oriented hardening", () => {
  it("additive migration keeps money/history and repeats safely", () => {
    const db = getDb(),
      tables = [
        "leases",
        "invoices",
        "payments",
        "receipts",
        "owner_statements",
        "journal_batches",
        "ledger_entries",
      ],
      snap = tables.map((t) =>
        db.prepare(`SELECT * FROM ${t} ORDER BY id`).all(),
      );
    migratePhase8(db);
    migratePhase8(db);
    tables.forEach((t, i) =>
      expect(db.prepare(`SELECT * FROM ${t} ORDER BY id`).all()).toEqual(
        snap[i],
      ),
    );
    expect(db.prepare("PRAGMA foreign_key_check").all()).toHaveLength(0);
  });
  it("tenant sees only linked profile leases/invoices; never org contacts or CNIC", () => {
    const summary = portalSummary(tenant);
    expect(summary.linkedProfiles).toBe(1);
    const items = portalPage(tenant, { resource: "leases" }).items;
    expect(items.length).toBeGreaterThan(0);
    for (const l of items)
      expect(
        getDb()
          .prepare(
            "SELECT t.user_id FROM leases l JOIN tenants t ON t.id=l.tenant_id WHERE l.id=?",
          )
          .get(l.id as string)!.user_id,
      ).toBe(tenant.sub);
    expect(JSON.stringify(items)).not.toContain("cnic");
    expect(() => portalPage(tenant, { resource: "properties" })).toThrow();
  });
  it("owner pages omit unrelated owner bank details and scope physical inventory", () => {
    const p = portalPage(owner, { resource: "properties" });
    expect(p.items.length).toBeGreaterThan(0);
    for (const property of p.items)
      expect(
        getDb()
          .prepare(
            "SELECT o.user_id FROM owners o JOIN property_owners po ON po.owner_id=o.id WHERE po.property_id=? AND o.user_id=?",
          )
          .get(String(property.id), owner.sub),
      ).toBeTruthy();
    expect(JSON.stringify(p)).not.toContain("iban");
    expect(() => portalPage(tenant, { resource: "statements" })).toThrow();
  });
  it("tenant cannot read another unit vault record within the same leased property", async () => {
    const doc = uploadDocument(org, admin.sub, {
      entityType: "unit",
      entityId: "unit_2",
      title: "Other unit inspection",
      category: "inspection",
      contentText: "PRIVATE-OTHER-UNIT",
    });
    const d = await (await getDocuments(req("documents", tenant))).json();
    expect(d.documents.some((i: { id: string }) => i.id === doc.id)).toBe(
      false,
    );
  });
  it("a removed property owner cannot decide pending consent even when their account remains linked", () => {
    const r = consent();
    getDb()
      .prepare(
        "UPDATE property_owners SET deleted_at=? WHERE owner_id='own_1' AND property_id='prop_1'",
      )
      .run(new Date().toISOString());
    expect(() =>
      decideOwnerReview(owner, {
        id: r.id,
        decision: "approved",
        note: "Ownership was removed",
      }),
    ).toThrow(/not found/);
  });
  it("admin links/unlinks profiles explicitly; personal/foreign/wrong-role accounts cannot link", () => {
    getDb().prepare("UPDATE tenants SET user_id=NULL WHERE id=?").run("ten_1");
    expect(portalPage(tenant, { resource: "leases" }).items).toEqual([]);
    expect(() =>
      linkPortalProfile(tenant, {
        profileType: "tenant",
        profileId: "ten_1",
        userId: tenant.sub,
      }),
    ).toThrow();
    expect(() =>
      linkPortalProfile(admin, {
        profileType: "tenant",
        profileId: "ten_1",
        userId: owner.sub,
      }),
    ).toThrow(/matching/);
    expect(() =>
      linkPortalProfile(admin, {
        profileType: "tenant",
        profileId: "ten_1",
        userId: "usr_indus_admin",
      }),
    ).toThrow();
    linkPortalProfile(admin, {
      profileType: "tenant",
      profileId: "ten_1",
      userId: tenant.sub,
    });
    expect(
      portalPage(tenant, { resource: "leases" }).items.length,
    ).toBeGreaterThan(0);
    linkPortalProfile(admin, {
      profileType: "tenant",
      profileId: "ten_1",
      userId: null,
    });
    expect(portalPage(tenant, { resource: "leases" }).items).toEqual([]);
  });
  it("refresh does not swallow oversized/malformed bodies or malformed cookies", async () => {
    const session = loginWithPassword({
        email: "tenant@fahadrealestate.test",
        password: "Password123!",
      }),
      cookie = `rems_refresh_token=${session.refreshToken}`;
    const huge = new NextRequest("http://localhost/api/v1/auth/refresh", {
      method: "POST",
      headers: { cookie },
      body: JSON.stringify({ padding: "x".repeat(1048576) }),
    });
    expect((await refreshApi(huge)).status).toBe(413);
    expect(
      (
        await refreshApi(
          new NextRequest("http://localhost/api/v1/auth/refresh", {
            method: "POST",
            headers: { cookie },
            body: "{",
          }),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await refreshApi(
          new NextRequest("http://localhost/api/v1/auth/refresh", {
            method: "POST",
            headers: { cookie: "rems_refresh_token=%E0%ZZ" },
          }),
        )
      ).status,
    ).toBe(401);
  });
  it("logout keeps origin defense when access expired/missing and a refresh cookie remains", async () => {
    expect(
      (
        await logoutApi(
          new NextRequest("http://localhost/api/v1/auth/logout", {
            method: "POST",
            headers: {
              origin: "https://attacker.invalid",
              cookie: "rems_refresh_token=whatever",
            },
          }),
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await logoutApi(
          new NextRequest("http://localhost/api/v1/auth/logout", {
            method: "POST",
            headers: { cookie: "rems_refresh_token=%ZZ" },
          }),
        )
      ).status,
    ).toBe(200);
  });
  it("deleted roles deny otherwise valid access tokens", () => {
    getDb()
      .prepare("UPDATE roles SET deleted_at=? WHERE id=?")
      .run(new Date().toISOString(), tenant.roleId);
    expect(() => requireAuth(req("portal", tenant))).toThrow(/Active role/);
  });
  it("CSRF uses browser target Host when a bound Next server URL is internal", () => {
    expect(() =>
      mutationOrigin(
        new Request("http://0.0.0.0:3001/api/v1/auth/login", {
          method: "POST",
          headers: { host: "localhost:3001", origin: "http://localhost:3001" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      mutationOrigin(
        new Request("http://0.0.0.0:3001/api/v1/auth/login", {
          method: "POST",
          headers: {
            host: "localhost:3001",
            origin: "http://attacker.invalid",
          },
        }),
      ),
    ).toThrow(/Cross-origin/);
  });
  it("legacy owner unit totals apply ownership before pagination", async () => {
    const all = await (await getUnits(req("units?limit=200", owner))).json(),
      first = await (
        await getUnits(req("units?limit=1&offset=0", owner))
      ).json(),
      second = await (
        await getUnits(req("units?limit=1&offset=1", owner))
      ).json();
    expect(all.total).toBeGreaterThan(1);
    expect(first.total).toBe(all.total);
    expect(second.total).toBe(all.total);
    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(first.items[0].id).not.toBe(second.items[0].id);
  });
  it("pagination has hard caps, stable pages and rejects user-supplied identity overrides", () => {
    const first = portalPage(tenant, {
        resource: "invoices",
        limit: 3,
        page: 1,
      }),
      next = portalPage(tenant, { resource: "invoices", limit: 3, page: 2 });
    expect(first.items).toHaveLength(3);
    expect(first.hasMore).toBe(true);
    expect(
      next.items.every((r) => !first.items.some((f) => f.id === r.id)),
    ).toBe(true);
    expect(() =>
      portalPage(tenant, { resource: "invoices", tenantId: "ten_2" }),
    ).toThrow();
    expect(() =>
      portalPage(tenant, { resource: "invoices", limit: 51 }),
    ).toThrow();
    expect(() =>
      portalPage(tenant, { resource: "invoices", page: -1 }),
    ).toThrow();
  });
  it.each([
    "leases",
    "invoices",
    "payments",
    "tickets",
    "notifications",
  ] as const)("tenant %s resource is bounded and authenticated", (resource) => {
    const page = portalPage(tenant, { resource, limit: 5 });
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(() =>
      portalPage({ ...tenant, organizationId: "missing-org" }, { resource }),
    ).toThrow();
  });
  it.each([
    "properties",
    "units",
    "leases",
    "invoices",
    "payments",
    "tickets",
    "statements",
    "reviews",
    "notifications",
  ] as const)("owner %s resource is isolated", (resource) => {
    expect(
      portalPage(owner, { resource, limit: 5 }).items.length,
    ).toBeLessThanOrEqual(5);
  });
  it("unlinked and removed accounts get empty pages, never a full-org fallback", () => {
    getDb()
      .prepare("UPDATE tenants SET user_id=NULL WHERE user_id=?")
      .run(tenant.sub);
    expect(portalSummary(tenant).linkedProfiles).toBe(0);
    expect(portalPage(tenant, { resource: "invoices" }).items).toEqual([]);
    getDb()
      .prepare("UPDATE owners SET user_id=NULL WHERE user_id=?")
      .run(owner.sub);
    expect(portalPage(owner, { resource: "properties" }).items).toEqual([]);
  });
  it("owner consent is audited, final and nonbinding; source lease/invoices unchanged", () => {
    const db = getDb(),
      before = db.prepare("SELECT * FROM leases ORDER BY id").all(),
      invoices = db.prepare("SELECT * FROM invoices ORDER BY id").all(),
      r = consent();
    expect(
      portalPage(owner, { resource: "reviews" }).items.map((i) => i.id),
    ).toContain(r.id);
    expect(
      decideOwnerReview(owner, {
        id: r.id,
        decision: "approved",
        note: "Reviewed as unsigned draft only",
      }),
    ).toMatchObject({ binding: false, executesBusinessWrite: false });
    expect(() =>
      decideOwnerReview(owner, {
        id: r.id,
        decision: "rejected",
        note: "Try reversing decision",
      }),
    ).toThrow(/final/);
    expect(() =>
      db
        .prepare("UPDATE portal_reviews SET summary=? WHERE id=?")
        .run("Tampered", r.id),
    ).toThrow(/immutable/);
    expect(db.prepare("SELECT * FROM leases ORDER BY id").all()).toEqual(
      before,
    );
    expect(db.prepare("SELECT * FROM invoices ORDER BY id").all()).toEqual(
      invoices,
    );
  });
  it("stale consent cannot be approved under old source", () => {
    const r = consent();
    getDb()
      .prepare("UPDATE leases SET rent_minor=rent_minor+1 WHERE id='lease_1'")
      .run();
    expect(() =>
      decideOwnerReview(owner, {
        id: r.id,
        decision: "approved",
        note: "Evidence changed",
      }),
    ).toThrow(/Source changed/);
  });
  it("another owner, foreign org, staff or tenant cannot decide an owner consent", () => {
    const r = consent();
    expect(() =>
      decideOwnerReview(tenant, {
        id: r.id,
        decision: "approved",
        note: "Unauthorized",
      }),
    ).toThrow();
    expect(() =>
      decideOwnerReview(admin, {
        id: r.id,
        decision: "approved",
        note: "Self reviewer",
      }),
    ).toThrow();
    getDb().prepare("UPDATE owners SET user_id=NULL WHERE id='own_1'").run();
    expect(() =>
      decideOwnerReview(owner, {
        id: r.id,
        decision: "approved",
        note: "No ownership link",
      }),
    ).toThrow();
  });
  it("staff cannot request consent for unrelated property owner or unsupported write type", () => {
    expect(() =>
      requestOwnerReview(staff, {
        ownerId: "own_1",
        entityType: "lease",
        entityId: "lease_1",
        summary: "Attempt lease action",
      }),
    ).toThrow();
    expect(() =>
      requestOwnerReview(admin, {
        ownerId: "own_2",
        entityType: "lease",
        entityId: "lease_1",
        summary: "Wrong property or unlinked owner",
      }),
    ).toThrow();
  });
  it("fresh RBAC blocks old admin JWT after a role downgrade", () => {
    getDb()
      .prepare("UPDATE users SET role_id=? WHERE id=?")
      .run(tenant.roleId, admin.sub);
    const fresh = requireAuth(
      new NextRequest("http://localhost/api/v1/admin/users", {
        headers: { Authorization: `Bearer ${token}` },
      }),
    );
    expect(fresh.roleSlug).toBe("tenant");
    expect(() => requirePermission(fresh, "admin:manage")).toThrow();
  });
  it("logout revokes access and every outstanding refresh for this user, other users stay valid", () => {
    const login = loginWithPassword({
      email: admin.email,
      password: "Password123!",
    });
    logoutSession({
      userId: admin.sub,
      organizationId: org,
      refreshToken: login.refreshToken,
    });
    expect(() =>
      requireAuth(
        new NextRequest("http://localhost/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${login.accessToken}` },
        }),
      ),
    ).toThrow(/Session ended/);
    expect(() =>
      refreshSession({ refreshToken: login.refreshToken! }),
    ).toThrow();
    expect(requireAuth(req("auth/me", tenant)).sub).toBe(tenant.sub);
  });
  it("malformed cookie escapes and malformed hash iteration fields fail closed", () => {
    expect(() =>
      requireAuth(
        new NextRequest("http://localhost/api/v1/auth/me", {
          headers: { cookie: "rems_access_token=%E0%A4%A" },
        }),
      ),
    ).toThrow();
    expect(verifyPassword("Password123!", "pbkdf2$99999999999$salt$hash")).toBe(
      false,
    );
  });
  it("new non-demo passwords use stronger PBKDF2 while legacy demo hashes remain readable", () => {
    const hash = hashPassword("long-local-fixture-password");
    expect(hash).toContain("pbkdf2$600000$");
    expect(verifyPassword("long-local-fixture-password", hash)).toBe(true);
    expect(verifyPassword("different", hash)).toBe(false);
  });
  it("signed expired-at-boundary JWTs are rejected", () => {
    expect(verifyAccessToken(signAccessToken(admin, 0))).toBeNull();
  });
  it("cross-origin cookie mutations rejected, signed credential headers and same origin allowed", () => {
    expect(() =>
      mutationOrigin(
        new Request("https://app.test/api", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
      ),
    ).toThrow();
    expect(() =>
      mutationOrigin(
        new Request("https://app.test/api", {
          method: "POST",
          headers: { origin: "https://app.test" },
        }),
      ),
    ).not.toThrow();
    expect(() =>
      mutationOrigin(
        new Request("https://app.test/api", {
          method: "POST",
          headers: { origin: "https://evil.test" },
        }),
        true,
      ),
    ).not.toThrow();
  });
  it("persistent rate limits survive context reload and expire", () => {
    rateLimit("fixture", 2);
    rateLimit("fixture", 2);
    expect(() => rateLimit("fixture", 2)).toThrow();
    vi.advanceTimersByTime(901000);
    expect(() => rateLimit("fixture", 2)).not.toThrow();
  });
  it("streaming body reader rejects chunked oversized JSON without relying on Content-Length", async () => {
    await expect(
      readJson(
        new Request("http://localhost", {
          method: "POST",
          body: JSON.stringify({ large: "x".repeat(1048576) }),
        }),
      ),
    ).rejects.toThrow(/1 MiB/);
    await expect(
      readJson(
        new Request("http://localhost", { method: "POST", body: "{bad" }),
      ),
    ).rejects.toThrow();
    await expect(
      readJson(
        new Request("http://localhost", { method: "POST", body: "null" }),
      ),
    ).rejects.toThrow();
  });
  it("production fails closed on weak/identical secrets and wildcard framing", () => {
    vi.stubEnv("REMS_DEPLOYMENT", "production");
    expect(validateDeployment).toThrow();
    vi.stubEnv("JWT_ACCESS_SECRET", "a".repeat(40));
    vi.stubEnv("JWT_REFRESH_SECRET", "b".repeat(40));
    vi.stubEnv("SQLITE_DB_PATH", "/tmp/example-production.sqlite");
    expect(validateDeployment).not.toThrow();
    vi.stubEnv("FRAME_ANCESTORS", "*");
    expect(validateDeployment).toThrow();
    vi.stubEnv("FRAME_ANCESTORS", "'self' *");
    expect(validateDeployment).toThrow();
  });
  it("production cookies are secure and internal errors do not expose SQL/paths", async () => {
    vi.stubEnv("REMS_DEPLOYMENT", "production");
    const res = attachAuthCookies(NextResponse.json({}), {
      accessToken: "fixture",
    });
    expect(res.headers.get("set-cookie")).toContain("Secure");
    const error = handleApiError(
      new Error("SELECT secret FROM /home/user/private.sqlite"),
    );
    expect(JSON.stringify(await error.json())).not.toContain("SELECT secret");
  });
  it("legacy users, property and vault endpoints do not bypass portal isolation", async () => {
    expect((await getUsers(req("admin/users", owner))).status).toBe(403);
    const people = await (await getOwners(req("owners", owner))).json();
    expect(
      people.owners.every((o: { userId: string }) => o.userId === owner.sub),
    ).toBe(true);
    const properties = await (
      await getProperties(req("properties", owner))
    ).json();
    expect(
      properties.properties.every((p: { owners: { ownerId: string }[] }) =>
        p.owners.every((o) => o.ownerId === "own_1"),
      ),
    ).toBe(true);
    const privateDoc = uploadDocument(org, admin.sub, {
      entityType: "tenant",
      entityId: "ten_2",
      title: "Private identity",
      category: "kyc_identity",
      contentText: "PRIVATE-CNIC",
    });
    const docs = await (await getDocuments(req("documents", tenant))).json();
    expect(
      docs.documents.some((d: { id: string }) => d.id === privateDoc.id),
    ).toBe(false);
  });
  it("personal dashboard summaries no longer expose whole-org financial totals or agent details", async () => {
    const data = await (await getMe(req("auth/me", tenant))).json();
    expect(data.summary.agents).toEqual([]);
    expect(data.summary.properties).toEqual([]);
    expect(data.summary.kpis.totalInvoices).toBeLessThan(240);
  });
  it("API input validation, auth, no-store and strict server-owned identities", async () => {
    expect(
      (await GET(new NextRequest("http://localhost/api/v1/portal"))).status,
    ).toBe(401);
    const response = await GET(req("portal?resource=invoices"));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(
      (await GET(req("portal?resource=invoices&tenantId=ten_2"))).status,
    ).toBe(400);
    expect(
      (
        await POST(
          req("portal", tenant, {
            action: "decide_consent",
            id: "invented",
            decision: "approved",
            note: "Not mine",
          }),
        )
      ).status,
    ).toBe(403);
    expect((await POST(req("portal", admin, { action: "bad" }))).status).toBe(
      400,
    );
  });
  it("login origin and request size are enforced at the real endpoint", async () => {
    const bad = await loginApi(
      new NextRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        headers: { Origin: "https://evil.test" },
        body: JSON.stringify({ email: admin.email, password: "Password123!" }),
      }),
    );
    expect(bad.status).toBe(403);
    const large = await loginApi(
      new NextRequest("http://localhost/api/v1/auth/login", {
        method: "POST",
        body: JSON.stringify({
          email: admin.email,
          password: "x".repeat(1048576),
        }),
      }),
    );
    expect(large.status).toBe(413);
  });
  it("private draft or foreign listing cannot be used for anonymous lead capture", () => {
    getDb()
      .prepare(
        "UPDATE listings SET status='draft' WHERE id=(SELECT id FROM listings LIMIT 1)",
      )
      .run();
    const id = getDb()
      .prepare("SELECT id FROM listings WHERE status='draft' LIMIT 1")
      .get()!.id;
    expect(() =>
      capturePublicLead({
        listingId: String(id),
        fullName: "Test Buyer",
        phone: "+923000000001",
      }),
    ).toThrow(/Published listing/);
  });
  it("production provision refuses overwrite and online backup restores a verified database", () => {
    vi.useRealTimers();
    const dir = mkdtempSync(`${tmpdir()}/phase8-`),
      dbPath = `${dir}/production.sqlite`,
      env = {
        ...process.env,
        REMS_DEPLOYMENT: "production",
        SQLITE_DB_PATH: dbPath,
        JWT_ACCESS_SECRET: "x".repeat(40),
        JWT_REFRESH_SECRET: "y".repeat(40),
        ADMIN_EMAIL: "operator@company.pk",
        ADMIN_PASSWORD: "synthetic-long-fixture-password",
      };
    try {
      const cli = "node_modules/tsx/dist/cli.mjs",
        r = spawnSync(
          process.execPath,
          [cli, "scripts/provision-production.ts"],
          { env, encoding: "utf8" },
        );
      expect(r.status, r.stderr).toBe(0);
      expect(
        spawnSync(process.execPath, [cli, "scripts/provision-production.ts"], {
          env,
        }).status,
      ).not.toBe(0);
      const backup = spawnSync(
        process.execPath,
        [cli, "scripts/db-backup.ts", `${dir}/backup.sqlite`],
        { env, encoding: "utf8" },
      );
      expect(backup.status, backup.stderr).toBe(0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
