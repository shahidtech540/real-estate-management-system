import crypto from "node:crypto";
import { getDb } from "../../db";
import { HttpError } from "../../auth/guards";
import { recordAuditLog } from "../audit/audit.service";

export const VALID_PROPERTY_TYPES = [
  "housing_scheme",
  "commercial_center",
  "residential_complex",
  "mixed_use",
] as const;

export const VALID_UNIT_TYPES = ["plot", "house", "shop", "apartment", "office"] as const;

export const VALID_UNIT_STATUSES = [
  "available",
  "rented",
  "sold",
  "under_maintenance",
] as const;

export interface PropertyOwnerAllocation {
  ownerId: string;
  ownershipPct: number;
  isPrimary?: boolean;
}

export function listProperties(params: {
  organizationId: string;
  branchId?: string;
  type?: string;
  city?: string;
  search?: string;
}) {
  const db = getDb();
  let where = "WHERE p.organization_id = ? AND p.deleted_at IS NULL";
  const args: (string | number)[] = [params.organizationId];

  if (params.branchId) {
    where += " AND p.branch_id = ?";
    args.push(params.branchId);
  }
  if (params.type) {
    where += " AND p.type = ?";
    args.push(params.type);
  }
  if (params.city) {
    where += " AND LOWER(p.city) = LOWER(?)";
    args.push(params.city);
  }
  if (params.search && params.search.trim() !== "") {
    where += " AND (LOWER(p.name) LIKE LOWER(?) OR LOWER(p.code) LIKE LOWER(?) OR LOWER(p.address) LIKE LOWER(?))";
    const q = `%${params.search.trim()}%`;
    args.push(q, q, q);
  }

  const rows = db
    .prepare(`
      SELECT
        p.id,
        p.organization_id as organizationId,
        p.branch_id as branchId,
        p.code,
        p.name,
        p.type,
        p.city,
        p.address,
        p.latitude,
        p.longitude,
        p.status,
        p.amenities_json as amenitiesJson,
        p.created_at as createdAt,
        b.code as branchCode,
        b.name as branchName,
        (SELECT COUNT(*) FROM buildings bldg WHERE bldg.property_id = p.id AND bldg.deleted_at IS NULL) as buildingCount,
        (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.deleted_at IS NULL) as totalUnits,
        (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.status = 'available' AND u.deleted_at IS NULL) as availableUnits,
        (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.status = 'rented' AND u.deleted_at IS NULL) as rentedUnits,
        (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.status = 'sold' AND u.deleted_at IS NULL) as soldUnits,
        (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.status = 'under_maintenance' AND u.deleted_at IS NULL) as maintenanceUnits
      FROM properties p
      LEFT JOIN branches b ON b.id = p.branch_id
      ${where}
      ORDER BY p.created_at ASC, p.id ASC
    `)
    .all(...args) as Array<{
    id: string;
    organizationId: string;
    branchId: string;
    code: string;
    name: string;
    type: string;
    city: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    status: string;
    amenitiesJson: string;
    createdAt: string;
    branchCode: string | null;
    branchName: string | null;
    buildingCount: number;
    totalUnits: number;
    availableUnits: number;
    rentedUnits: number;
    soldUnits: number;
    maintenanceUnits: number;
  }>;

  // Load owners per property
  const ownerRows = db
    .prepare(`
      SELECT
        po.id,
        po.property_id as propertyId,
        po.owner_id as ownerId,
        po.ownership_pct as ownershipPct,
        po.is_primary as isPrimary,
        o.full_name as fullName,
        o.email,
        o.cnic_ntn as cnicNtn
      FROM property_owners po
      JOIN owners o ON o.id = po.owner_id
      WHERE po.organization_id = ? AND po.deleted_at IS NULL AND o.deleted_at IS NULL
      ORDER BY po.is_primary DESC, po.ownership_pct DESC
    `)
    .all(params.organizationId) as Array<{
    id: string;
    propertyId: string;
    ownerId: string;
    ownershipPct: number;
    isPrimary: number;
    fullName: string;
    email: string;
    cnicNtn: string;
  }>;

  const ownersByProp = new Map<string, typeof ownerRows>();
  for (const orow of ownerRows) {
    const list = ownersByProp.get(orow.propertyId) || [];
    list.push(orow);
    ownersByProp.set(orow.propertyId, list);
  }

  return rows.map((r) => {
    let amenities: string[] = [];
    try {
      amenities = JSON.parse(r.amenitiesJson || "[]");
    } catch {
      amenities = [];
    }
    const propOwners = (ownersByProp.get(r.id) || []).map((o) => ({
      id: o.id,
      ownerId: o.ownerId,
      fullName: o.fullName,
      email: o.email,
      cnicNtn: o.cnicNtn,
      ownershipPct: o.ownershipPct,
      isPrimary: Boolean(o.isPrimary),
    }));

    return {
      id: r.id,
      organizationId: r.organizationId,
      branchId: r.branchId,
      branchCode: r.branchCode,
      branchName: r.branchName,
      code: r.code,
      name: r.name,
      type: r.type,
      city: r.city,
      address: r.address,
      latitude: r.latitude,
      longitude: r.longitude,
      status: r.status,
      amenities,
      buildingCount: r.buildingCount,
      totalUnits: r.totalUnits,
      availableUnits: r.availableUnits,
      rentedUnits: r.rentedUnits,
      soldUnits: r.soldUnits,
      maintenanceUnits: r.maintenanceUnits,
      owners: propOwners,
      createdAt: r.createdAt,
    };
  });
}

