import { z } from "zod";
import { getDb } from "@/server/db";
import type { JwtPayload } from "@/server/auth/crypto";
import { HttpError, requirePermission } from "@/server/auth/guards";
import { atomic, newId, nowIso, valid } from "../shared/domain";
import { recordAuditLog } from "../audit/audit.service";
import { maintenanceTemplates, renderTemplate } from "./templates";

export const channels = z.enum(["in_app", "email", "sms", "whatsapp"]);
export interface NotificationRecord {
  id: string;
  user_id: string;
  channel: string;
  recipient: string;
  subject: string;
  body: string;
  status: string;
  attempt_count: number;
  last_error: string | null;
  read_at: string | null;
  next_attempt_at: string | null;
  provider_id: string | null;
  created_at: string;
}
export interface NotificationAdapter {
  send(
    message: NotificationRecord,
  ): Promise<{ providerId: string; simulated: boolean }>;
}
export function notificationAdapter(): NotificationAdapter {
  return {
    async send(message) {
      if ((process.env.NOTIFICATION_PROVIDER_MODE || "mock") !== "mock")
        throw new Error(
          "Live notification delivery is not configured. No message was sent.",
        );
      // Stable idempotency key for a real adapter too; mock never contacts a provider.
      return {
        providerId: `mock:${message.channel}:${message.id}`,
        simulated: true,
      };
    },
  };
}
function audit(ctx: JwtPayload, action: string, id: string) {
  recordAuditLog({
    organizationId: ctx.organizationId,
    actorUserId: ctx.sub,
    action,
    entityType: "notification",
    entityId: id,
  });
}
export function enqueue(
  org: string,
  actor: string,
  userId: string,
  channel: string,
  subject: string,
  body: string,
  eventKey: string,
) {
  const user = getDb()
    .prepare(
      "SELECT id, email, phone FROM users WHERE id = ? AND organization_id = ? AND deleted_at IS NULL AND status = 'active'",
    )
    .get(userId, org);
  if (!user) throw new HttpError(404, "NOT_FOUND", "Recipient not found.");
  const recipient =
    channel === "in_app"
      ? user.id
      : channel === "email"
        ? user.email
        : user.phone;
  if (!recipient)
    throw new HttpError(
      400,
      "MISSING_CONTACT",
      "Recipient has no contact for this channel.",
    );
  const existing = getDb()
    .prepare(
      "SELECT id,user_id,channel,subject,body FROM notifications WHERE organization_id=? AND event_key=?",
    )
    .get(org, eventKey);
  if (existing) {
    if (
      existing.user_id !== userId ||
      existing.channel !== channel ||
      existing.subject !== subject ||
      existing.body !== body
    )
      throw new HttpError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Request key was already used with different message content.",
      );
    return String(existing.id);
  }
  const id = newId("ntf"),
    now = nowIso();
  getDb()
    .prepare(
      `INSERT OR IGNORE INTO notifications
    (id,organization_id,user_id,channel,recipient,subject,body,status,event_key,sent_at,next_attempt_at,created_at,updated_at,created_by)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      id,
      org,
      userId,
      channel,
      String(recipient),
      subject,
      body,
      channel === "in_app" ? "delivered" : "queued",
      eventKey,
      channel === "in_app" ? now : null,
      now,
      now,
      now,
      actor,
    );
  return getDb()
    .prepare(
      "SELECT id FROM notifications WHERE organization_id = ? AND event_key = ?",
    )
    .get(org, eventKey)!.id as string;
}
/** Transactional in-app notifications only. No unsolicited external messages. */
export function notifyMaintenance(
  org: string,
  actor: string,
  ticket: {
    id: string;
    ticket_number: string;
    title: string;
    tenant_id: string | null;
  },
  status: string,
  note: string,
  eventKey: string,
) {
  const users = getDb()
    .prepare(
      `SELECT DISTINCT u.id,u.locale FROM users u JOIN roles r ON r.id=u.role_id
    WHERE u.organization_id=? AND u.deleted_at IS NULL AND u.status='active'
    AND (r.slug IN ('admin','maintenance_staff') OR u.id IN (SELECT user_id FROM tenants WHERE organization_id=? AND id=? AND deleted_at IS NULL))`,
    )
    .all(org, org, ticket.tenant_id);
  for (const user of users) {
    const locale = user.locale === "ur" ? "ur" : "en";
    const template =
      getDb()
        .prepare(
          "SELECT subject,body FROM notification_templates WHERE organization_id=? AND event='maintenance' AND locale=?",
        )
        .get(org, locale) || maintenanceTemplates[locale];
    const values = {
      number: ticket.ticket_number,
      title: ticket.title,
      status,
      note,
    };
    enqueue(
      org,
      actor,
      String(user.id),
      "in_app",
      renderTemplate(String(template.subject), values),
      renderTemplate(String(template.body), values),
      `${eventKey}:${user.id}`,
    );
  }
}
export function listNotifications(ctx: JwtPayload, input: unknown) {
  const q = valid(
    z.object({
      outbox: z.boolean().default(false),
      page: z.coerce.number().int().min(1).default(1),
      limit: z.coerce.number().int().min(1).max(100).default(25),
      status: z.string().max(30).optional(),
    }),
    input,
  );
  if (q.outbox) requirePermission(ctx, "admin:manage");
  const args: (string | number)[] = [ctx.organizationId];
  let where = "organization_id=? AND deleted_at IS NULL";
  if (!q.outbox) {
    where += " AND user_id=?";
    args.push(ctx.sub);
  }
  if (q.status) {
    where += " AND status=?";
    args.push(q.status);
  }
  const total = Number(
    getDb()
      .prepare(`SELECT COUNT(*) AS n FROM notifications WHERE ${where}`)
      .get(...args)!.n,
  );
  const items = getDb()
    .prepare(
      `SELECT id,user_id,channel,recipient,subject,body,status,attempt_count,last_error,read_at,next_attempt_at,provider_id,created_at FROM notifications WHERE ${where} ORDER BY created_at DESC,id DESC LIMIT ? OFFSET ?`,
    )
    .all(
      ...args,
      q.limit,
      (q.page - 1) * q.limit,
    ) as unknown as NotificationRecord[];
  return { items, total, page: q.page, limit: q.limit };
}
export function markRead(ctx: JwtPayload, id: string) {
  const result = getDb()
    .prepare(
      "UPDATE notifications SET read_at=COALESCE(read_at,?),updated_at=? WHERE id=? AND organization_id=? AND user_id=? AND deleted_at IS NULL",
    )
    .run(nowIso(), nowIso(), id, ctx.organizationId, ctx.sub);
  if (!result.changes)
    throw new HttpError(404, "NOT_FOUND", "Notification not found.");
  return { id, read: true };
}
export function composeNotification(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "admin:manage");
  const b = valid(
    z
      .object({
        userId: z.string().min(1),
        channel: channels,
        subject: z.string().trim().min(1).max(180),
        body: z.string().trim().min(1).max(4000),
        consent: z.boolean().default(false),
        requestKey: z.string().min(8).max(100),
      })
      .strict(),
    input,
  );
  if (b.channel !== "in_app" && !b.consent)
    throw new HttpError(
      400,
      "CONSENT_REQUIRED",
      "Confirm permission to contact this recipient externally.",
    );
  return atomic(() => {
    const id = enqueue(
      ctx.organizationId,
      ctx.sub,
      b.userId,
      b.channel,
      b.subject,
      b.body,
      `manual:${ctx.sub}:${b.requestKey}`,
    );
    audit(ctx, "notification.queued", id);
    return { id };
  });
}
export function retryNotification(ctx: JwtPayload, id: string) {
  requirePermission(ctx, "admin:manage");
  return atomic(() => {
    const row = getDb()
      .prepare(
        "SELECT id FROM notifications WHERE id=? AND organization_id=? AND status IN ('failed','dead_letter') AND deleted_at IS NULL",
      )
      .get(id, ctx.organizationId);
    if (!row)
      throw new HttpError(
        409,
        "NOT_RETRYABLE",
        "Notification is not retryable.",
      );
    getDb()
      .prepare(
        "UPDATE notifications SET status='queued',attempt_count=0,last_error=NULL,next_attempt_at=?,updated_at=? WHERE id=? AND organization_id=?",
      )
      .run(nowIso(), nowIso(), id, ctx.organizationId);
    audit(ctx, "notification.retried", id);
    return { id };
  });
}
export async function dispatchNotifications(
  org: string,
  adapter = notificationAdapter(),
  reference = nowIso(),
) {
  const when = valid(
    z
      .string()
      .datetime()
      .transform((s) => new Date(s).toISOString()),
    reference,
  );
  const stale = new Date(Date.parse(when) - 5 * 60000).toISOString();
  const pending = getDb()
    .prepare(
      `SELECT id FROM notifications WHERE organization_id=? AND deleted_at IS NULL AND channel!='in_app'
    AND ((status IN ('queued','failed') AND next_attempt_at<=?) OR (status='processing' AND locked_at<=?))
    ORDER BY created_at,id LIMIT 100`,
    )
    .all(org, when, stale);
  let delivered = 0,
    failed = 0;
  for (const row of pending) {
    const claim = getDb()
      .prepare(
        `UPDATE notifications SET status='processing',locked_at=?,attempt_count=attempt_count+1
      WHERE id=? AND organization_id=? AND ((status IN ('queued','failed') AND next_attempt_at<=?) OR (status='processing' AND locked_at<=?))`,
      )
      .run(when, row.id, org, when, stale);
    if (!claim.changes) continue;
    const item = getDb()
      .prepare("SELECT * FROM notifications WHERE id=? AND organization_id=?")
      .get(row.id, org) as unknown as NotificationRecord;
    try {
      const result = await adapter.send(item);
      getDb()
        .prepare(
          "UPDATE notifications SET status=?,provider_id=?,sent_at=?,updated_at=?,last_error=NULL,locked_at=NULL WHERE id=? AND organization_id=? AND locked_at=?",
        )
        .run(
          result.simulated ? "mock_sent" : "sent",
          result.providerId,
          when,
          when,
          item.id,
          org,
          when,
        );
      delivered++;
    } catch (e) {
      const error = e instanceof Error ? e.message : "Delivery failed";
      const next = new Date(
        Date.parse(when) +
          Math.min(3600000, 60000 * 2 ** (item.attempt_count - 1)),
      ).toISOString();
      getDb()
        .prepare(
          "UPDATE notifications SET status=?,last_error=?,next_attempt_at=?,updated_at=?,locked_at=NULL WHERE id=? AND organization_id=? AND locked_at=?",
        )
        .run(
          item.attempt_count >= 5 ? "dead_letter" : "failed",
          error.slice(0, 500),
          next,
          when,
          item.id,
          org,
          when,
        );
      failed++;
    }
  }
  return { delivered, failed };
}
export function templates(ctx: JwtPayload) {
  requirePermission(ctx, "admin:manage");
  return (["en", "ur"] as const).map((locale) => ({
    locale,
    ...(getDb()
      .prepare(
        "SELECT subject,body FROM notification_templates WHERE organization_id=? AND event='maintenance' AND locale=?",
      )
      .get(ctx.organizationId, locale) || maintenanceTemplates[locale]),
  }));
}
export function saveTemplate(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "admin:manage");
  const b = valid(
    z
      .object({
        locale: z.enum(["en", "ur"]),
        subject: z.string().trim().min(1).max(180),
        body: z.string().trim().min(1).max(4000),
      })
      .strict(),
    input,
  );
  if (
    /\{\{(?!number\}\}|status\}\}|title\}\}|note\}\})/.test(b.subject + b.body)
  )
    throw new HttpError(
      400,
      "INVALID_TEMPLATE",
      "Supported variables: number, status, title, note.",
    );
  return atomic(() => {
    getDb()
      .prepare(
        `INSERT INTO notification_templates (id,organization_id,event,locale,subject,body,created_at,updated_at,created_by)
    VALUES (?,?,'maintenance',?,?,?,?,?,?) ON CONFLICT(organization_id,event,locale) DO UPDATE SET subject=excluded.subject,body=excluded.body,updated_at=excluded.updated_at,created_by=excluded.created_by`,
      )
      .run(
        newId("tpl"),
        ctx.organizationId,
        b.locale,
        b.subject,
        b.body,
        nowIso(),
        nowIso(),
        ctx.sub,
      );
    audit(ctx, "notification.template_saved", b.locale);
    return templates(ctx);
  });
}
