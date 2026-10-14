import crypto from "node:crypto";
import { getDb } from "../../db";
import { HttpError } from "../../auth/guards";
import { recordAuditLog } from "../audit/audit.service";

export const VALID_LISTING_STATUSES = [
  "draft",
  "published",
  "under_offer",
  "closed",
] as const;

export const VALID_LISTING_PURPOSES = ["sale", "rent"] as const;

export type ListingStatus = (typeof VALID_LISTING_STATUSES)[number];
export type ListingPurpose = (typeof VALID_LISTING_PURPOSES)[number];

/**
 * Generates a deterministic, standalone SVG QR-matrix representation for a shareable listing URL.
 */
export function generateListingQrSvg(url: string): string {
  const hash = crypto.createHash("sha256").update(url).digest();
  const size = 21;
  const cells: string[] = [];

  const isFinderPattern = (r: number, c: number) => {
    const inTopLeft = r < 7 && c < 7;
    const inTopRight = r < 7 && c >= size - 7;
    const inBottomLeft = r >= size - 7 && c < 7;
    return inTopLeft || inTopRight || inBottomLeft;
  };

  const finderCellOn = (r: number, c: number) => {
    const lr = r >= size - 7 ? r - (size - 7) : r;
    const lc = c >= size - 7 ? c - (size - 7) : c;
    if (lr === 0 || lr === 6 || lc === 0 || lc === 6) return true;
    if (lr >= 2 && lr <= 4 && lc >= 2 && lc <= 4) return true;
    return false;
  };

  let bitIdx = 0;
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      let on = false;
      if (isFinderPattern(r, c)) {
        on = finderCellOn(r, c);
      } else {
        const byte = hash[Math.floor(bitIdx / 8) % hash.length];
        on = ((byte >> (bitIdx % 8)) & 1) === 1;
        bitIdx++;
      }
      if (on) {
        cells.push(`<rect x="${c + 2}" y="${r + 2}" width="1" height="1" fill="#064e3b"/>`);
      }
    }
  }

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 4} ${
    size + 4
  }" shape-rendering="crispEdges"><rect width="${size + 4}" height="${
    size + 4
  }" fill="#ffffff"/>${cells.join("")}</svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function slugifyListingTitle(title: string, suffix?: string): string {
  const base = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return suffix ? `${base}-${suffix}` : base;
}

export interface ListingFilterParams {
  organizationId?: string;
  onlyPublished?: boolean;
  purpose?: string;
  status?: string;
  city?: string;
  unitType?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  minAreaSqft?: number;
  minBedrooms?: number;
  search?: string;
}

export function listListings(params: ListingFilterParams) {
  const db = getDb();
  let where = "WHERE l.deleted_at IS NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL";
  const args: (string | number)[] = [];

  if (params.organizationId) {
    where += " AND l.organization_id = ?";
    args.push(params.organizationId);
  }
  if (params.onlyPublished) {
    where += " AND l.status IN ('published', 'under_offer')";
  }
  if (params.status) {
    where += " AND l.status = ?";
    args.push(params.status);
  }
  if (params.purpose) {
    where += " AND l.purpose = ?";
    args.push(params.purpose);
  }
  if (params.city) {
    where += " AND LOWER(p.city) = LOWER(?)";
    args.push(params.city);
  }
  if (params.unitType) {
    where += " AND LOWER(u.type) = LOWER(?)";
    args.push(params.unitType);
  }
  if (params.minPriceMinor !== undefined && params.minPriceMinor > 0) {
    where += " AND l.asking_price_minor >= ?";
    args.push(params.minPriceMinor);
  }
  if (params.maxPriceMinor !== undefined && params.maxPriceMinor > 0) {
    where += " AND l.asking_price_minor <= ?";
    args.push(params.maxPriceMinor);
  }
  if (params.minAreaSqft !== undefined && params.minAreaSqft > 0) {
    where += " AND u.area_sqft >= ?";
    args.push(params.minAreaSqft);
  }
  if (params.minBedrooms !== undefined && params.minBedrooms > 0) {
    where += " AND u.bedrooms >= ?";
    args.push(params.minBedrooms);
  }
  if (params.search && params.search.trim() !== "") {
    where += ` AND (
      LOWER(l.title_en) LIKE LOWER(?) OR
      LOWER(l.title_ur) LIKE LOWER(?) OR
      LOWER(l.description_en) LIKE LOWER(?) OR
      LOWER(p.name) LIKE LOWER(?) OR
      LOWER(p.city) LIKE LOWER(?) OR
      LOWER(u.unit_number) LIKE LOWER(?)
    )`;
    const q = `%${params.search.trim()}%`;
    args.push(q, q, q, q, q, q);
  }

  const rows = db
    .prepare(`
      SELECT
        l.id,
        l.organization_id as organizationId,
        l.property_id as propertyId,
        l.unit_id as unitId,
        l.slug,
        l.title_en as titleEn,
        l.title_ur as titleUr,
        l.description_en as descriptionEn,
        l.description_ur as descriptionUr,
        l.purpose,
        l.asking_price_minor as askingPriceMinor,
        l.currency,
        l.status,
        l.syndicate_portals as syndicatePortals,
        l.published_at as publishedAt,
        l.created_at as createdAt,
        l.updated_at as updatedAt,
        p.code as propertyCode,
        p.name as propertyName,
        p.type as propertyType,
        p.city,
        p.address,
        p.latitude,
        p.longitude,
        u.unit_number as unitNumber,
        u.type as unitType,
        u.area_sqft as areaSqft,
        u.area_display as areaDisplay,
        u.bedrooms,
        u.bathrooms,
        u.status as unitStatus
      FROM listings l
      JOIN properties p ON p.id = l.property_id
      JOIN units u ON u.id = l.unit_id
      ${where}
      ORDER BY l.created_at DESC, l.id ASC
    `)
    .all(...args) as Array<{
    id: string;
    organizationId: string;
    propertyId: string;
    unitId: string;
    slug: string;
    titleEn: string;
    titleUr: string;
    descriptionEn: string;
    descriptionUr: string;
    purpose: ListingPurpose;
    askingPriceMinor: number;
    currency: string;
    status: ListingStatus;
    syndicatePortals: number;
    publishedAt: string | null;
    createdAt: string;
    updatedAt: string;
    propertyCode: string;
    propertyName: string;
    propertyType: string;
    city: string;
    address: string;
    latitude: number | null;
    longitude: number | null;
    unitNumber: string;
    unitType: string;
    areaSqft: number;
    areaDisplay: string;
    bedrooms: number;
    bathrooms: number;
    unitStatus: string;
  }>;

  return rows.map((r) => {
    const shareableUrl = `/listings/${r.slug}`;
    return {
      ...r,
      syndicatePortals: Boolean(r.syndicatePortals),
      shareableUrl,
      qrCodeSvgDataUri: generateListingQrSvg(`https://pakland.rems.pk/listings/${r.slug}`),
      seo: {
        metaTitle: `${r.titleEn} | ${r.propertyName} (${r.city})`,
        metaDescription: r.descriptionEn.slice(0, 155),
        canonicalUrl: shareableUrl,
      },
    };
  });
}