export function getPropertyHierarchy(organizationId: string, propertyId: string) {
  const db = getDb();
  const propCheck = db
    .prepare("SELECT id, organization_id as organizationId FROM properties WHERE id = ? AND deleted_at IS NULL")
    .get(propertyId) as { id: string; organizationId: string } | undefined;

  if (!propCheck) {
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property not found.");
  }
  if (propCheck.organizationId !== organizationId) {
    recordAuditLog({
      organizationId,
      action: "security.cross_tenant_blocked",
      entityType: "property",
      entityId: propertyId,
    });
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization property access denied.");
  }

  const properties = listProperties({ organizationId });
  const property = properties.find((p) => p.id === propertyId);
  if (!property) {
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property not found.");
  }

  const buildings = listBuildings(organizationId, propertyId);
  const units = listUnits({ organizationId, propertyId, limit: 200 }).items;
  const documents = db
    .prepare(`
      SELECT
        id, title, category, version, storage_key as storageKey, mime_type as mimeType,
        size_bytes as sizeBytes, tags_json as tagsJson, expiry_date as expiryDate, created_at as createdAt
      FROM documents
      WHERE organization_id = ? AND entity_type = 'property' AND entity_id = ? AND deleted_at IS NULL
      ORDER BY version DESC, created_at DESC
    `)
    .all(organizationId, propertyId);

  return {
    property,
    buildings,
    units,
    documents,
  };
}

export function createProperty(
  organizationId: string,
  actorUserId: string,
  input: {
    branchId: string;
    code: string;
    name: string;
    type: (typeof VALID_PROPERTY_TYPES)[number];
    city: string;
    address: string;
    latitude?: number;
    longitude?: number;
    amenities?: string[];
    initialBuildingName?: string;
    owners?: PropertyOwnerAllocation[];
  }
) {
  const db = getDb();

  const branch = db
    .prepare("SELECT id FROM branches WHERE id = ? AND organization_id = ? AND deleted_at IS NULL")
    .get(input.branchId, organizationId);
  if (!branch) {
    throw new HttpError(400, "INVALID_BRANCH", "Branch does not exist in this organization.");
  }

  const normalizedCode = input.code.trim().toUpperCase();
  const duplicateCode = db
    .prepare("SELECT id FROM properties WHERE organization_id = ? AND UPPER(code) = ? AND deleted_at IS NULL")
    .get(organizationId, normalizedCode);
  if (duplicateCode) {
    throw new HttpError(409, "DUPLICATE_PROPERTY_CODE", `Property code '${normalizedCode}' already exists.`);
  }

  if (input.owners && input.owners.length > 0) {
    const totalPct = input.owners.reduce((acc, item) => acc + item.ownershipPct, 0);
    if (totalPct <= 0 || totalPct > 100.001) {
      throw new HttpError(
        400,
        "INVALID_OWNERSHIP_SPLIT",
        `Total ownership percentage must be between 1% and 100% (got ${totalPct}%).`
      );
    }
  }

  const id = `prop_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const bldgId = `bldg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  db.exec("BEGIN TRANSACTION;");
  try {
    db.prepare(`
      INSERT INTO properties (
        id, organization_id, branch_id, code, name, type, city, address,
        latitude, longitude, total_units, status, amenities_json, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 'active', ?, ?, ?, ?)
    `).run(
      id,
      organizationId,
      input.branchId,
      normalizedCode,
      input.name.trim(),
      input.type,
      input.city.trim(),
      input.address.trim(),
      input.latitude ?? null,
      input.longitude ?? null,
      JSON.stringify(input.amenities || ["24/7 Security", "Electricity", "Water"]),
      now,
      now,
      actorUserId
    );

    // Create default Block A building
    db.prepare(`
      INSERT INTO buildings (
        id, organization_id, property_id, code, name, floors, block_sector, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, 'Block A', ?, ?, ?)
    `).run(
      bldgId,
      organizationId,
      id,
      `${normalizedCode}-A`,
      input.initialBuildingName || `${input.name.trim()} - Block A`,
      input.type === "commercial_center" ? 4 : 2,
      now,
      now,
      actorUserId
    );

    if (input.owners && input.owners.length > 0) {
      const insertOwnerAlloc = db.prepare(`
        INSERT INTO property_owners (
          id, organization_id, property_id, owner_id, ownership_pct, is_primary, created_at, updated_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      input.owners.forEach((alloc, idx) => {
        insertOwnerAlloc.run(
          `po_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
          organizationId,
          id,
          alloc.ownerId,
          alloc.ownershipPct,
          alloc.isPrimary ?? idx === 0 ? 1 : 0,
          now,
          now,
          actorUserId
        );
      });
    }

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "portfolio.property.created",
    entityType: "property",
    entityId: id,
    metadata: { code: normalizedCode, name: input.name, city: input.city },
  });

  return getPropertyHierarchy(organizationId, id).property;
}

