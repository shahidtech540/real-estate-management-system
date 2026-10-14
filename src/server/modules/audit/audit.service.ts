import crypto from "node:crypto";
import { getDb } from "../../db";

export interface CreateAuditLogInput {
  organizationId: string;
  actorUserId?: string | null;
  action: string;
  entityType: string;
  entityId: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown>;
}

export interface AuditLogRecord {
  id: string;
  organizationId: string;
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  action: string;
  entityType: string;
  entityId: string;
  ipAddress: string | null;
  userAgent: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function recordAuditLog(input: CreateAuditLogInput): AuditLogRecord {
  const db = getDb();
  const id = `aud_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  const now = new Date().toISOString();
  const metadataJson = JSON.stringify(input.metadata || {});

  db.prepare(`
    INSERT INTO audit_logs (
      id, organization_id, actor_user_id, action, entity_type, entity_id,
      ip_address, user_agent, metadata_json, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.organizationId,
    input.actorUserId || null,
    input.action,
    input.entityType,
    input.entityId,
    input.ipAddress || "127.0.0.1",
    input.userAgent || "REMS-Client/1.0",
    metadataJson,
    now,
    now,
    input.actorUserId || null
  );

  return {
    id,
    organizationId: input.organizationId,
    actorUserId: input.actorUserId || null,
    actorName: null,
    actorEmail: null,
    action: input.action,
    entityType: input.entityType,
    entityId: input.entityId,
    ipAddress: input.ipAddress || "127.0.0.1",
    userAgent: input.userAgent || "REMS-Client/1.0",
    metadata: input.metadata || {},
    createdAt: now,
  };
}

export function listAuditLogs(params: {
  organizationId: string;
  actionFilter?: string;
  limit?: number;
  offset?: number;
}): { items: AuditLogRecord[]; total: number } {
  const db = getDb();
  const limit = Math.min(Math.max(params.limit || 25, 1), 100);
  const offset = Math.max(params.offset || 0, 0);

  let whereClause = "WHERE a.organization_id = ?";
  const queryArgs: (string | number)[] = [params.organizationId];

  if (params.actionFilter && params.actionFilter.trim() !== "") {
    whereClause += " AND a.action LIKE ?";
    queryArgs.push(`%${params.actionFilter.trim()}%`);
  }

  const countRow = db
    .prepare(`SELECT COUNT(*) as total FROM audit_logs a ${whereClause}`)
    .get(...queryArgs) as { total: number };

  const rows = db
    .prepare(`
      SELECT
        a.id,
        a.organization_id as organizationId,
        a.actor_user_id as actorUserId,
        u.full_name as actorName,
        u.email as actorEmail,
        a.action,
        a.entity_type as entityType,
        a.entity_id as entityId,
        a.ip_address as ipAddress,
        a.user_agent as userAgent,
        a.metadata_json as metadataJson,
        a.created_at as createdAt
      FROM audit_logs a
      LEFT JOIN users u ON u.id = a.actor_user_id
      ${whereClause}
      ORDER BY a.created_at DESC
      LIMIT ? OFFSET ?
    `)
    .all(...queryArgs, limit, offset) as Array<{
    id: string;
    organizationId: string;
    actorUserId: string | null;
    actorName: string | null;
    actorEmail: string | null;
    action: string;
    entityType: string;
    entityId: string;
    ipAddress: string | null;
    userAgent: string | null;
    metadataJson: string;
    createdAt: string;
  }>;

  const items: AuditLogRecord[] = rows.map((r) => {
    let parsedMeta: Record<string, unknown> = {};
    try {
      parsedMeta = JSON.parse(r.metadataJson || "{}");
    } catch {
      parsedMeta = {};
    }
    return {
      id: r.id,
      organizationId: r.organizationId,
      actorUserId: r.actorUserId,
      actorName: r.actorName,
      actorEmail: r.actorEmail,
      action: r.action,
      entityType: r.entityType,
      entityId: r.entityId,
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      metadata: parsedMeta,
      createdAt: r.createdAt,
    };
  });

  return { items, total: countRow.total };
}
