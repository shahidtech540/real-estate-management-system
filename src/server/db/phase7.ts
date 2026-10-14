import type { DatabaseSync } from "node:sqlite";
import { INITIAL_TOOLS } from "./phase6";
const extensions: Record<string, string[]> = {
  "lead-agent": ["domain.lead", "crm.qualify", "crm.viewing"],
  "listing-agent": ["domain.listing", "listings.draft"],
  "rent-collection-agent": ["domain.rent", "rent.reminder"],
  "maintenance-triage-agent": ["domain.maintenance", "maintenance.triage"],
  "lease-lifecycle-agent": ["domain.lease", "leases.offer"],
  "insights-knowledge-agent": ["domain.insights"],
};
export function migratePhase7(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      !db
        .prepare("PRAGMA table_info(agents)")
        .all()
        .some((c) => c.name === "domain_initialized")
    )
      db.exec(
        "ALTER TABLE agents ADD COLUMN domain_initialized INTEGER NOT NULL DEFAULT 0",
      );
    db.exec(`CREATE TABLE IF NOT EXISTS agent_artifacts (
 id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),kind TEXT NOT NULL,
 entity_id TEXT NOT NULL,reference TEXT NOT NULL,content_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',
 created_at TEXT NOT NULL,created_by TEXT NOT NULL,UNIQUE(organization_id,reference));
 CREATE TRIGGER IF NOT EXISTS artifact_immutable BEFORE UPDATE ON agent_artifacts BEGIN SELECT RAISE(ABORT,'Agent artifacts are immutable drafts'); END;
 CREATE TRIGGER IF NOT EXISTS artifact_no_delete BEFORE DELETE ON agent_artifacts BEGIN SELECT RAISE(ABORT,'Agent artifacts are immutable drafts'); END;`);
    for (const a of db
      .prepare(
        "SELECT id,organization_id,slug,allowed_tools_json FROM agents WHERE domain_initialized=0",
      )
      .all()) {
      const defaults = INITIAL_TOOLS[String(a.slug)] || [],
        current = JSON.parse(String(a.allowed_tools_json)) as string[];
      // Preserve bespoke admin allowlists; only extend untouched Phase 6 defaults.
      const pristine =
        Array.isArray(current) &&
        current.length === defaults.length &&
        new Set(current).size === defaults.length &&
        current.every((t) => defaults.includes(t));
      const next = pristine
        ? [...new Set([...current, ...(extensions[String(a.slug)] || [])])]
        : current;
      db.prepare(
        "UPDATE agents SET allowed_tools_json=?,domain_initialized=1 WHERE organization_id=? AND id=?",
      ).run(JSON.stringify(next), a.organization_id, a.id);
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