export function listBuildings(organizationId: string, propertyId?: string) {
  const db = getDb();
  let where = "WHERE b.organization_id = ? AND b.deleted_at IS NULL";
  const args: string[] = [organizationId];

  if (propertyId) {
    where += " AND b.property_id = ?";
    args.push(propertyId);
  }

  return db
    .prepare(`
      SELECT
        b.id,
        b.organization_id as organizationId,
        b.property_id as propertyId,
        p.name as propertyName,
        p.code as propertyCode,
        b.code,
        b.name,
        b.floors,
        b.block_sector as blockSector,
        (SELECT COUNT(*) FROM units u WHERE u.building_id = b.id AND u.deleted_at IS NULL) as unitCount,
        b.created_at as createdAt
      FROM buildings b
      JOIN properties p ON p.id = b.property_id
      ${where}
      ORDER BY b.created_at ASC
    `)
    .all(...args);
}

export function createBuilding(
  organizationId: string,
  actorUserId: string,
  input: {
    propertyId: string;
    code: string;
    name: string;
    floors?: number;
    blockSector?: string;
  }
) {
  const db = getDb();
  const prop = db
    .prepare("SELECT id FROM properties WHERE id = ? AND organization_id = ? AND deleted_at IS NULL")
    .get(input.propertyId, organizationId);

  if (!prop) {
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property not found in organization.");
  }

  const id = `bldg_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO buildings (
      id, organization_id, property_id, code, name, floors, block_sector, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.propertyId,
    input.code.trim().toUpperCase(),
    input.name.trim(),
    input.floors || 1,
    input.blockSector || "Main Block",
    now,
    now,
    actorUserId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "portfolio.building.created",
    entityType: "building",
    entityId: id,
    metadata: { propertyId: input.propertyId, code: input.code, name: input.name },
  });

  return db
    .prepare(
      `SELECT id, organization_id as organizationId, property_id as propertyId, code, name, floors, block_sector as blockSector, created_at as createdAt
       FROM buildings WHERE id = ?`
    )
    .get(id);
}

export function listUnits(params: {
  organizationId: string;
  propertyId?: string;
  buildingId?: string;
  type?: string;
  status?: string;
  search?: string;
  limit?: number;
  offset?: number;
}) {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit || 50, 1), 200);
  const offset = Math.max(params.offset || 0, 0);

  let where = "WHERE u.organization_id = ? AND u.deleted_at IS NULL";
  const args: (string | number)[] = [params.organizationId];

  if (params.propertyId) {
    where += " AND u.property_id = ?";
    args.push(params.propertyId);
  }
  if (params.buildingId) {
    where += " AND u.building_id = ?";
    args.push(params.buildingId);
  }
  if (params.type) {
    where += " AND u.type = ?";
    args.push(params.type);
  }
  if (params.status) {
    where += " AND u.status = ?";
    args.push(params.status);
  }
  if (params.search && params.search.trim() !== "") {
    where += " AND (LOWER(u.unit_number) LIKE LOWER(?) OR LOWER(p.name) LIKE LOWER(?) OR LOWER(u.area_display) LIKE LOWER(?))";
    const q = `%${params.search.trim()}%`;
    args.push(q, q, q);
  }

  const totalRow = db
    .prepare(
      `SELECT COUNT(*) as total FROM units u JOIN properties p ON p.id = u.property_id ${where}`
    )
    .get(...args) as { total: number };

  const items = db
    .prepare(`
      SELECT
        u.id,
        u.organization_id as organizationId,
        u.property_id as propertyId,
        p.code as propertyCode,
        p.name as propertyName,
        p.city as propertyCity,
        u.building_id as buildingId,
        b.name as buildingName,
        u.unit_number as unitNumber,
        u.type,
        u.area_sqft as areaSqft,
        u.area_display as areaDisplay,
        u.bedrooms,
        u.bathrooms,
        u.status,
        u.market_price_minor as marketPriceMinor,
        u.monthly_rent_minor as monthlyRentMinor,
        u.currency,
        u.amenities_json as amenitiesJson,
        u.created_at as createdAt
      FROM units u
      JOIN properties p ON p.id = u.property_id
      LEFT JOIN buildings b ON b.id = u.building_id
      ${where}
      ORDER BY u.property_id ASC, u.unit_number ASC
      LIMIT ? OFFSET ?
    `)
    .all(...args, limit, offset);

  return {
    items,
    total: totalRow.total,
    limit,
    offset,
  };
}

export function createUnit(
  organizationId: string,
  actorUserId: string,
  input: {
    propertyId: string;
    buildingId?: string;
    unitNumber: string;
    type: (typeof VALID_UNIT_TYPES)[number];
    areaSqft: number;
    areaDisplay: string;
    bedrooms?: number;
    bathrooms?: number;
    status?: (typeof VALID_UNIT_STATUSES)[number];
    marketPriceMinor: number;
    monthlyRentMinor: number;
    amenities?: string[];
  }
) {
  const db = getDb();
  const prop = db
    .prepare("SELECT id, code FROM properties WHERE id = ? AND organization_id = ? AND deleted_at IS NULL")
    .get(input.propertyId, organizationId) as { id: string; code: string } | undefined;

  if (!prop) {
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property not found in organization.");
  }

  const normalizedUnitNum = input.unitNumber.trim().toUpperCase();
  const dup = db
    .prepare(
      "SELECT id FROM units WHERE organization_id = ? AND property_id = ? AND UPPER(unit_number) = ? AND deleted_at IS NULL"
    )
    .get(organizationId, input.propertyId, normalizedUnitNum);

  if (dup) {
    throw new HttpError(
      409,
      "DUPLICATE_UNIT_NUMBER",
      `Unit '${normalizedUnitNum}' already exists in property '${prop.code}'.`
    );
  }

  const id = `unit_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO units (
      id, organization_id, property_id, building_id, unit_number, type,
      area_sqft, area_display, bedrooms, bathrooms, status,
      market_price_minor, monthly_rent_minor, currency, amenities_json, photos_json,
      created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, '[]', ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.propertyId,
    input.buildingId || null,
    normalizedUnitNum,
    input.type,
    input.areaSqft,
    input.areaDisplay.trim(),
    input.bedrooms ?? 0,
    input.bathrooms ?? 0,
    input.status || "available",
    Math.round(input.marketPriceMinor),
    Math.round(input.monthlyRentMinor),
    JSON.stringify(input.amenities || ["Electricity", "Water", "Security"]),
    now,
    now,
    actorUserId
  );

  // Sync total_units count on property
  db.prepare(`
    UPDATE properties
    SET total_units = (SELECT COUNT(*) FROM units WHERE property_id = ? AND deleted_at IS NULL),
        updated_at = ?
    WHERE id = ?
  `).run(input.propertyId, now, input.propertyId);

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "portfolio.unit.created",
    entityType: "unit",
    entityId: id,
    metadata: {
      propertyId: input.propertyId,
      unitNumber: normalizedUnitNum,
      type: input.type,
      status: input.status || "available",
    },
  });

  return db
    .prepare(`
      SELECT id, organization_id as organizationId, property_id as propertyId, building_id as buildingId,
             unit_number as unitNumber, type, area_sqft as areaSqft, area_display as areaDisplay,
             bedrooms, bathrooms, status, market_price_minor as marketPriceMinor,
             monthly_rent_minor as monthlyRentMinor, currency, created_at as createdAt
      FROM units WHERE id = ?
    `)
    .get(id);
}

