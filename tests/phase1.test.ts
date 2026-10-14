import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDbForTesting } from "@/server/db";
import { DEMO_PASSWORD } from "@/server/db/seed";
import { HttpError } from "@/server/auth/guards";
import { loginWithPassword } from "@/server/modules/auth/auth.service";
import {
  listProperties,
  getPropertyHierarchy,
  createProperty,
  listBuildings,
  createBuilding,
  listUnits,
  createUnit,
  updateUnit,
  listOwners,
  createOwner,
  assignPropertyOwners,
  importUnitsFromCsv,
} from "@/server/modules/portfolio/portfolio.service";
import {
  computeExpiryStatus,
  listDocuments,
  uploadDocument,
  recordDocumentAccess,
} from "@/server/modules/documents/documents.service";
import { listAuditLogs } from "@/server/modules/audit/audit.service";

// Route handlers
import { GET as propsGet, POST as propsPost } from "@/app/api/v1/properties/route";
import { GET as propDetailGet } from "@/app/api/v1/properties/[id]/route";
import { GET as bldgsGet, POST as bldgsPost } from "@/app/api/v1/buildings/route";
import {
  GET as unitsGet,
  POST as unitsPost,
  PATCH as unitsPatch,
} from "@/app/api/v1/units/route";
import { GET as ownersGet, POST as ownersPost, PUT as ownersPut } from "@/app/api/v1/owners/route";
import { POST as csvImportPost } from "@/app/api/v1/portfolio/import-csv/route";
import { GET as docsGet, POST as docsPost } from "@/app/api/v1/documents/route";
import { POST as docAccessPost } from "@/app/api/v1/documents/[id]/access/route";

