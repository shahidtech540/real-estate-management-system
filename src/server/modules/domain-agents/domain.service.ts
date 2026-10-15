import { z } from "zod";
import { getDb } from "@/server/db";
import type { JwtPayload } from "@/server/auth/crypto";
import { HttpError, requirePermission } from "@/server/auth/guards";
import { valid, atomic } from "../shared/domain";
import {
  freshContext,
  startRun,
  runDetail,
} from "../orchestration/orchestration.service";
import { getTool } from "../orchestration/registry";
import {
  intents,
  schemas,
  SLUGS,
  type AgentKind,
  type Assessment,
} from "./contracts";
import { canReadProperty } from "../shared/access";
import { safeText, documentPermission, domainPermissions } from "./safety";
function auth(ctx: JwtPayload) {
  const fresh = freshContext(ctx.organizationId, ctx.sub);
  requirePermission(fresh, "agents:read");
  return fresh;
}
export function domainCatalog(ctx: JwtPayload) {
  ctx = auth(ctx);
  const db = getDb(),
    org = ctx.organizationId;
  const agents = db
    .prepare(
      "SELECT id,slug,name,is_enabled,allowed_tools_json FROM agents WHERE organization_id=? AND deleted_at IS NULL",
    )
    .all(org);
  const available = intents
    .filter((kind) => {
      const a = agents.find((a) => a.slug === SLUGS[kind]);
      return (
        !!a &&
        JSON.parse(String(a.allowed_tools_json)).includes(`domain.${kind}`) &&
        ctx.permissions.includes(getTool(`domain.${kind}`).permission)
      );
    })
    .map((kind) => ({
      kind,
      id: String(agents.find((a) => a.slug === SLUGS[kind])!.id),
      name: String(agents.find((a) => a.slug === SLUGS[kind])!.name),
      enabled: !!agents.find((a) => a.slug === SLUGS[kind])!.is_enabled,
    }));
  const order: Record<string, string> = {
    leads: "updated_at DESC,id",
    units: "CASE WHEN status='available' THEN 0 ELSE 1 END,id",
    invoices:
      "CASE WHEN total_minor>paid_minor AND status!='cancelled' THEN 0 ELSE 1 END,due_date,id",
    maintenance_tickets:
      "CASE WHEN status IN ('closed','cancelled') THEN 1 ELSE 0 END,sla_due_at,id",
    leases:
      "CASE WHEN status IN ('active','expiring','renewed') THEN 0 ELSE 1 END,end_date,id",
    properties: "name,id",
  };
  const options = (permission: string, table: string, label: string) =>
    ctx.permissions.includes(permission)
      ? db
          .prepare(
            `SELECT *,${label} label FROM ${table} WHERE organization_id=? AND deleted_at IS NULL ORDER BY ${order[table] || "id"} LIMIT 100`,
          )
          .all(org)
          .filter((r) =>
            table === "properties"
              ? canReadProperty(ctx, String(r.id))
              : !r.property_id ||
                canReadProperty(
                  ctx,
                  String(r.property_id),
                  r.tenant_id as string | undefined,
                ),
          )
          .map((r) => ({ id: String(r.id), label: safeText(r.label) }))
      : [];
  const docs =
    ctx.permissions.includes("documents:read") &&
    ctx.permissions.includes("leases:read")
      ? db
          .prepare(
            "SELECT * FROM documents WHERE organization_id=? AND entity_type='lease' AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 100",
          )
          .all(org)
          .filter((d) => documentPermission(ctx, d))
          .map((d) => ({
            id: String(d.id),
            label: safeText(d.title),
            leaseId: String(d.entity_id),
          }))
      : [];
  return {
    engine: "local-domain-v1",
    externalModelEnabled: false,
    agents: available,
    options: {
      leads: options("leads:read", "leads", "full_name"),
      units: options(
        "properties:read",
        "units",
        "unit_number || ' · ' || status",
      ),
      invoices: options(
        "invoices:read",
        "invoices",
        "invoice_number || ' · ' || status",
      ),
      tickets: options(
        "maintenance:read",
        "maintenance_tickets",
        "ticket_number || ' · ' || title",
      ),
      leases: options(
        "leases:read",
        "leases",
        "lease_number || ' · ' || end_date",
      ),
      documents: docs,
      projects: options("properties:read", "properties", "name"),
    },
  };
}
export function startDomain(ctx: JwtPayload, input: unknown) {
  ctx = auth(ctx);
  requirePermission(ctx, "agents:run");
  const b = valid(
    z
      .object({
        kind: z.enum(intents),
        requestKey: z.string().trim().min(3).max(120),
        input: z.unknown(),
      })
      .strict(),
    input,
  );
  const args = valid(schemas[b.kind], b.input);
  domainPermissions(b.kind, args).forEach((p) => requirePermission(ctx, p));
  const agent = getDb()
    .prepare(
      "SELECT id FROM agents WHERE organization_id=? AND slug=? AND deleted_at IS NULL",
    )
    .get(ctx.organizationId, SLUGS[b.kind]);
  if (!agent) throw new HttpError(404, "NOT_FOUND", "Domain agent not found.");
  return startRun(ctx, {
    agentId: String(agent.id),
    requestKey: b.requestKey,
    goal: `Source-backed ${b.kind} assessment`,
    maxCostMinor: 0,
    steps: [{ tool: `domain.${b.kind}`, input: args }],
  });
}
export function proposeAction(ctx: JwtPayload, input: unknown) {
  ctx = auth(ctx);
  requirePermission(ctx, "agents:run");
  const b = valid(
    z
      .object({
        runId: z.string().min(1),
        proposalId: z.string().min(1),
        requestKey: z.string().trim().min(3).max(120),
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const detail = runDetail(ctx, b.runId);
    if (detail.status !== "completed")
      throw new HttpError(
        409,
        "ASSESSMENT_NOT_READY",
        "Complete the assessment before requesting an action.",
      );
    const call = detail.calls.find(
      (c) => c.tool.startsWith("domain.") && c.status === "executed",
    );
    if (!call)
      throw new HttpError(404, "NOT_FOUND", "Domain assessment not found.");
    const assessment = call.output as Assessment;
    const proposal = assessment.proposals?.find((p) => p.id === b.proposalId);
    if (
      !proposal ||
      !proposal.requiresApproval ||
      !getTool(proposal.tool).requiresApproval
    )
      throw new HttpError(
        404,
        "NOT_FOUND",
        "Approved-action proposal not found.",
      );
    const row = getDb()
      .prepare(
        "SELECT agent_id,created_by FROM agent_runs WHERE organization_id=? AND id=?",
      )
      .get(ctx.organizationId, b.runId)!;
    if (row.created_by !== ctx.sub)
      throw new HttpError(
        403,
        "ORIGINAL_INITIATOR",
        "Only the original assessor can request their proposal.",
      );
    return startRun(ctx, {
      agentId: String(row.agent_id),
      requestKey: b.requestKey,
      goal: `Review proposal ${proposal.title}`,
      maxCostMinor: 0,
      steps: [
        {
          tool: proposal.tool,
          input: proposal.input,
          expectedSourceHash: proposal.expectedSourceHash,
        },
      ],
    });
  });
}