export function updateUnit(
  organizationId: string,
  actorUserId: string,
  unitId: string,
  input: {
    status?: (typeof VALID_UNIT_STATUSES)[number];
    marketPriceMinor?: number;
    monthlyRentMinor?: number;
  }
) {
  const db = getDb();
  const unit = db
    .prepare("SELECT id, organization_id as organizationId FROM units WHERE id = ? AND deleted_at IS NULL")
    .get(unitId) as { id: string; organizationId: string } | undefined;

  if (!unit) {
    throw new HttpError(404, "UNIT_NOT_FOUND", "Unit not found.");
  }
  if (unit.organizationId !== organizationId) {
    recordAuditLog({
      organizationId,
      actorUserId,
      action: "security.cross_tenant_blocked",
      entityType: "unit",
      entityId: unitId,
    });
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization unit modification denied.");
  }

  const now = new Date().toISOString();
  if (input.status) {
    db.prepare("UPDATE units SET status = ?, updated_at = ? WHERE id = ?").run(
      input.status,
      now,
      unitId
    );
  }
  if (input.marketPriceMinor !== undefined) {
    db.prepare("UPDATE units SET market_price_minor = ?, updated_at = ? WHERE id = ?").run(
      Math.round(input.marketPriceMinor),
      now,
      unitId
    );
  }
  if (input.monthlyRentMinor !== undefined) {
    db.prepare("UPDATE units SET monthly_rent_minor = ?, updated_at = ? WHERE id = ?").run(
      Math.round(input.monthlyRentMinor),
      now,
      unitId
    );
  }

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "portfolio.unit.updated",
    entityType: "unit",
    entityId: unitId,
    metadata: { ...input },
  });

  return db
    .prepare(`
      SELECT id, unit_number as unitNumber, status, market_price_minor as marketPriceMinor, monthly_rent_minor as monthlyRentMinor
      FROM units WHERE id = ?
    `)
    .get(unitId);
}