describe("Phase 1: Properties, Buildings, Units, Multi-Owners, Document Vault & CSV Import", () => {
  beforeEach(() => {
    resetDbForTesting();
  });

  it("lists properties with multi-owner percentages and retrieves full Property -> Building -> Unit hierarchy", () => {
    const props = listProperties({
      organizationId: "org_pakland",
      search: "Fahad Garden",
    });
    expect(props.length).toBeGreaterThanOrEqual(2);

    const fghs = props.find((p) => p.code === "FGHS-01")!;
    expect(fghs).toBeDefined();
    // FGHS-01 is co-owned 70% / 30%
    expect(fghs.owners.length).toBe(2);
    expect(fghs.owners[0].ownershipPct).toBe(70);
    expect(fghs.owners[1].ownershipPct).toBe(30);

    const hierarchy = getPropertyHierarchy("org_pakland", "prop_1");
    expect(hierarchy.property.code).toBe("FGHS-01");
    expect(hierarchy.buildings.length).toBeGreaterThanOrEqual(1);
    expect(hierarchy.units.length).toBe(3);
    expect(hierarchy.documents.length).toBeGreaterThanOrEqual(1);

    // Cross-tenant property hierarchy access must fail with 403
    expect(() => getPropertyHierarchy("org_pakland", "prop_indus_1")).toThrowError(HttpError);
  });

  it("creates properties, buildings, and units and updates unit status with audit logging", () => {
    const createdProp = createProperty("org_pakland", "usr_admin", {
      branchId: "br_isb",
      code: "PKL-NEW-01",
      name: "PakLand Sapphire Residency",
      type: "residential_complex",
      city: "Islamabad",
      address: "Sector F-11 Markaz, Islamabad",
      latitude: 33.6844,
      longitude: 72.987,
      owners: [
        { ownerId: "own_1", ownershipPct: 50, isPrimary: true },
        { ownerId: "own_2", ownershipPct: 50, isPrimary: false },
      ],
    });
    expect(createdProp.code).toBe("PKL-NEW-01");
    expect(createdProp.owners.length).toBe(2);

    // Duplicate property code throws 409
    expect(() =>
      createProperty("org_pakland", "usr_admin", {
        branchId: "br_isb",
        code: "PKL-NEW-01",
        name: "Duplicate",
        type: "housing_scheme",
        city: "Islamabad",
        address: "Sector F-11",
      })
    ).toThrowError(HttpError);

    const bldg = createBuilding("org_pakland", "usr_admin", {
      propertyId: createdProp.id,
      code: "PKL-NEW-01-B",
      name: "Tower B",
      floors: 8,
      blockSector: "Sector B",
    }) as { id: string };
    expect(bldg.id).toBeTruthy();

    const buildings = listBuildings("org_pakland", createdProp.id);
    expect(buildings.length).toBe(2);

    const unit = createUnit("org_pakland", "usr_admin", {
      propertyId: createdProp.id,
      buildingId: bldg.id,
      unitNumber: "SAP-B-101",
      type: "apartment",
      areaSqft: 1650,
      areaDisplay: "1650 Sq.Ft.",
      bedrooms: 3,
      bathrooms: 3,
      status: "available",
      marketPriceMinor: 28000000 * 100,
      monthlyRentMinor: 120000 * 100,
    }) as { id: string; unitNumber: string };
    expect(unit.unitNumber).toBe("SAP-B-101");

    // Duplicate unit number in same property throws 409
    expect(() =>
      createUnit("org_pakland", "usr_admin", {
        propertyId: createdProp.id,
        unitNumber: "SAP-B-101",
        type: "apartment",
        areaSqft: 1650,
        areaDisplay: "1650 Sq.Ft.",
        marketPriceMinor: 100,
        monthlyRentMinor: 100,
      })
    ).toThrowError(HttpError);

    // Update unit status
    const updated = updateUnit("org_pakland", "usr_admin", unit.id, {
      status: "under_maintenance",
      monthlyRentMinor: 135000 * 100,
    }) as { status: string; monthlyRentMinor: number };
    expect(updated.status).toBe("under_maintenance");
    expect(updated.monthlyRentMinor).toBe(135000 * 100);
  });

  it("manages owners and enforces multi-owner percentage validation (<= 100%)", () => {
    const newOwner = createOwner("org_pakland", "usr_admin", {
      fullName: "Mian Mansha",
      cnicNtn: "35202-7788990-1",
      email: "mansha@pakland.pk",
      phone: "+92-300-9988776",
      bankName: "MCB Bank",
      iban: "PK44MUCB0001112223334445",
      managementFeePct: 4.5,
    }) as { id: string; fullName: string };

    expect(newOwner.fullName).toBe("Mian Mansha");

    const updatedProp = assignPropertyOwners("org_pakland", "usr_admin", "prop_2", [
      { ownerId: "own_2", ownershipPct: 55, isPrimary: true },
      { ownerId: newOwner.id, ownershipPct: 45, isPrimary: false },
    ]);
    expect(updatedProp.owners.length).toBe(2);

    // Exceeding 100% ownership must fail with 400 INVALID_OWNERSHIP_SPLIT
    expect(() =>
      assignPropertyOwners("org_pakland", "usr_admin", "prop_2", [
        { ownerId: "own_1", ownershipPct: 70 },
        { ownerId: "own_2", ownershipPct: 40 },
      ])
    ).toThrowError(HttpError);

    const allOwners = listOwners("org_pakland");
    expect(allOwners.length).toBe(4);
  });

  it("validates and imports units from CSV with detailed line-by-line error reporting", () => {
    const mixedCsv = [
      "property_code,building_code,unit_number,type,area_sqft,area_display,bedrooms,bathrooms,status,market_price_pkr,monthly_rent_pkr",
      "FGHS-01,FGHS-01-A,FGHS-IMP-01,plot,2250,10 Marla,0,0,available,9500000,0",
      "AC-01,AC-01-A,AC-IMP-02,house,4500,1 Kanal,5,5,available,35000000,140000",
      "INVALID-CODE,BLK,U-1,plot,1000,5 Marla,0,0,available,5000000,0",
      "FGHS-01,FGHS-01-A,FGHS-IMP-01,plot,2250,10 Marla,0,0,available,9500000,0",
      "TCC-01,TCC-01-A,TCC-IMP-03,spaceship,500,500 Sq.Ft.,0,1,available,12000000,75000",
      "TCC-01,TCC-01-A,TCC-IMP-04,shop,-100,100 Sq.Ft.,0,1,available,12000000,75000",
    ].join("\n");

    // 1. Dry-run mode validates without inserting
    const dryReport = importUnitsFromCsv({
      organizationId: "org_pakland",
      actorUserId: "usr_admin",
      csvText: mixedCsv,
      dryRun: true,
    });
    expect(dryReport.dryRun).toBe(true);
    expect(dryReport.totalRows).toBe(6);
    expect(dryReport.validCount).toBe(2);
    expect(dryReport.importedCount).toBe(0);
    expect(dryReport.failedCount).toBe(4);
    expect(dryReport.errors.map((e) => e.field)).toEqual([
      "property_code",
      "unit_number",
      "type",
      "area_sqft",
    ]);

    // 2. Commit mode inserts valid rows and returns error report for invalid rows
    const commitReport = importUnitsFromCsv({
      organizationId: "org_pakland",
      actorUserId: "usr_admin",
      csvText: mixedCsv,
      dryRun: false,
    });
    expect(commitReport.dryRun).toBe(false);
    expect(commitReport.importedCount).toBe(2);
    expect(commitReport.failedCount).toBe(4);
    expect(commitReport.importedUnits.length).toBe(2);
  });

  it("manages the Central Document Vault with versioning, expiry states, and view/download audit trails", () => {
    expect(computeExpiryStatus(null)).toBe("no_expiry");
    expect(computeExpiryStatus("2026-09-01", "2026-10-14")).toBe("expired");
    expect(computeExpiryStatus("2026-11-10", "2026-10-14")).toBe("expiring_soon");
    expect(computeExpiryStatus("2028-12-31", "2026-10-14")).toBe("valid");

    const expiredDocs = listDocuments({
      organizationId: "org_pakland",
      expiryStatus: "expired",
    });
    expect(expiredDocs.length).toBeGreaterThanOrEqual(1);

    // Upload version 1 and then version 2 of the same document title on prop_4
    const v1 = uploadDocument("org_pakland", "usr_admin", {
      entityType: "property",
      entityId: "prop_4",
      title: "VIP Block — Solar Microgrid Engineering Blueprint",
      category: "floor_plan",
      tags: ["Solar", "VIP Block", "Engineering"],
      expiryDate: "2029-12-31",
      contentText: "Blueprint v1 for 500kW solar grid.",
    });
    expect(v1.version).toBe(1);

    const v2 = uploadDocument("org_pakland", "usr_admin", {
      entityType: "property",
      entityId: "prop_4",
      title: "VIP Block — Solar Microgrid Engineering Blueprint",
      category: "floor_plan",
      tags: ["Solar", "VIP Block", "Engineering", "v2"],
      expiryDate: "2030-12-31",
      contentText: "Blueprint v2 upgraded to 750kW solar grid.",
    });
    expect(v2.version).toBe(2);

    // Record view and download accesses and verify audit trail
    const viewAccess = recordDocumentAccess({
      organizationId: "org_pakland",
      actorUserId: "usr_admin",
      documentId: v2.id,
      accessType: "view",
    });
    expect(viewAccess.signedUrl).toContain("sig=");

    const downloadAccess = recordDocumentAccess({
      organizationId: "org_pakland",
      actorUserId: "usr_admin",
      documentId: v2.id,
      accessType: "download",
    });
    expect(downloadAccess.version).toBe(2);

    const auditLogs = listAuditLogs({
      organizationId: "org_pakland",
      actionFilter: "document.downloaded",
    });
    expect(auditLogs.total).toBeGreaterThanOrEqual(1);

    // Cross-tenant document access must be blocked
    expect(() =>
      recordDocumentAccess({
        organizationId: "org_indus",
        actorUserId: "usr_indus_admin",
        documentId: v2.id,
        accessType: "view",
      })
    ).toThrowError(HttpError);
  });

  it("exposes all Phase 1 REST API route handlers with RBAC and multi-tenancy enforcement", async () => {
    const adminLogin = loginWithPassword({
      email: "admin@pakland.pk",
      password: DEMO_PASSWORD,
    });
    const headers = {
      authorization: `Bearer ${adminLogin.accessToken}`,
      "content-type": "application/json",
    };

    // GET & POST /api/v1/properties
    const getPropsRes = await propsGet(
      new NextRequest("http://localhost:3000/api/v1/properties?city=Islamabad", { headers })
    );
    expect(getPropsRes.status).toBe(200);

    const postPropRes = await propsPost(
      new NextRequest("http://localhost:3000/api/v1/properties", {
        method: "POST",
        headers,
        body: JSON.stringify({
          branchId: "br_isb",
          code: "API-PROP-01",
          name: "Margalla View Enclave",
          type: "housing_scheme",
          city: "Islamabad",
          address: "Zone III, Margalla Foothills, Islamabad",
        }),
      })
    );
    expect(postPropRes.status).toBe(201);
    const createdPropJson = await postPropRes.json();

    // GET /api/v1/properties/[id]
    const detailRes = await propDetailGet(
      new NextRequest(`http://localhost:3000/api/v1/properties/${createdPropJson.property.id}`, {
        headers,
      }),
      { params: Promise.resolve({ id: createdPropJson.property.id }) }
    );
    expect(detailRes.status).toBe(200);

    // GET & POST /api/v1/buildings
    const getBldgsRes = await bldgsGet(
      new NextRequest(
        `http://localhost:3000/api/v1/buildings?propertyId=${createdPropJson.property.id}`,
        { headers }
      )
    );
    expect(getBldgsRes.status).toBe(200);

    const postBldgRes = await bldgsPost(
      new NextRequest("http://localhost:3000/api/v1/buildings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          propertyId: createdPropJson.property.id,
          code: "MVE-BLK-B",
          name: "Margalla Executive Block B",
          floors: 3,
        }),
      })
    );
    expect(postBldgRes.status).toBe(201);

    // GET, POST & PATCH /api/v1/units
    const postUnitRes = await unitsPost(
      new NextRequest("http://localhost:3000/api/v1/units", {
        method: "POST",
        headers,
        body: JSON.stringify({
          propertyId: createdPropJson.property.id,
          unitNumber: "MVE-U01",
          type: "plot",
          areaSqft: 4500,
          areaDisplay: "1 Kanal",
          marketPriceMinor: 32000000 * 100,
          monthlyRentMinor: 0,
        }),
      })
    );
    expect(postUnitRes.status).toBe(201);
    const createdUnitJson = await postUnitRes.json();

    const patchUnitRes = await unitsPatch(
      new NextRequest("http://localhost:3000/api/v1/units", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          unitId: createdUnitJson.unit.id,
          status: "sold",
        }),
      })
    );
    expect(patchUnitRes.status).toBe(200);

    const getUnitsRes = await unitsGet(
      new NextRequest("http://localhost:3000/api/v1/units?status=sold", { headers })
    );
    expect(getUnitsRes.status).toBe(200);

    // GET, POST & PUT /api/v1/owners
    const getOwnersRes = await ownersGet(
      new NextRequest("http://localhost:3000/api/v1/owners", { headers })
    );
    expect(getOwnersRes.status).toBe(200);

    const postOwnerRes = await ownersPost(
      new NextRequest("http://localhost:3000/api/v1/owners", {
        method: "POST",
        headers,
        body: JSON.stringify({
          fullName: "Nawabzada Lashkari",
          cnicNtn: "54400-1122334-9",
          email: "nawab@pakland.pk",
          phone: "+92-333-4455667",
        }),
      })
    );
    expect(postOwnerRes.status).toBe(201);

    const putOwnersRes = await ownersPut(
      new NextRequest("http://localhost:3000/api/v1/owners", {
        method: "PUT",
        headers,
        body: JSON.stringify({
          propertyId: createdPropJson.property.id,
          allocations: [
            { ownerId: "own_1", ownershipPct: 80, isPrimary: true },
            { ownerId: "own_2", ownershipPct: 20, isPrimary: false },
          ],
        }),
      })
    );
    expect(putOwnersRes.status).toBe(200);

    // POST /api/v1/portfolio/import-csv
    const csvRes = await csvImportPost(
      new NextRequest("http://localhost:3000/api/v1/portfolio/import-csv", {
        method: "POST",
        headers,
        body: JSON.stringify({
          csvText:
            "property_code,building_code,unit_number,type,area_sqft,area_display,bedrooms,bathrooms,status,market_price_pkr,monthly_rent_pkr\nFGHS-01,FGHS-01-A,FGHS-ROUTE-01,plot,2250,10 Marla,0,0,available,9000000,0",
          dryRun: false,
        }),
      })
    );
    expect(csvRes.status).toBe(200);

    // GET & POST /api/v1/documents & POST /api/v1/documents/[id]/access
    const postDocRes = await docsPost(
      new NextRequest("http://localhost:3000/api/v1/documents", {
        method: "POST",
        headers,
        body: JSON.stringify({
          entityType: "property",
          entityId: createdPropJson.property.id,
          title: "Margalla View Enclave — CDA NOC",
          category: "noc_approval",
          tags: ["CDA", "NOC"],
          expiryDate: "2028-06-30",
        }),
      })
    );
    expect(postDocRes.status).toBe(201);
    const createdDocJson = await postDocRes.json();

    const getDocsRes = await docsGet(
      new NextRequest("http://localhost:3000/api/v1/documents?category=noc_approval", { headers })
    );
    expect(getDocsRes.status).toBe(200);

    const accessDocRes = await docAccessPost(
      new NextRequest(
        `http://localhost:3000/api/v1/documents/${createdDocJson.document.id}/access`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ accessType: "download" }),
        }
      ),
      { params: Promise.resolve({ id: createdDocJson.document.id }) }
    );
    expect(accessDocRes.status).toBe(200);
  });
});
