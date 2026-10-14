import type { DatabaseSync } from "node:sqlite";
export const INITIAL_TOOLS: Record<string, string[]> = {
  "lead-agent": ["portfolio.units", "crm.leads"],
  "listing-agent": ["portfolio.units"],
  "rent-collection-agent": [
    "billing.invoices",
    "billing.credit",
    "billing.payment",
  ],
  "maintenance-triage-agent": ["maintenance.board", "maintenance.assign"],
  "lease-lifecycle-agent": ["leases.list"],
  "insights-knowledge-agent": [
    "portfolio.units",
    "reports.financial",
    "accounting.expense",
  ],
};
export function migratePhase6(db: DatabaseSync) {
  const columns: Record<string, Record<string, string>> = {
    agents: { runtime_initialized: "INTEGER NOT NULL DEFAULT 0" },
    agent_runs: {
      plan_json: "TEXT NOT NULL DEFAULT '[]'",
      next_step: "INTEGER NOT NULL DEFAULT 0",
      request_key: "TEXT",
      provider: "TEXT NOT NULL DEFAULT 'local-scripted'",
      max_cost_minor: "INTEGER NOT NULL DEFAULT 0",
      error_code: "TEXT",
      error_message: "TEXT",
    },
    tool_calls: {
      step_index: "INTEGER",
      input_hash: "TEXT",
      tool_version: "TEXT",
      source_hash: "TEXT",
      executed_at: "TEXT",
    },
  };
  for (const [table, adds] of Object.entries(columns)) {
    const existing = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name),
    );
    for (const [name, type] of Object.entries(adds))
      if (!existing.has(name))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${type}`);
  }
  db.exec(`CREATE TABLE IF NOT EXISTS orchestration_settings (
 organization_id TEXT PRIMARY KEY REFERENCES organizations(id),enabled INTEGER NOT NULL DEFAULT 1,
 daily_cost_budget_minor INTEGER NOT NULL DEFAULT 500000,daily_tool_limit INTEGER NOT NULL DEFAULT 200,
 max_steps INTEGER NOT NULL DEFAULT 20,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,created_by TEXT NOT NULL);
 CREATE UNIQUE INDEX IF NOT EXISTS idx_run_request ON agent_runs(organization_id,created_by,request_key) WHERE request_key IS NOT NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS idx_run_step ON tool_calls(organization_id,agent_run_id,step_index) WHERE step_index IS NOT NULL;
 CREATE UNIQUE INDEX IF NOT EXISTS idx_approval_call ON approval_requests(organization_id,tool_call_id) WHERE tool_call_id IS NOT NULL;
 CREATE TRIGGER IF NOT EXISTS tool_input_immutable BEFORE UPDATE OF organization_id,agent_run_id,tool_name,input_json,input_hash,tool_version,source_hash,step_index ON tool_calls WHEN OLD.step_index IS NOT NULL BEGIN SELECT RAISE(ABORT,'Tool intent is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS approval_intent_immutable BEFORE UPDATE OF organization_id,agent_run_id,tool_call_id,payload_json,action_type ON approval_requests BEGIN SELECT RAISE(ABORT,'Approval intent is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS run_plan_immutable BEFORE UPDATE OF organization_id,agent_id,created_by,plan_json,request_key,max_cost_minor,provider,input_text ON agent_runs WHEN OLD.request_key IS NOT NULL BEGIN SELECT RAISE(ABORT,'Run plan is immutable'); END;`);
  const now = new Date().toISOString();
  for (const org of db
    .prepare(
      "SELECT id FROM organizations WHERE status='active' AND deleted_at IS NULL",
    )
    .all())
    db.prepare(
      "INSERT OR IGNORE INTO orchestration_settings (organization_id,created_at,updated_at,created_by) VALUES (?,?,?,?)",
    ).run(org.id, now, now, "system");
  for (const agent of db
    .prepare(
      "SELECT id,slug,organization_id FROM agents WHERE runtime_initialized=0",
    )
    .all())
    db.prepare(
      "UPDATE agents SET allowed_tools_json=?,runtime_initialized=1,autonomy_level=CASE WHEN autonomy_level='suggest_only' THEN autonomy_level ELSE 'act_with_approval' END WHERE id=? AND organization_id=?",
    ).run(
      JSON.stringify(INITIAL_TOOLS[String(agent.slug)] || []),
      agent.id,
      agent.organization_id,
    );
}