export function listOwners(organizationId: string) {
  const db = getDb();
  const owners = db
    .prepare(`
      SELECT
        o.id,
        o.organization_id as organizationId,
        o.user_id as userId,
        o.full_name as fullName,
        o.cnic_ntn as cnicNtn,
        o.email,
        o.phone,
        o.bank_name as bankName,
        o.iban,
        o.management_fee_pct as managementFeePct,
        o.created_at as createdAt
      FROM owners o
      WHERE o.organization_id = ? AND o.deleted_at IS NULL
      ORDER BY o.created_at ASC
    `)
    .all(organizationId) as Array<{
    id: string;
    organizationId: string;
    userId: string | null;
    fullName: string;
    cnicNtn: string;
    email: string;
    phone: string;
    bankName: string | null;
    iban: string | null;
    managementFeePct: number;
    createdAt: string;
  }>;

  const holdings = db
    .prepare(`
      SELECT
        po.owner_id as ownerId,
        po.property_id as propertyId,
        p.code as propertyCode,
        p.name as propertyName,
        po.ownership_pct as ownershipPct,
        po.is_primary as isPrimary
      FROM property_owners po
      JOIN properties p ON p.id = po.property_id
      WHERE po.organization_id = ? AND po.deleted_at IS NULL AND p.deleted_at IS NULL
    `)
    .all(organizationId) as Array<{
    ownerId: string;
    propertyId: string;
    propertyCode: string;
    propertyName: string;
    ownershipPct: number;
    isPrimary: number;
  }>;

  const holdingsByOwner = new Map<string, typeof holdings>();
  for (const h of holdings) {
    const arr = holdingsByOwner.get(h.ownerId) || [];
    arr.push(h);
    holdingsByOwner.set(h.ownerId, arr);
  }

  return owners.map((o) => ({
    ...o,
    properties: (holdingsByOwner.get(o.id) || []).map((h) => ({
      propertyId: h.propertyId,
      propertyCode: h.propertyCode,
      propertyName: h.propertyName,
      ownershipPct: h.ownershipPct,
      isPrimary: Boolean(h.isPrimary),
    })),
  }));
}

