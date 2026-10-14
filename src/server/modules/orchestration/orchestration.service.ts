import { createHash } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/server/db";
import { HttpError, requirePermission } from "@/server/auth/guards";
import type { JwtPayload } from "@/server/auth/crypto";
import {
  atomic,
  newId,
  nowIso,
  today,
  valid,
  moneySchema,
} from "../shared/domain";
import { recordAuditLog } from "../audit/audit.service";
import {
  getTool,
  toolCatalog,
  validateStep,
  sourceSnapshot,
  type Step,
} from "./registry";
import { planningProvider } from "./provider";
type Row = Record<string, unknown>;
const terminal = [
  "completed",
  "failed",
  "rejected",
  "cancelled",
  "killed",
  "budget_exceeded",
];
function fail(code: string, message: string, status = 409): never {
  throw new HttpError(status, code, message);
}
export function freshContext(org: string, userId: string): JwtPayload {
  const db = getDb(),
    u = db
      .prepare(
        `SELECT u.*,r.slug AS role_slug,o.slug AS org_slug FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id JOIN organizations o ON o.id=u.organization_id WHERE u.organization_id=? AND u.id=? AND u.status='active' AND u.deleted_at IS NULL AND r.deleted_at IS NULL AND o.status='active' AND o.deleted_at IS NULL`,
      )
      .get(org, userId);
  if (!u)
    return fail(
      "INACTIVE_ACTOR",
      "Run actor is inactive or outside this organization.",
      403,
    );
  const permissions = db
    .prepare(
      "SELECT p.code FROM permissions p JOIN role_permissions rp ON rp.permission_id=p.id AND rp.organization_id=p.organization_id WHERE p.organization_id=? AND rp.role_id=?",
    )
    .all(org, u.role_id)
    .map((p) => String(p.code));
  return {
    sub: userId,
    organizationId: org,
    organizationSlug: String(u.org_slug),
    email: String(u.email),
    fullName: String(u.full_name),
    branchId: u.branch_id as string | null,
    roleId: String(u.role_id),
    roleSlug: String(u.role_slug),
    permissions,
  };
}
function auth(ctx: JwtPayload, permission: string) {
  const fresh = freshContext(ctx.organizationId, ctx.sub);
  requirePermission(fresh, "agents:read");
  requirePermission(fresh, permission);
  return fresh;
}
function audit(
  org: string,
  actor: string,
  action: string,
  id: string,
  metadata: Record<string, unknown> = {},
) {
  recordAuditLog({
    organizationId: org,
    actorUserId: actor,
    action,
    entityType: "agent_run",
    entityId: id,
    metadata,
  });
}
function settings(org: string) {
  const row = getDb()
    .prepare("SELECT * FROM orchestration_settings WHERE organization_id=?")
    .get(org);
  if (!row) return fail("NOT_FOUND", "Engine settings not found.", 404);
  return row;
}
function agent(org: string, id: string) {
  const row = getDb()
    .prepare(
      "SELECT * FROM agents WHERE organization_id=? AND id=? AND deleted_at IS NULL",
    )
    .get(org, id);
  if (!row) return fail("NOT_FOUND", "Agent not found.", 404);
  return row;
}
function run(org: string, id: string) {
  const row = getDb()
    .prepare(
      "SELECT * FROM agent_runs WHERE organization_id=? AND id=? AND request_key IS NOT NULL",
    )
    .get(org, id);
  if (!row) return fail("NOT_FOUND", "Run not found.", 404);
  return row;
}
function visible(ctx: JwtPayload, row: Row) {
  if (row.created_by !== ctx.sub && !ctx.permissions.includes("admin:manage"))
    fail("NOT_FOUND", "Run not found.", 404);
}
function digest(
  org: string,
  runId: string,
  index: number,
  tool: string,
  version: string,
  inputJson: string,
  sourceHash: string | null,
) {
  return createHash("sha256")
    .update(
      JSON.stringify([org, runId, index, tool, version, inputJson, sourceHash]),
    )
    .digest("hex");
}
function guards(org: string, a: Row, row?: Row) {
  const controls = settings(org);
  if (!controls.enabled)
    fail("ENGINE_DISABLED", "Organization kill switch is active.");
  if (!a.is_enabled) fail("AGENT_DISABLED", "Agent kill switch is active.");
  const db = getDb(),
    day = today();
  const spend = Number(
    db
      .prepare(
        "SELECT COALESCE(SUM(cost_minor),0) n FROM agent_runs WHERE organization_id=? AND date(created_at,'+5 hours')=?",
      )
      .get(org, day)!.n,
  );
  const agentSpend = Number(
    db
      .prepare(
        "SELECT COALESCE(SUM(cost_minor),0) n FROM agent_runs WHERE organization_id=? AND agent_id=? AND date(created_at,'+5 hours')=?",
      )
      .get(org, String(a.id), day)!.n,
  );
  if (
    spend > Number(controls.daily_cost_budget_minor) ||
    agentSpend > Number(a.cost_budget_minor) ||
    (row && Number(row.cost_minor) > Number(row.max_cost_minor))
  )
    fail(
      "COST_BUDGET",
      "Recorded provider cost exceeds the configured budget.",
    );
  if (row) {
    const count = Number(
      db
        .prepare(
          "SELECT COUNT(*) n FROM tool_calls WHERE organization_id=? AND date(executed_at,'+5 hours')=?",
        )
        .get(org, day)!.n,
    );
    if (
      count >= Number(controls.daily_tool_limit) ||
      Number(row.next_step) >= Number(controls.max_steps)
    )
      fail("TOOL_BUDGET", "Daily tool quota or per-run step limit reached.");
  }
  return controls;
}
function stopRun(
  org: string,
  id: string,
  status: string,
  code: string,
  message: string,
  actor: string,
) {
  const db = getDb(),
    now = nowIso();
  db.prepare(
    "UPDATE approval_requests SET status='cancelled',updated_at=? WHERE organization_id=? AND agent_run_id=? AND status IN ('pending','approved') AND tool_call_id IN (SELECT id FROM tool_calls WHERE organization_id=? AND agent_run_id=? AND status='pending')",
  ).run(now, org, id, org, id);
  db.prepare(
    "UPDATE tool_calls SET status='cancelled',updated_at=? WHERE organization_id=? AND agent_run_id=? AND status='pending'",
  ).run(now, org, id);
  db.prepare(
    "UPDATE agent_runs SET status=?,error_code=?,error_message=?,updated_at=? WHERE organization_id=? AND id=?",
  ).run(status, code, message, now, org, id);
  audit(org, actor, "agents.run_stopped", id, { status, code, message });
}
export function startRun(ctx: JwtPayload, input: unknown) {
  ctx = auth(ctx, "agents:run");
  const result = planningProvider().plan(input),
    b = result.plan;
  return atomic(() => {
    const db = getDb(),
      org = ctx.organizationId,
      a = agent(org, b.agentId),
      controls = guards(org, a),
      steps = b.steps.map((s) =>
        validateStep(
          ctx,
          { tool: s.tool, input: s.input },
          JSON.parse(String(a.allowed_tools_json)),
        ),
      );
    if (steps.length > Number(controls.max_steps))
      fail("STEP_LIMIT", "Plan exceeds organization step limit.", 400);
    if (
      a.autonomy_level === "suggest_only" &&
      steps.some((s) => getTool(s.tool).requiresApproval)
    )
      fail(
        "SUGGEST_ONLY",
        "Suggest-only agents execute read-only plans; no write can bypass this control.",
        403,
      );
    const existing = db
      .prepare(
        "SELECT * FROM agent_runs WHERE organization_id=? AND created_by=? AND request_key=?",
      )
      .get(org, ctx.sub, b.requestKey);
    if (existing) {
      if (
        existing.agent_id !== b.agentId ||
        existing.input_text !== b.goal ||
        existing.plan_json !== JSON.stringify(steps) ||
        existing.max_cost_minor !== b.maxCostMinor
      )
        fail(
          "REQUEST_CONFLICT",
          "Request key already used for different intent.",
        );
      return { id: String(existing.id), status: String(existing.status) };
    }
    const count = Number(
      db
        .prepare(
          "SELECT COUNT(*) n FROM agent_runs WHERE organization_id=? AND created_by=? AND date(created_at,'+5 hours')=?",
        )
        .get(org, ctx.sub, today())!.n,
    );
    if (count >= 100)
      fail("RUN_QUOTA", "At most 100 plan submissions per user/day.");
    if (result.costMinor > b.maxCostMinor)
      fail("COST_BUDGET", "Planning cost exceeds run budget.");
    const id = newId("run"),
      now = nowIso();
    db.prepare(
      `INSERT INTO agent_runs (id,organization_id,agent_id,trigger_type,input_text,reasoning_summary,output_text,status,tokens_used,cost_minor,created_at,updated_at,created_by,plan_json,request_key,provider,max_cost_minor) VALUES (?,?,?,'manual',?,?,?,'queued',?,?,?,?,?,?,?,?,?)`,
    ).run(
      id,
      org,
      b.agentId,
      b.goal,
      result.summary,
      "Plan queued; no tool has executed.",
      result.tokensUsed,
      result.costMinor,
      now,
      now,
      ctx.sub,
      JSON.stringify(steps),
      b.requestKey,
      "local-scripted",
      b.maxCostMinor,
    );
    audit(org, ctx.sub, "agents.run_queued", id, {
      agentId: b.agentId,
      steps: steps.length,
      provider: "local-scripted",
      costMinor: result.costMinor,
    });
    return { id, status: "queued" };
  });
}
function validateCall(org: string, row: Row, call: Row, creator: JwtPayload) {
  requirePermission(creator, "agents:run");
  requirePermission(creator, "agents:read");
  const a = agent(org, String(row.agent_id));
  guards(org, a, row);
  const plan = JSON.parse(String(row.plan_json)) as Step[],
    step = plan[Number(row.next_step)],
    tool = getTool(String(call.tool_name));
  if (
    !step ||
    step.tool !== call.tool_name ||
    JSON.stringify(step.input) !== call.input_json ||
    tool.version !== call.tool_version ||
    call.input_hash !==
      digest(
        org,
        String(row.id),
        Number(call.step_index),
        tool.name,
        tool.version,
        String(call.input_json),
        call.source_hash as string | null,
      )
  )
    fail(
      "INTENT_CHANGED",
      "Approved intent/tool version no longer matches immutable plan.",
    );
  validateStep(creator, step, JSON.parse(String(a.allowed_tools_json)));
  if (tool.requiresApproval && a.autonomy_level === "suggest_only")
    fail("SUGGEST_ONLY", "Suggest-only control blocks writes.", 403);
  if (tool.requiresApproval) {
    const sourceHash = createHash("sha256")
      .update(JSON.stringify(sourceSnapshot(creator, step)))
      .digest("hex");
    if (sourceHash !== call.source_hash)
      fail(
        "STALE_APPROVAL",
        "Source state changed since approval was requested. Submit a new plan for review.",
      );
    const approval = getDb()
      .prepare(
        "SELECT * FROM approval_requests WHERE organization_id=? AND tool_call_id=? AND agent_run_id=?",
      )
      .get(org, String(call.id), String(row.id));
    if (!approval || approval.status !== "approved")
      fail("APPROVAL_REQUIRED", "Independent approval is required.");
    const payload = JSON.parse(String(approval.payload_json));
    if (
      payload.digest !== call.input_hash ||
      payload.tool !== tool.name ||
      JSON.stringify(payload.input) !== call.input_json ||
      payload.sourceHash !== call.source_hash
    )
      fail("INTENT_CHANGED", "Approval payload does not match tool intent.");
    const reviewer = freshContext(org, String(approval.reviewed_by));
    requirePermission(reviewer, "agents:approve");
    requirePermission(reviewer, "agents:read");
    requirePermission(reviewer, tool.permission);
    if (reviewer.sub === creator.sub)
      fail("SELF_APPROVAL", "Creator cannot approve their own write.", 403);
  }
  return tool;
}
/** One durable step per call, no asynchronous provider work inside SQLite transactions. */
export function advanceInternal(org: string, id: string, actor = "system") {
  let callId: string | undefined;
  try {
    const staged = atomic(() => {
      const db = getDb(),
        row = run(org, id);
      if (row.status !== "queued") return null;
      const creator = freshContext(org, String(row.created_by)),
        a = agent(org, String(row.agent_id));
      requirePermission(creator, "agents:run");
      requirePermission(creator, "agents:read");
      guards(org, a, row);
      const steps = JSON.parse(String(row.plan_json)) as Step[],
        step = steps[Number(row.next_step)];
      if (!step) fail("INVALID_PLAN", "No step at run cursor.");
      const parsed = validateStep(
          creator,
          step,
          JSON.parse(String(a.allowed_tools_json)),
        ),
        tool = getTool(parsed.tool);
      if (a.autonomy_level === "suggest_only" && tool.requiresApproval)
        fail("SUGGEST_ONLY", "Suggest-only control blocks writes.", 403);
      let call = db
        .prepare(
          "SELECT * FROM tool_calls WHERE organization_id=? AND agent_run_id=? AND step_index=?",
        )
        .get(org, id, row.next_step);
      if (!call) {
        const cid = newId("call"),
          now = nowIso(),
          json = JSON.stringify(parsed.input),
          snapshot = tool.requiresApproval
            ? sourceSnapshot(creator, parsed)
            : null,
          sourceHash = tool.requiresApproval
            ? createHash("sha256")
                .update(JSON.stringify(snapshot))
                .digest("hex")
            : null,
          hash = digest(
            org,
            id,
            Number(row.next_step),
            tool.name,
            tool.version,
            json,
            sourceHash,
          );
        db.prepare(
          `INSERT INTO tool_calls (id,organization_id,agent_run_id,tool_name,input_json,output_json,requires_approval,status,created_at,updated_at,created_by,step_index,input_hash,tool_version,source_hash) VALUES (?,?,?,?,?,'{}',?,'pending',?,?,?,?,?,?,?)`,
        ).run(
          cid,
          org,
          id,
          tool.name,
          json,
          Number(tool.requiresApproval),
          now,
          now,
          row.created_by,
          row.next_step,
          hash,
          tool.version,
          sourceHash,
        );
        call = db
          .prepare("SELECT * FROM tool_calls WHERE id=? AND organization_id=?")
          .get(cid, org)!;
        if (tool.requiresApproval) {
          const aid = newId("apr");
          db.prepare(
            `INSERT INTO approval_requests (id,organization_id,agent_run_id,tool_call_id,agent_slug,action_type,summary,payload_json,status,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,?,'pending',?,?,?)`,
          ).run(
            aid,
            org,
            id,
            cid,
            a.slug,
            tool.name,
            `Approve exact ${tool.name} input; no execution yet.`,
            JSON.stringify({
              tool: tool.name,
              input: parsed.input,
              digest: hash,
              version: tool.version,
              sourceHash,
              sourceSnapshot: snapshot,
            }),
            now,
            now,
            row.created_by,
          );
          audit(org, actor, "agents.approval_requested", id, {
            approvalId: aid,
            tool: tool.name,
            digest: hash,
          });
        }
      }
      if (tool.requiresApproval) {
        const approval = db
          .prepare(
            "SELECT status FROM approval_requests WHERE organization_id=? AND tool_call_id=?",
          )
          .get(org, call.id);
        if (approval?.status !== "approved") {
          db.prepare(
            "UPDATE agent_runs SET status='waiting_approval',updated_at=? WHERE organization_id=? AND id=?",
          ).run(nowIso(), org, id);
          return null;
        }
      }
      return String(call.id);
    });
    if (!staged) return { id, status: String(run(org, id).status) };
    callId = staged;
    return atomic(() => {
      const db = getDb(),
        row = run(org, id),
        call = db
          .prepare(
            "SELECT * FROM tool_calls WHERE organization_id=? AND id=? AND agent_run_id=?",
          )
          .get(org, staged, id)!;
      if (
        row.status !== "queued" ||
        row.next_step !== call.step_index ||
        call.status !== "pending"
      )
        return { id, status: String(row.status) };
      const creator = freshContext(org, String(row.created_by)),
        tool = validateCall(org, row, call, creator),
        started = Date.now();
      const output = tool.execute(creator, JSON.parse(String(call.input_json))),
        json = JSON.stringify(output);
      if (Buffer.byteLength(json, "utf8") > 256 * 1024)
        fail("OUTPUT_TOO_LARGE", "Tool output exceeds 256 KiB; narrow scope.");
      const now = nowIso(),
        next = Number(row.next_step) + 1,
        steps = JSON.parse(String(row.plan_json)) as Step[],
        status = next === steps.length ? "completed" : "queued";
      db.prepare(
        "UPDATE tool_calls SET status='executed',output_json=?,duration_ms=?,executed_at=?,updated_at=? WHERE organization_id=? AND id=?",
      ).run(json, Date.now() - started, now, now, org, staged);
      const approved = db
        .prepare(
          "SELECT reviewed_by FROM approval_requests WHERE organization_id=? AND tool_call_id=? AND status='approved'",
        )
        .get(org, staged);
      db.prepare(
        "UPDATE agent_runs SET next_step=?,status=?,output_text=?,approved_by=COALESCE(?,approved_by),updated_at=? WHERE organization_id=? AND id=?",
      ).run(
        next,
        status,
        `Executed ${tool.name}; ${next}/${steps.length} steps completed.`,
        approved?.reviewed_by || null,
        now,
        org,
        id,
      );
      audit(org, actor, "agents.tool_executed", id, {
        tool: tool.name,
        stepIndex: call.step_index,
        callId: staged,
        initiator: creator.sub,
        approvedBy: approved?.reviewed_by || null,
        digest: call.input_hash,
      });
      return { id, status };
    });
  } catch (error) {
    const code = error instanceof HttpError ? error.code : "TOOL_FAILED",
      message =
        error instanceof HttpError
          ? error.message
          : "Tool execution failed; source changes rolled back.";
    return atomic(() => {
      const db = getDb(),
        row = run(org, id);
      if (terminal.includes(String(row.status)))
        return { id, status: String(row.status) };
      if (callId)
        db.prepare(
          "UPDATE tool_calls SET status='failed',output_json=?,executed_at=?,updated_at=? WHERE organization_id=? AND id=? AND status='pending'",
        ).run(
          JSON.stringify({ error: { code, message } }),
          nowIso(),
          nowIso(),
          org,
          callId,
        );
      const status = code.includes("BUDGET")
        ? "budget_exceeded"
        : ["ENGINE_DISABLED", "AGENT_DISABLED"].includes(code)
          ? "killed"
          : "failed";
      stopRun(org, id, status, code, message, actor);
      return { id, status };
    });
  }
}
export function advanceRun(ctx: JwtPayload, id: string) {
  ctx = auth(ctx, "agents:run");
  visible(ctx, run(ctx.organizationId, id));
  return advanceInternal(ctx.organizationId, id, ctx.sub);
}
export function cancelRun(ctx: JwtPayload, input: unknown) {
  ctx = auth(ctx, "agents:run");
  const b = valid(
    z
      .object({
        id: z.string().min(1),
        reason: z.string().trim().min(3).max(500),
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const row = run(ctx.organizationId, b.id);
    visible(ctx, row);
    if (!terminal.includes(String(row.status)))
      stopRun(
        ctx.organizationId,
        b.id,
        "cancelled",
        "USER_CANCELLED",
        b.reason,
        ctx.sub,
      );
    return { id: b.id, status: String(run(ctx.organizationId, b.id).status) };
  });
}
export function reviewApproval(ctx: JwtPayload, input: unknown) {
  ctx = auth(ctx, "agents:approve");
  const b = valid(
    z
      .object({
        id: z.string().min(1),
        decision: z.enum(["approve", "reject"]),
        reason: z.string().trim().min(3).max(500),
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const db = getDb(),
      org = ctx.organizationId,
      approval = db
        .prepare(
          "SELECT * FROM approval_requests WHERE organization_id=? AND id=?",
        )
        .get(org, b.id);
    if (!approval) fail("NOT_FOUND", "Approval not found.", 404);
    const row = run(org, String(approval.agent_run_id)),
      tool = getTool(String(approval.action_type));
    requirePermission(ctx, tool.permission);
    if (row.created_by === ctx.sub)
      fail(
        "SELF_APPROVAL",
        "Creator cannot approve or review their own write.",
        403,
      );
    const status = b.decision === "approve" ? "approved" : "rejected";
    if (
      approval.status === status &&
      approval.reviewed_by === ctx.sub &&
      approval.review_note === b.reason
    )
      return { id: b.id, status };
    if (approval.status !== "pending" || row.status !== "waiting_approval")
      fail("ALREADY_REVIEWED", "Approval is no longer pending.");
    const now = nowIso();
    db.prepare(
      "UPDATE approval_requests SET status=?,reviewed_by=?,reviewed_at=?,review_note=?,updated_at=? WHERE organization_id=? AND id=?",
    ).run(status, ctx.sub, now, b.reason, now, org, b.id);
    if (status === "rejected") {
      db.prepare(
        "UPDATE tool_calls SET status='rejected',updated_at=? WHERE organization_id=? AND id=?",
      ).run(now, org, approval.tool_call_id);
      db.prepare(
        "UPDATE agent_runs SET status='rejected',error_code='APPROVAL_REJECTED',error_message=?,updated_at=? WHERE organization_id=? AND id=?",
      ).run(b.reason, now, org, row.id);
    } else
      db.prepare(
        "UPDATE agent_runs SET status='queued',updated_at=? WHERE organization_id=? AND id=?",
      ).run(now, org, row.id);
    audit(org, ctx.sub, `agents.approval_${status}`, String(row.id), {
      approvalId: b.id,
      reason: b.reason,
      digest: JSON.parse(String(approval.payload_json)).digest,
    });
    return { id: b.id, status };
  });
}
export function orchestrationCatalog(ctx: JwtPayload) {
  ctx = auth(ctx, "agents:read");
  const db = getDb(),
    org = ctx.organizationId;
  const tools = toolCatalog().filter((t) =>
    ctx.permissions.includes(t.permission),
  );
  const agents = db
    .prepare(
      "SELECT id,slug,name,autonomy_level,is_enabled,cost_budget_minor,allowed_tools_json FROM agents WHERE organization_id=? AND deleted_at IS NULL ORDER BY name",
    )
    .all(org)
    .map((a) => ({
      id: String(a.id),
      slug: String(a.slug),
      name: String(a.name),
      autonomy: String(a.autonomy_level),
      enabled: !!a.is_enabled,
      costBudgetMinor: Number(a.cost_budget_minor),
      allowedTools: JSON.parse(String(a.allowed_tools_json)) as string[],
    }));
  const runs = db
    .prepare(
      `SELECT r.id,r.agent_id,a.name AS agent_name,r.input_text,r.status,r.next_step,r.cost_minor,r.tokens_used,r.created_at,r.created_by,r.error_code,r.error_message FROM agent_runs r JOIN agents a ON a.id=r.agent_id AND a.organization_id=r.organization_id WHERE r.organization_id=? AND r.request_key IS NOT NULL ${ctx.permissions.includes("admin:manage") ? "" : "AND r.created_by=?"} ORDER BY r.created_at DESC,r.id DESC LIMIT 100`,
    )
    .all(org, ...(ctx.permissions.includes("admin:manage") ? [] : [ctx.sub]))
    .map((r) => ({
      id: String(r.id),
      agentId: String(r.agent_id),
      agentName: String(r.agent_name),
      goal: String(r.input_text),
      status: String(r.status),
      nextStep: Number(r.next_step),
      costMinor: Number(r.cost_minor),
      tokensUsed: Number(r.tokens_used),
      createdAt: String(r.created_at),
      createdBy: String(r.created_by),
      error: r.error_message as string | null,
    }));
  const approvals = ctx.permissions.includes("agents:approve")
    ? db
        .prepare(
          "SELECT id,agent_run_id,action_type,summary,payload_json,status,created_by,reviewed_by,review_note FROM approval_requests WHERE organization_id=? ORDER BY created_at DESC,id DESC LIMIT 100",
        )
        .all(org)
        .filter((a) =>
          ctx.permissions.includes(getTool(String(a.action_type)).permission),
        )
        .map((a) => ({
          id: String(a.id),
          runId: String(a.agent_run_id),
          tool: String(a.action_type),
          summary: String(a.summary),
          payload: JSON.parse(String(a.payload_json)) as {
            input: unknown;
            digest: string;
          },
          status: String(a.status),
          createdBy: String(a.created_by),
          reviewedBy: a.reviewed_by as string | null,
          reviewNote: a.review_note as string | null,
        }))
    : [];
  return {
    provider: "local-scripted",
    externalCallsEnabled: false,
    tools,
    agents,
    runs,
    approvals,
    settings: settings(org),
  };
}
export function runDetail(ctx: JwtPayload, id: string) {
  ctx = auth(ctx, "agents:read");
  const row = run(ctx.organizationId, id);
  visible(ctx, row);
  for (const step of JSON.parse(String(row.plan_json)) as Step[])
    requirePermission(ctx, getTool(step.tool).permission);
  const calls = getDb()
    .prepare(
      "SELECT id,tool_name,input_json,output_json,status,step_index,requires_approval,input_hash,duration_ms,executed_at FROM tool_calls WHERE organization_id=? AND agent_run_id=? ORDER BY step_index",
    )
    .all(ctx.organizationId, id)
    .map((c) => ({
      id: String(c.id),
      tool: String(c.tool_name),
      input: JSON.parse(String(c.input_json)),
      output: JSON.parse(String(c.output_json)),
      status: String(c.status),
      stepIndex: Number(c.step_index),
      requiresApproval: !!c.requires_approval,
      digest: String(c.input_hash),
      durationMs: Number(c.duration_ms),
      executedAt: c.executed_at as string | null,
    }));
  return {
    id,
    status: String(row.status),
    goal: String(row.input_text),
    summary: String(row.reasoning_summary),
    output: String(row.output_text),
    nextStep: Number(row.next_step),
    plan: JSON.parse(String(row.plan_json)) as Step[],
    calls,
    error: row.error_message as string | null,
  };
}
export function configureEngine(ctx: JwtPayload, input: unknown) {
  ctx = auth(ctx, "admin:manage");
  const b = valid(
    z
      .object({
        enabled: z.boolean(),
        dailyCostBudgetMinor: moneySchema.max(1000000),
        dailyToolLimit: z.number().int().min(0).max(1000),
        maxSteps: z.number().int().min(1).max(20),
      })
      .strict(),
    input,
  );
  return atomic(() => {
    const db = getDb(),
      org = ctx.organizationId;
    db.prepare(
      "UPDATE orchestration_settings SET enabled=?,daily_cost_budget_minor=?,daily_tool_limit=?,max_steps=?,updated_at=?,created_by=? WHERE organization_id=?",
    ).run(
      Number(b.enabled),
      b.dailyCostBudgetMinor,
      b.dailyToolLimit,
      b.maxSteps,
      nowIso(),
      ctx.sub,
      org,
    );
    if (!b.enabled)
      for (const row of db
        .prepare(
          "SELECT id FROM agent_runs WHERE organization_id=? AND status IN ('queued','waiting_approval')",
        )
        .all(org))
        stopRun(
          org,
          String(row.id),
          "killed",
          "ENGINE_DISABLED",
          "Organization kill switch activated.",
          ctx.sub,
        );
    audit(org, ctx.sub, "agents.engine_configured", org, b);
    return { saved: true };
  });
}
export function configureAgent(ctx: JwtPayload, input: unknown) {
  ctx = auth(ctx, "admin:manage");
  const b = valid(
    z
      .object({
        id: z.string().min(1),
        enabled: z.boolean(),
        autonomy: z.enum(["suggest_only", "act_with_approval"]),
        costBudgetMinor: moneySchema.max(1000000),
        allowedTools: z.array(z.string()).max(20),
      })
      .strict(),
    input,
  );
  b.allowedTools.forEach(getTool);
  return atomic(() => {
    const org = ctx.organizationId,
      db = getDb();
    agent(org, b.id);
    db.prepare(
      "UPDATE agents SET is_enabled=?,autonomy_level=?,cost_budget_minor=?,allowed_tools_json=?,updated_at=? WHERE organization_id=? AND id=?",
    ).run(
      Number(b.enabled),
      b.autonomy,
      b.costBudgetMinor,
      JSON.stringify([...new Set(b.allowedTools)]),
      nowIso(),
      org,
      b.id,
    );
    if (!b.enabled)
      for (const row of db
        .prepare(
          "SELECT id FROM agent_runs WHERE organization_id=? AND agent_id=? AND status IN ('queued','waiting_approval')",
        )
        .all(org, b.id))
        stopRun(
          org,
          String(row.id),
          "killed",
          "AGENT_DISABLED",
          "Agent kill switch activated.",
          ctx.sub,
        );
    audit(org, ctx.sub, "agents.agent_configured", b.id, b);
    return { saved: true };
  });
}
export function runAgentCycle(org: string) {
  const rows = getDb()
    .prepare(
      "SELECT id FROM agent_runs WHERE organization_id=? AND status='queued' AND request_key IS NOT NULL ORDER BY created_at,id LIMIT 50",
    )
    .all(org);
  return {
    advanced: rows.length,
    results: rows.map((r) => advanceInternal(org, String(r.id))),
  };
}