export function getListingBySlugOrId(slugOrId: string, organizationId?: string) {
  const all = listListings({ organizationId });
  const match = all.find((l) => l.slug === slugOrId || l.id === slugOrId);
  if (!match) {
    throw new HttpError(404, "LISTING_NOT_FOUND", `Listing '${slugOrId}' not found.`);
  }
  return match;
}

export function createListing(
  organizationId: string,
  actorUserId: string,
  input: {
    propertyId: string;
    unitId: string;
    titleEn: string;
    titleUr?: string;
    descriptionEn: string;
    descriptionUr?: string;
    purpose: ListingPurpose;
    askingPriceMinor: number;
    status?: ListingStatus;
    syndicatePortals?: boolean;
  }
) {
  const db = getDb();

  const unit = db
    .prepare(`
      SELECT id, property_id as propertyId, organization_id as organizationId, unit_number as unitNumber
      FROM units
      WHERE id = ? AND deleted_at IS NULL
    `)
    .get(input.unitId) as
    | { id: string; propertyId: string; organizationId: string; unitNumber: string }
    | undefined;

  if (!unit) {
    throw new HttpError(404, "UNIT_NOT_FOUND", "Target unit not found.");
  }
  if (unit.organizationId !== organizationId) {
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization unit access denied.");
  }
  if (unit.propertyId !== input.propertyId) {
    throw new HttpError(400, "UNIT_PROPERTY_MISMATCH", "Unit does not belong to specified property.");
  }

  const id = `lst_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const shortSuffix = id.slice(-5);
  const slug = slugifyListingTitle(input.titleEn, shortSuffix);
  const status: ListingStatus = input.status || "published";
  const now = new Date().toISOString();

  db.prepare(`
    INSERT INTO listings (
      id, organization_id, property_id, unit_id, slug,
      title_en, title_ur, description_en, description_ur,
      purpose, asking_price_minor, currency, status, syndicate_portals,
      published_at, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.propertyId,
    input.unitId,
    slug,
    input.titleEn.trim(),
    (input.titleUr || input.titleEn).trim(),
    input.descriptionEn.trim(),
    (input.descriptionUr || input.descriptionEn).trim(),
    input.purpose,
    Math.round(input.askingPriceMinor),
    status,
    input.syndicatePortals === false ? 0 : 1,
    status === "published" || status === "under_offer" ? now : null,
    now,
    now,
    actorUserId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "listings.created",
    entityType: "listing",
    entityId: id,
    metadata: {
      slug,
      unitId: input.unitId,
      purpose: input.purpose,
      status,
    },
  });

  return getListingBySlugOrId(id, organizationId);
}