export function createOwner(
  organizationId: string,
  actorUserId: string,
  input: {
    fullName: string;
    cnicNtn: string;
    email: string;
    phone: string;
    bankName?: string;
    iban?: string;
    managementFeePct?: number;
  }
) {
  const db = getDb();
  const id = `own_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO owners (
      id, organization_id, full_name, cnic_ntn, email, phone, bank_name, iban, management_fee_pct,
      created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.fullName.trim(),
    input.cnicNtn.trim(),
    input.email.trim().toLowerCase(),
    input.phone.trim(),
    input.bankName || null,
    input.iban || null,
    input.managementFeePct ?? 5.0,
    now,
    now,
    actorUserId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "portfolio.owner.created",
    entityType: "owner",
    entityId: id,
    metadata: { fullName: input.fullName, cnicNtn: input.cnicNtn },
  });

  return db
    .prepare(
      `SELECT id, full_name as fullName, cnic_ntn as cnicNtn, email, phone, bank_name as bankName, iban, management_fee_pct as managementFeePct
       FROM owners WHERE id = ?`
    )
    .get(id);
}

export function assignPropertyOwners(
  organizationId: string,
  actorUserId: string,
  propertyId: string,
  allocations: PropertyOwnerAllocation[]
) {
  const db = getDb();
  const prop = db
    .prepare("SELECT id, organization_id as organizationId FROM properties WHERE id = ? AND deleted_at IS NULL")
    .get(propertyId) as { id: string; organizationId: string } | undefined;

  if (!prop) {
    throw new HttpError(404, "PROPERTY_NOT_FOUND", "Property not found.");
  }
  if (prop.organizationId !== organizationId) {
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization access denied.");
  }

  if (!allocations || allocations.length === 0) {
    throw new HttpError(400, "EMPTY_ALLOCATIONS", "At least one owner allocation is required.");
  }

  let totalPct = 0;
  for (const alloc of allocations) {
    if (alloc.ownershipPct <= 0 || alloc.ownershipPct > 100) {
      throw new HttpError(
        400,
        "INVALID_OWNERSHIP_SPLIT",
        `Each owner share must be between 0.01% and 100% (got ${alloc.ownershipPct}%).`
      );
    }
    totalPct += alloc.ownershipPct;

    const ownerCheck = db
      .prepare("SELECT id FROM owners WHERE id = ? AND organization_id = ? AND deleted_at IS NULL")
      .get(alloc.ownerId, organizationId);
    if (!ownerCheck) {
      throw new HttpError(404, "OWNER_NOT_FOUND", `Owner '${alloc.ownerId}' not found in organization.`);
    }
  }

  if (totalPct > 100.001) {
    throw new HttpError(
      400,
      "INVALID_OWNERSHIP_SPLIT",
      `Total ownership percentage across owners cannot exceed 100% (got ${totalPct.toFixed(2)}%).`
    );
  }

  const now = new Date().toISOString();
  db.exec("BEGIN TRANSACTION;");
  try {
    db.prepare("DELETE FROM property_owners WHERE organization_id = ? AND property_id = ?").run(
      organizationId,
      propertyId
    );

    const insertStmt = db.prepare(`
      INSERT INTO property_owners (
        id, organization_id, property_id, owner_id, ownership_pct, is_primary, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    allocations.forEach((alloc, idx) => {
      insertStmt.run(
        `po_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`,
        organizationId,
        propertyId,
        alloc.ownerId,
        alloc.ownershipPct,
        alloc.isPrimary ?? idx === 0 ? 1 : 0,
        now,
        now,
        actorUserId
      );
    });

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "portfolio.ownership.updated",
    entityType: "property",
    entityId: propertyId,
    metadata: { allocations, totalPct },
  });

  return getPropertyHierarchy(organizationId, propertyId).property;
}

// ============================================================================
// Bulk CSV Import with Row-by-Row Validation & Error Report
// ============================================================================

export interface CsvRowError {
  rowNumber: number;
  field: string;
  message: string;
  rawRow: string;
}

export interface CsvImportReport {
  dryRun: boolean;
  totalRows: number;
  validCount: number;
  importedCount: number;
  failedCount: number;
  errors: CsvRowError[];
  importedUnits: Array<{
    id: string;
    propertyCode: string;
    unitNumber: string;
    type: string;
    areaDisplay: string;
    status: string;
    marketPriceMinor: number;
    monthlyRentMinor: number;
  }>;
}

const REQUIRED_CSV_HEADERS = [
  "property_code",
  "building_code",
  "unit_number",
  "type",
  "area_sqft",
  "area_display",
  "bedrooms",
  "bathrooms",
  "status",
  "market_price_pkr",
  "monthly_rent_pkr",
];

