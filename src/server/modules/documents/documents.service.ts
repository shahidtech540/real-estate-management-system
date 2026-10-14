import crypto from "node:crypto";
import { getDb } from "../../db";
import { HttpError } from "../../auth/guards";
import { recordAuditLog } from "../audit/audit.service";

export const DOCUMENT_CATEGORIES = [
  "noc_approval",
  "trade_licence",
  "floor_plan",
  "title_deed",
  "insurance",
  "kyc_identity",
  "lease_agreement",
  "other",
] as const;

export type ExpiryStatus = "valid" | "expiring_soon" | "expired" | "no_expiry";

export function computeExpiryStatus(
  expiryDate: string | null,
  referenceDateIso = "2026-10-14"
): ExpiryStatus {
  if (!expiryDate) return "no_expiry";
  const refMs = new Date(referenceDateIso).getTime();
  const expMs = new Date(expiryDate).getTime();
  if (Number.isNaN(expMs)) return "no_expiry";

  const diffDays = (expMs - refMs) / (1000 * 3600 * 24);
  if (diffDays < 0) return "expired";
  if (diffDays <= 60) return "expiring_soon";
  return "valid";
}

export function listDocuments(params: {
  organizationId: string;
  entityType?: string;
  entityId?: string;
  category?: string;
  search?: string;
  expiryStatus?: ExpiryStatus;
}) {
  const db = getDb();
  let where = "WHERE d.organization_id = ? AND d.deleted_at IS NULL";
  const args: string[] = [params.organizationId];

  if (params.entityType) {
    where += " AND d.entity_type = ?";
    args.push(params.entityType);
  }
  if (params.entityId) {
    where += " AND d.entity_id = ?";
    args.push(params.entityId);
  }
  if (params.category) {
    where += " AND d.category = ?";
    args.push(params.category);
  }
  if (params.search && params.search.trim() !== "") {
    where +=
      " AND (LOWER(d.title) LIKE LOWER(?) OR LOWER(COALESCE(d.content_text, '')) LIKE LOWER(?) OR LOWER(d.tags_json) LIKE LOWER(?))";
    const q = `%${params.search.trim()}%`;
    args.push(q, q, q);
  }

  const rows = db
    .prepare(`
      SELECT
        d.id,
        d.organization_id as organizationId,
        d.entity_type as entityType,
        d.entity_id as entityId,
        d.title,
        d.category,
        d.version,
        d.storage_key as storageKey,
        d.mime_type as mimeType,
        d.size_bytes as sizeBytes,
        d.tags_json as tagsJson,
        d.expiry_date as expiryDate,
        d.content_text as contentText,
        d.created_at as createdAt,
        d.updated_at as updatedAt,
        d.created_by as createdBy
      FROM documents d
      ${where}
      ORDER BY d.updated_at DESC, d.version DESC
    `)
    .all(...args) as Array<{
    id: string;
    organizationId: string;
    entityType: string;
    entityId: string;
    title: string;
    category: string;
    version: number;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    tagsJson: string;
    expiryDate: string | null;
    contentText: string | null;
    createdAt: string;
    updatedAt: string;
    createdBy: string | null;
  }>;

  const enriched = rows.map((r) => {
    let tags: string[] = [];
    try {
      tags = JSON.parse(r.tagsJson || "[]");
    } catch {
      tags = [];
    }
    const expiryStatus = computeExpiryStatus(r.expiryDate);
    return {
      id: r.id,
      organizationId: r.organizationId,
      entityType: r.entityType,
      entityId: r.entityId,
      title: r.title,
      category: r.category,
      version: r.version,
      storageKey: r.storageKey,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      tags,
      expiryDate: r.expiryDate,
      expiryStatus,
      contentText: r.contentText,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
      createdBy: r.createdBy,
    };
  });

  if (params.expiryStatus) {
    return enriched.filter((d) => d.expiryStatus === params.expiryStatus);
  }
  return enriched;
}

