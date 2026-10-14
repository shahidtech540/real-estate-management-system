import { z } from "zod";
import { getDb } from "@/server/db";
import type { JwtPayload } from "@/server/auth/crypto";
import { requirePermission, HttpError } from "@/server/auth/guards";
import { atomic, newId, nowIso, valid } from "../shared/domain";
import { enqueue } from "../notifications/notifications.service";
import { recordAuditLog } from "../audit/audit.service";
import { financialReport } from "./reports.service";
export function listSchedules(ctx: JwtPayload) {
  requirePermission(ctx, "accounting:read");
  const db = getDb();
  return {
    schedules: db
      .prepare(
        "SELECT id,frequency,next_due_at,active FROM report_schedules WHERE organization_id=? AND user_id=? ORDER BY created_at DESC",
      )
      .all(ctx.organizationId, ctx.sub),
    deliveries: db
      .prepare(
        "SELECT d.id,d.due_at,d.report_json FROM report_deliveries d JOIN report_schedules s ON s.id=d.schedule_id AND s.organization_id=d.organization_id WHERE d.organization_id=? AND s.user_id=? ORDER BY d.due_at DESC LIMIT 20",
      )
      .all(ctx.organizationId, ctx.sub)
      .map((d) => ({
        id: String(d.id),
        dueAt: String(d.due_at),
        report: JSON.parse(String(d.report_json)) as ReturnType<
          typeof financialReport
        >,
      })),
  };
}
export function saveSchedule(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  requirePermission(ctx, "reports:export");
  const b = valid(
    z.object({ frequency: z.enum(["daily", "weekly", "monthly"]) }).strict(),
    input,
  );
  return atomic(() => {
    const db = getDb(),
      existing = db
        .prepare(
          "SELECT id,active FROM report_schedules WHERE organization_id=? AND user_id=? AND frequency=?",
        )
        .get(ctx.organizationId, ctx.sub, b.frequency),
      now = nowIso();
    if (existing) {
      db.prepare(
        "UPDATE report_schedules SET active=1,next_due_at=CASE WHEN active=0 THEN ? ELSE next_due_at END,updated_at=? WHERE id=? AND organization_id=?",
      ).run(now, now, existing.id, ctx.organizationId);
      return { id: String(existing.id) };
    }
    const id = newId("rsc");
    db.prepare("INSERT INTO report_schedules VALUES (?,?,?,?,?,1,?,?,?)").run(
      id,
      ctx.organizationId,
      ctx.sub,
      b.frequency,
      now,
      now,
      now,
      ctx.sub,
    );
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "accounting.schedule_created",
      entityType: "report_schedule",
      entityId: id,
      metadata: b,
    });
    return { id };
  });
}
export function pauseSchedule(ctx: JwtPayload, input: unknown) {
  requirePermission(ctx, "accounting:write");
  const b = valid(z.object({ id: z.string().min(1) }).strict(), input);
  return atomic(() => {
    const result = getDb()
      .prepare(
        "UPDATE report_schedules SET active=0,updated_at=? WHERE organization_id=? AND user_id=? AND id=?",
      )
      .run(nowIso(), ctx.organizationId, ctx.sub, b.id);
    if (!result.changes)
      throw new HttpError(404, "NOT_FOUND", "Schedule not found.");
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "accounting.schedule_paused",
      entityType: "report_schedule",
      entityId: b.id,
    });
    return { paused: true };
  });
}
export function runReportCycle(org: string, reference = nowIso()) {
  const when = valid(
    z
      .string()
      .datetime()
      .transform((v) => new Date(v).toISOString()),
    reference,
  );
  return atomic(() => {
    const db = getDb();
    let delivered = 0,
      paused = 0;
    const due = db
      .prepare(
        "SELECT s.*,u.email,u.full_name,u.role_id,r.slug AS role_slug,o.slug AS org_slug FROM report_schedules s JOIN users u ON u.id=s.user_id AND u.organization_id=s.organization_id JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id JOIN organizations o ON o.id=s.organization_id WHERE s.organization_id=? AND s.active=1 AND s.next_due_at<=? ORDER BY s.next_due_at,s.id",
      )
      .all(org, when);
    for (const s of due) {
      const user = db
        .prepare(
          "SELECT id FROM users WHERE organization_id=? AND id=? AND status='active' AND deleted_at IS NULL",
        )
        .get(org, s.user_id);
      const permissions = db
        .prepare(
          "SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id AND rp.organization_id=p.organization_id WHERE p.organization_id=? AND rp.role_id=?",
        )
        .all(org, s.role_id)
        .map((p) => String(p.code));
      if (
        !user ||
        !permissions.includes("accounting:read") ||
        !permissions.includes("reports:export")
      ) {
        db.prepare(
          "UPDATE report_schedules SET active=0,updated_at=? WHERE id=? AND organization_id=?",
        ).run(when, s.id, org);
        paused++;
        continue;
      }
      const ctx: JwtPayload = {
        sub: String(s.user_id),
        email: String(s.email),
        fullName: String(s.full_name),
        organizationId: org,
        organizationSlug: String(s.org_slug),
        branchId: null,
        roleId: String(s.role_id),
        roleSlug: String(s.role_slug),
        permissions,
      };
      const local = new Date(Date.parse(when) + 5 * 3600000)
        .toISOString()
        .slice(0, 10);
      const to = new Date(Date.parse(`${local}T00:00:00Z`) - 86400000)
        .toISOString()
        .slice(0, 10);
      const from =
        s.frequency === "daily"
          ? to
          : s.frequency === "weekly"
            ? new Date(Date.parse(`${to}T00:00:00Z`) - 6 * 86400000)
                .toISOString()
                .slice(0, 10)
            : `${to.slice(0, 7)}-01`;
      const report = financialReport(ctx, { from, to });
      const notificationId = enqueue(
        org,
        "system",
        String(s.user_id),
        "in_app",
        "Fahad Real Estate accounting digest",
        `${from} to ${to}: income PKR ${(report.totals.incomeMinor / 100).toFixed(2)}, expenses PKR ${(report.totals.expenseMinor / 100).toFixed(2)}. Posting ${report.reconciliation.fullyPosted ? "complete" : "INCOMPLETE — synchronize/investigate"}. Legacy clearing is not cash. Open Accounting > Scheduled digests for the saved snapshot.`,
        `report:${s.id}:${s.next_due_at}`,
      );
      db.prepare(
        "INSERT OR IGNORE INTO report_deliveries VALUES (?,?,?,?,?,?,?,?,?)",
      ).run(
        newId("rdl"),
        org,
        s.id,
        s.next_due_at,
        JSON.stringify(report),
        notificationId,
        when,
        when,
        "system",
      );
      // Coalesce missed runs: one current digest, never flood historical messages.
      const next = new Date(`${local}T09:00:00+05:00`);
      if (s.frequency === "monthly") {
        next.setUTCDate(1);
        next.setUTCMonth(next.getUTCMonth() + 1);
      } else
        next.setUTCDate(next.getUTCDate() + (s.frequency === "daily" ? 1 : 7));
      db.prepare(
        "UPDATE report_schedules SET next_due_at=?,updated_at=? WHERE id=? AND organization_id=?",
      ).run(next.toISOString(), when, s.id, org);
      delivered++;
      recordAuditLog({
        organizationId: org,
        actorUserId: "system",
        action: "accounting.digest_delivered",
        entityType: "report_schedule",
        entityId: String(s.id),
        metadata: { from, to, dueAt: s.next_due_at },
      });
    }
    return { delivered, paused, reference: when };
  });
}