export function updateListingStatus(
  organizationId: string,
  actorUserId: string,
  listingId: string,
  input: {
    status?: ListingStatus;
    askingPriceMinor?: number;
    syndicatePortals?: boolean;
  }
) {
  const db = getDb();
  const existing = db
    .prepare(`
      SELECT id, organization_id as organizationId, unit_id as unitId, purpose, status
      FROM listings
      WHERE id = ? AND deleted_at IS NULL
    `)
    .get(listingId) as
    | {
        id: string;
        organizationId: string;
        unitId: string;
        purpose: ListingPurpose;
        status: ListingStatus;
      }
    | undefined;

  if (!existing) {
    throw new HttpError(404, "LISTING_NOT_FOUND", "Listing not found.");
  }
  if (existing.organizationId !== organizationId) {
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization listing access denied.");
  }

  const now = new Date().toISOString();
  const nextStatus = input.status || existing.status;

  if (input.status) {
    const publishedAtUpdate =
      input.status === "published" ? now : undefined;
    if (publishedAtUpdate) {
      db.prepare("UPDATE listings SET status = ?, published_at = ?, updated_at = ? WHERE id = ?").run(
        input.status,
        publishedAtUpdate,
        now,
        listingId
      );
    } else {
      db.prepare("UPDATE listings SET status = ?, updated_at = ? WHERE id = ?").run(
        input.status,
        now,
        listingId
      );
    }

    // If listing reaches 'closed', sync the underlying unit status
    if (input.status === "closed") {
      const targetUnitStatus = existing.purpose === "sale" ? "sold" : "rented";
      db.prepare("UPDATE units SET status = ?, updated_at = ? WHERE id = ?").run(
        targetUnitStatus,
        now,
        existing.unitId
      );
    }
  }

  if (input.askingPriceMinor !== undefined) {
    db.prepare("UPDATE listings SET asking_price_minor = ?, updated_at = ? WHERE id = ?").run(
      Math.round(input.askingPriceMinor),
      now,
      listingId
    );
  }

  if (input.syndicatePortals !== undefined) {
    db.prepare("UPDATE listings SET syndicate_portals = ?, updated_at = ? WHERE id = ?").run(
      input.syndicatePortals ? 1 : 0,
      now,
      listingId
    );
  }

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "listings.updated",
    entityType: "listing",
    entityId: listingId,
    metadata: {
      previousStatus: existing.status,
      nextStatus,
      askingPriceMinor: input.askingPriceMinor,
      syndicatePortals: input.syndicatePortals,
    },
  });

  return getListingBySlugOrId(listingId, organizationId);
}

/**
 * Generates an export/syndication-ready portal feed in JSON or CSV format.
 */
export function exportSyndicationFeed(
  organizationId: string,
  format: "json" | "csv" = "json"
): { contentType: string; body: string; count: number } {
  const listings = listListings({ organizationId }).filter(
    (l) => l.syndicatePortals && (l.status === "published" || l.status === "under_offer")
  );

  const feedItems = listings.map((l) => ({
    listing_id: l.id,
    slug: l.slug,
    url: `https://pakland.rems.pk${l.shareableUrl}`,
    title_en: l.titleEn,
    title_ur: l.titleUr,
    purpose: l.purpose,
    status: l.status,
    property_code: l.propertyCode,
    property_name: l.propertyName,
    city: l.city,
    address: l.address,
    latitude: l.latitude,
    longitude: l.longitude,
    unit_number: l.unitNumber,
    unit_type: l.unitType,
    area_sqft: l.areaSqft,
    area_display: l.areaDisplay,
    bedrooms: l.bedrooms,
    bathrooms: l.bathrooms,
    asking_price_pkr: Math.round(l.askingPriceMinor / 100),
    asking_price_minor: l.askingPriceMinor,
    currency: l.currency,
    published_at: l.publishedAt,
  }));

  if (format === "csv") {
    const headers = [
      "listing_id",
      "slug",
      "url",
      "title_en",
      "purpose",
      "status",
      "property_code",
      "property_name",
      "city",
      "unit_number",
      "unit_type",
      "area_sqft",
      "area_display",
      "bedrooms",
      "bathrooms",
      "asking_price_pkr",
      "currency",
    ];
    const escapeCsv = (val: unknown) => {
      const str = String(val ?? "");
      if (str.includes(",") || str.includes('"') || str.includes("\n")) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    const rows = feedItems.map((item) =>
      headers.map((h) => escapeCsv((item as Record<string, unknown>)[h])).join(",")
    );
    return {
      contentType: "text/csv; charset=utf-8",
      body: [headers.join(","), ...rows].join("\n"),
      count: feedItems.length,
    };
  }

  return {
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(
      {
        portalFeedVersion: "1.0",
        generatedAt: new Date().toISOString(),
        organizationId,
        count: feedItems.length,
        listings: feedItems,
      },
      null,
      2
    ),
    count: feedItems.length,
  };
}