export function uploadDocument(
  organizationId: string,
  actorUserId: string,
  input: {
    entityType: "property" | "unit" | "owner" | "tenant" | "lease" | "organization";
    entityId: string;
    title: string;
    category: string;
    mimeType?: string;
    sizeBytes?: number;
    tags?: string[];
    expiryDate?: string | null;
    contentText?: string;
  }
) {
  const db = getDb();
  const normalizedTitle = input.title.trim();

  // Check if a previous version of this document exists for the same entity & title
  const latestVersionRow = db
    .prepare(`
      SELECT MAX(version) as maxVer
      FROM documents
      WHERE organization_id = ? AND entity_type = ? AND entity_id = ? AND LOWER(title) = LOWER(?) AND deleted_at IS NULL
    `)
    .get(organizationId, input.entityType, input.entityId, normalizedTitle) as {
    maxVer: number | null;
  };

  const nextVersion = (latestVersionRow?.maxVer || 0) + 1;
  const id = `doc_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();
  const slugTitle = normalizedTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const storageKey = `s3://rems-documents/${organizationId}/${input.entityType}/${input.entityId}/${slugTitle}-v${nextVersion}.pdf`;

  db.prepare(`
    INSERT INTO documents (
      id, organization_id, entity_type, entity_id, title, category, version,
      storage_key, mime_type, size_bytes, tags_json, expiry_date, content_text,
      created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.entityType,
    input.entityId,
    normalizedTitle,
    input.category,
    nextVersion,
    storageKey,
    input.mimeType || "application/pdf",
    input.sizeBytes || 1024000,
    JSON.stringify(input.tags || []),
    input.expiryDate || null,
    input.contentText || `${normalizedTitle} (Version ${nextVersion})`,
    now,
    now,
    actorUserId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: nextVersion > 1 ? "document.version_created" : "document.uploaded",
    entityType: "document",
    entityId: id,
    metadata: {
      title: normalizedTitle,
      version: nextVersion,
      category: input.category,
      targetEntity: `${input.entityType}:${input.entityId}`,
    },
  });

  const docs = listDocuments({ organizationId, entityType: input.entityType, entityId: input.entityId });
  return docs.find((d) => d.id === id)!;
}

export function recordDocumentAccess(params: {
  organizationId: string;
  actorUserId: string;
  documentId: string;
  accessType: "view" | "download";
  ipAddress?: string;
  userAgent?: string;
}) {
  const db = getDb();
  const doc = db
    .prepare(`
      SELECT
        id, organization_id as organizationId, title, category, version,
        storage_key as storageKey, mime_type as mimeType, content_text as contentText
      FROM documents
      WHERE id = ? AND deleted_at IS NULL
    `)
    .get(params.documentId) as
    | {
        id: string;
        organizationId: string;
        title: string;
        category: string;
        version: number;
        storageKey: string;
        mimeType: string;
        contentText: string | null;
      }
    | undefined;

  if (!doc) {
    throw new HttpError(404, "DOCUMENT_NOT_FOUND", "Document not found.");
  }

  if (doc.organizationId !== params.organizationId) {
    recordAuditLog({
      organizationId: params.organizationId,
      actorUserId: params.actorUserId,
      action: "security.cross_tenant_blocked",
      entityType: "document",
      entityId: params.documentId,
    });
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization document access denied.");
  }

  const action = params.accessType === "download" ? "document.downloaded" : "document.viewed";
  const auditEntry = recordAuditLog({
    organizationId: params.organizationId,
    actorUserId: params.actorUserId,
    action,
    entityType: "document",
    entityId: doc.id,
    ipAddress: params.ipAddress,
    userAgent: params.userAgent,
    metadata: {
      title: doc.title,
      version: doc.version,
      accessType: params.accessType,
    },
  });

  const signature = crypto
    .createHmac("sha256", "rems-signed-url-secret")
    .update(`${doc.id}:${doc.version}:${params.actorUserId}`)
    .digest("hex")
    .slice(0, 24);

  return {
    documentId: doc.id,
    title: doc.title,
    version: doc.version,
    storageKey: doc.storageKey,
    mimeType: doc.mimeType,
    contentPreview: doc.contentText,
    signedUrl: `/api/v1/documents/${doc.id}/access?sig=${signature}&v=${doc.version}`,
    auditLogId: auditEntry.id,
    accessedAt: auditEntry.createdAt,
  };
}