export function importUnitsFromCsv(params: {
  organizationId: string;
  actorUserId: string;
  csvText: string;
  dryRun?: boolean;
}): CsvImportReport {
  const db = getDb();
  const dryRun = Boolean(params.dryRun);
  const lines = params.csvText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length < 2) {
    throw new HttpError(
      400,
      "EMPTY_CSV",
      "CSV must include a header row and at least one data row."
    );
  }

  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
  for (const reqHeader of REQUIRED_CSV_HEADERS) {
    if (!headers.includes(reqHeader)) {
      throw new HttpError(
        400,
        "INVALID_CSV_HEADER",
        `Missing required CSV column '${reqHeader}'. Expected columns: ${REQUIRED_CSV_HEADERS.join(", ")}`
      );
    }
  }

  const idx = (col: string) => headers.indexOf(col);

  // Cache organization properties & buildings
  const orgProps = db
    .prepare(
      "SELECT id, UPPER(code) as code FROM properties WHERE organization_id = ? AND deleted_at IS NULL"
    )
    .all(params.organizationId) as Array<{ id: string; code: string }>;
  const propByCode = new Map<string, string>();
  for (const p of orgProps) {
    propByCode.set(p.code, p.id);
  }

  const orgBldgs = db
    .prepare(
      "SELECT id, property_id as propertyId, UPPER(code) as code FROM buildings WHERE organization_id = ? AND deleted_at IS NULL"
    )
    .all(params.organizationId) as Array<{ id: string; propertyId: string; code: string }>;
  const bldgByPropAndCode = new Map<string, string>();
  for (const b of orgBldgs) {
    bldgByPropAndCode.set(`${b.propertyId}:${b.code}`, b.id);
  }

  // Existing units for duplicate detection
  const existingUnits = db
    .prepare(
      "SELECT property_id as propertyId, UPPER(unit_number) as unitNumber FROM units WHERE organization_id = ? AND deleted_at IS NULL"
    )
    .all(params.organizationId) as Array<{ propertyId: string; unitNumber: string }>;
  const existingUnitKeys = new Set<string>(
    existingUnits.map((u) => `${u.propertyId}:${u.unitNumber}`)
  );
  const seenInCsvKeys = new Set<string>();

  const errors: CsvRowError[] = [];
  const validRows: Array<{
    rowNumber: number;
    propertyId: string;
    propertyCode: string;
    buildingId: string | null;
    unitNumber: string;
    type: (typeof VALID_UNIT_TYPES)[number];
    areaSqft: number;
    areaDisplay: string;
    bedrooms: number;
    bathrooms: number;
    status: (typeof VALID_UNIT_STATUSES)[number];
    marketPriceMinor: number;
    monthlyRentMinor: number;
  }> = [];

  for (let i = 1; i < lines.length; i++) {
    const rowNumber = i + 1;
    const rawRow = lines[i];
    const cols = rawRow.split(",").map((c) => c.trim());

    const propertyCode = (cols[idx("property_code")] || "").toUpperCase();
    const buildingCode = (cols[idx("building_code")] || "").toUpperCase();
    const unitNumber = (cols[idx("unit_number")] || "").toUpperCase();
    const type = (cols[idx("type")] || "").toLowerCase();
    const areaSqftStr = cols[idx("area_sqft")] || "";
    const areaDisplay = cols[idx("area_display")] || "";
    const bedroomsStr = cols[idx("bedrooms")] || "0";
    const bathroomsStr = cols[idx("bathrooms")] || "0";
    const status = (cols[idx("status")] || "available").toLowerCase();
    const marketPriceStr = cols[idx("market_price_pkr")] || "";
    const monthlyRentStr = cols[idx("monthly_rent_pkr")] || "";

    const propertyId = propByCode.get(propertyCode);
    if (!propertyId) {
      errors.push({
        rowNumber,
        field: "property_code",
        message: `Property code '${propertyCode || "(empty)"}' not found in organization.`,
        rawRow,
      });
      continue;
    }

    if (!unitNumber) {
      errors.push({
        rowNumber,
        field: "unit_number",
        message: "unit_number is required.",
        rawRow,
      });
      continue;
    }

    const unitKey = `${propertyId}:${unitNumber}`;
    if (existingUnitKeys.has(unitKey) || seenInCsvKeys.has(unitKey)) {
      errors.push({
        rowNumber,
        field: "unit_number",
        message: `Duplicate unit_number '${unitNumber}' in property '${propertyCode}'.`,
        rawRow,
      });
      continue;
    }

    if (!(VALID_UNIT_TYPES as readonly string[]).includes(type)) {
      errors.push({
        rowNumber,
        field: "type",
        message: `Invalid unit type '${type}'. Must be one of: ${VALID_UNIT_TYPES.join(", ")}.`,
        rawRow,
      });
      continue;
    }

    if (!(VALID_UNIT_STATUSES as readonly string[]).includes(status)) {
      errors.push({
        rowNumber,
        field: "status",
        message: `Invalid status '${status}'. Must be one of: ${VALID_UNIT_STATUSES.join(", ")}.`,
        rawRow,
      });
      continue;
    }

    const areaSqft = Number(areaSqftStr);
    if (!Number.isFinite(areaSqft) || areaSqft <= 0) {
      errors.push({
        rowNumber,
        field: "area_sqft",
        message: `area_sqft must be a positive number (got '${areaSqftStr}').`,
        rawRow,
      });
      continue;
    }

    if (!areaDisplay) {
      errors.push({
        rowNumber,
        field: "area_display",
        message: "area_display (e.g. '10 Marla' or '500 Sq.Ft.') is required.",
        rawRow,
      });
      continue;
    }

    const bedrooms = parseInt(bedroomsStr, 10);
    const bathrooms = parseInt(bathroomsStr, 10);
    if (Number.isNaN(bedrooms) || bedrooms < 0 || Number.isNaN(bathrooms) || bathrooms < 0) {
      errors.push({
        rowNumber,
        field: "bedrooms/bathrooms",
        message: "bedrooms and bathrooms must be non-negative integers.",
        rawRow,
      });
      continue;
    }

    const marketPricePkr = Number(marketPriceStr);
    const monthlyRentPkr = Number(monthlyRentStr);
    if (
      !Number.isFinite(marketPricePkr) ||
      marketPricePkr < 0 ||
      !Number.isFinite(monthlyRentPkr) ||
      monthlyRentPkr < 0
    ) {
      errors.push({
        rowNumber,
        field: "market_price_pkr/monthly_rent_pkr",
        message: "Prices must be non-negative numbers in PKR.",
        rawRow,
      });
      continue;
    }

    const buildingId = buildingCode
      ? bldgByPropAndCode.get(`${propertyId}:${buildingCode}`) || null
      : null;

    seenInCsvKeys.add(unitKey);
    validRows.push({
      rowNumber,
      propertyId,
      propertyCode,
      buildingId,
      unitNumber,
      type: type as (typeof VALID_UNIT_TYPES)[number],
      areaSqft,
      areaDisplay,
      bedrooms,
      bathrooms,
      status: status as (typeof VALID_UNIT_STATUSES)[number],
      marketPriceMinor: Math.round(marketPricePkr * 100),
      monthlyRentMinor: Math.round(monthlyRentPkr * 100),
    });
  }

  const importedUnits: CsvImportReport["importedUnits"] = [];

  if (!dryRun && validRows.length > 0) {
    const now = new Date().toISOString();
    const insertStmt = db.prepare(`
      INSERT INTO units (
        id, organization_id, property_id, building_id, unit_number, type,
        area_sqft, area_display, bedrooms, bathrooms, status,
        market_price_minor, monthly_rent_minor, currency, amenities_json, photos_json,
        created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', '["Electricity","Water","Security"]', '[]', ?, ?, ?)
    `);

    const touchedProperties = new Set<string>();
    db.exec("BEGIN TRANSACTION;");
    try {
      for (const r of validRows) {
        const unitId = `unit_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
        insertStmt.run(
          unitId,
          params.organizationId,
          r.propertyId,
          r.buildingId,
          r.unitNumber,
          r.type,
          r.areaSqft,
          r.areaDisplay,
          r.bedrooms,
          r.bathrooms,
          r.status,
          r.marketPriceMinor,
          r.monthlyRentMinor,
          now,
          now,
          params.actorUserId
        );
        touchedProperties.add(r.propertyId);
        importedUnits.push({
          id: unitId,
          propertyCode: r.propertyCode,
          unitNumber: r.unitNumber,
          type: r.type,
          areaDisplay: r.areaDisplay,
          status: r.status,
          marketPriceMinor: r.marketPriceMinor,
          monthlyRentMinor: r.monthlyRentMinor,
        });
      }

      const updateCountStmt = db.prepare(`
        UPDATE properties
        SET total_units = (SELECT COUNT(*) FROM units WHERE property_id = ? AND deleted_at IS NULL),
            updated_at = ?
        WHERE id = ?
      `);
      for (const pid of touchedProperties) {
        updateCountStmt.run(pid, now, pid);
      }

      db.exec("COMMIT;");
    } catch (err) {
      db.exec("ROLLBACK;");
      throw err;
    }

    recordAuditLog({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      action: "portfolio.csv_imported",
      entityType: "unit",
      entityId: "bulk_csv",
      metadata: {
        totalRows: lines.length - 1,
        importedCount: importedUnits.length,
        failedCount: errors.length,
      },
    });
  }

  return {
    dryRun,
    totalRows: lines.length - 1,
    validCount: validRows.length,
    importedCount: dryRun ? 0 : importedUnits.length,
    failedCount: errors.length,
    errors,
    importedUnits,
  };
}
