import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { getDb, resetDbForTesting } from "@/server/db";
import {
  applyBusinessProfile,
  COMPANY_ID,
  OFFICE_ID,
  PROJECTS,
} from "@/server/db/business-profile";
import {
  listDemoAccounts,
  loginWithPassword,
  buildAuthenticatedUserView,
} from "@/server/modules/auth/auth.service";
import {
  listBranches,
  getDashboardSummary,
} from "@/server/modules/admin/admin.service";
import { listListings } from "@/server/modules/listings/listings.service";
import { requireAuth } from "@/server/auth/guards";
import {
  generateOwnerStatements,
  recordOwnerPayout,
} from "@/server/modules/billing/billing.service";
import { GET as publicListings } from "@/app/api/v1/listings/route";
beforeEach(() => resetDbForTesting());
const login = (email: string) =>
  loginWithPassword({ email, password: "Password123!" });
describe("Fahad Real Estate business setup", () => {
  it("migrates existing data to one active company, one office and exactly the five named projects", () => {
    const db = getDb();
    applyBusinessProfile(db);
    expect(
      db
        .prepare(
          "SELECT name,legal_name FROM organizations WHERE deleted_at IS NULL",
        )
        .all(),
    ).toEqual([{ name: "Fahad Real Estate", legal_name: "Fahad Real Estate" }]);
    const branches = listBranches(COMPANY_ID) as {
      id: string;
      city: string;
      address: string;
      phone: string | null;
    }[];
    expect(branches).toHaveLength(1);
    expect(branches[0]).toMatchObject({
      id: OFFICE_ID,
      city: "Rahim Yar Khan",
      address: "Rahim Yar Khan, Punjab, Pakistan",
      phone: null,
    });
    const properties = db
      .prepare(
        "SELECT id,name,city,latitude,longitude,branch_id FROM properties WHERE organization_id=? AND deleted_at IS NULL ORDER BY id",
      )
      .all(COMPANY_ID);
    expect(properties.map((p) => p.name)).toEqual(PROJECTS.map((p) => p[1]));
    expect(
      properties.every(
        (p) =>
          p.city === "Rahim Yar Khan" &&
          p.branch_id === OFFICE_ID &&
          p.latitude === null &&
          p.longitude === null,
      ),
    ).toBe(true);
    expect(db.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });
  it("preserves unit identities, money, payments, leases and immutable paid statements", () => {
    const db = getDb();
    const snapshots = () => ({
      units: db.prepare("SELECT id,unit_number FROM units ORDER BY id").all(),
      payments: db.prepare("SELECT * FROM payments ORDER BY id").all(),
      invoices: db
        .prepare("SELECT id,total_minor,paid_minor FROM invoices ORDER BY id")
        .all(),
      leases: db
        .prepare(
          "SELECT id,unit_id,tenant_id,rent_minor,status FROM leases ORDER BY id",
        )
        .all(),
    });
    const stmt = generateOwnerStatements(COMPANY_ID, "usr_admin", "2026-10")[0];
    recordOwnerPayout(
      COMPANY_ID,
      "usr_admin",
      stmt.id,
      "BEFORE-PROFILE-PAYOUT",
    );
    const beforeStatement = db
      .prepare("SELECT * FROM owner_statements WHERE id=?")
      .get(stmt.id);
    const before = snapshots();
    applyBusinessProfile(db);
    expect(snapshots()).toEqual(before);
    expect(
      db.prepare("SELECT * FROM owner_statements WHERE id=?").get(stmt.id),
    ).toEqual(beforeStatement);
    const summary = getDashboardSummary({
      organizationId: COMPANY_ID,
      userId: "usr_admin",
      roleSlug: "admin",
      branchId: OFFICE_ID,
    });
    expect(summary.kpis.totalProperties).toBe(5);
    expect(summary.kpis.totalUnits).toBe(30);
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM units u JOIN properties p ON p.id=u.property_id WHERE u.deleted_at IS NULL AND p.deleted_at IS NOT NULL",
        )
        .get()!.n,
    ).toBe(0);
  });
  it("updates all demo roles, accepts legacy sign-in aliases and hides unrelated company accounts", () => {
    applyBusinessProfile(getDb());
    const accounts = listDemoAccounts() as {
      email: string;
      organizationName: string;
      branchCity: string;
    }[];
    expect(accounts).toHaveLength(6);
    expect(
      accounts.every(
        (a) =>
          a.email.endsWith("@fahadrealestate.test") &&
          a.organizationName === "Fahad Real Estate" &&
          a.branchCity === "Rahim Yar Khan",
      ),
    ).toBe(true);
    for (const role of [
      "admin",
      "agent",
      "accountant",
      "maintenance",
      "owner",
      "tenant",
    ])
      expect(login(`${role}@fahadrealestate.test`).accessToken).toBeTruthy();
    expect(login("admin@pakland.pk").accessToken).toBeTruthy();
    expect(() => login("admin@indusvalley.pk")).toThrow(
      "Invalid email or password",
    );
  });
  it("rejects retired-company access tokens but preserves the primary account session", () => {
    const old = login("admin@indusvalley.pk").accessToken!,
      primary = login("admin@fahadrealestate.test").accessToken!;
    applyBusinessProfile(getDb());
    expect(() =>
      requireAuth(
        new NextRequest("http://localhost/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${old}` },
        }),
      ),
    ).toThrow("Authentication required");
    expect(
      requireAuth(
        new NextRequest("http://localhost/api/v1/auth/me", {
          headers: { Authorization: `Bearer ${primary}` },
        }),
      ).sub,
    ).toBe("usr_admin");
    expect(
      buildAuthenticatedUserView("usr_admin", COMPANY_ID).organization.name,
    ).toBe("Fahad Real Estate");
  });
  it("cleans sample listing location/approval claims and resolves listings to the actual unit project", async () => {
    const db = getDb();
    applyBusinessProfile(db);
    const listings = listListings({ organizationId: COMPANY_ID });
    expect(listings).toHaveLength(8);
    for (const l of listings) {
      expect(l.city).toBe("Rahim Yar Khan");
      expect(l.descriptionEn).not.toMatch(
        /LDA-approved|Rawalpindi|Islamabad|Lahore/,
      );
      expect(l.titleEn).toContain(l.propertyName);
      expect(l.slug).toContain("rahim-yar-khan");
      const unit = db
        .prepare("SELECT property_id FROM units WHERE id=?")
        .get(l.unitId)!;
      expect(unit.property_id).toBe(l.propertyId);
    }
    const response = await publicListings(
      new NextRequest("http://localhost/api/v1/listings?public=true"),
    );
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(JSON.stringify(data)).not.toMatch(
      /LDA-approved|Rawalpindi|Islamabad|Lahore|PakLand/,
    );
    expect(
      db.prepare("SELECT tags_json FROM documents WHERE id='doc_1'").get()!
        .tags_json,
    ).toContain("unverified");
  });
  it("runs only once, preserves later edits, and does not recreate removed fixture records", () => {
    const db = getDb();
    applyBusinessProfile(db);
    db.prepare(
      "UPDATE branches SET address='User supplied street address' WHERE id=?",
    ).run(OFFICE_ID);
    applyBusinessProfile(db);
    expect(
      db.prepare("SELECT address FROM branches WHERE id=?").get(OFFICE_ID)!
        .address,
    ).toBe("User supplied street address");
    expect(
      db
        .prepare(
          "SELECT COUNT(*) AS n FROM audit_logs WHERE action='business.profile_corrected'",
        )
        .get()!.n,
    ).toBe(1);
  });
});
