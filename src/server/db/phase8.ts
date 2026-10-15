import type { DatabaseSync } from "node:sqlite";
export function migratePhase8(db: DatabaseSync) {
  if (
    !db
      .prepare("PRAGMA table_info(users)")
      .all()
      .some((c) => c.name === "token_version")
  )
    db.exec(
      "ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0",
    );
  db.exec(`CREATE TABLE IF NOT EXISTS auth_rate_limits(key TEXT PRIMARY KEY,count INTEGER NOT NULL,reset_at INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS portal_reviews(id TEXT PRIMARY KEY,organization_id TEXT NOT NULL REFERENCES organizations(id),owner_id TEXT NOT NULL REFERENCES owners(id),property_id TEXT NOT NULL REFERENCES properties(id),entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,summary TEXT NOT NULL,proposed_cost_minor INTEGER NOT NULL,source_hash TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',decision_note TEXT,created_at TEXT NOT NULL,created_by TEXT NOT NULL,reviewed_at TEXT,reviewed_by TEXT);
 CREATE INDEX IF NOT EXISTS portal_review_owner ON portal_reviews(organization_id,owner_id,status,created_at);
 CREATE TRIGGER IF NOT EXISTS portal_review_intent BEFORE UPDATE ON portal_reviews WHEN NEW.id!=OLD.id OR NEW.organization_id!=OLD.organization_id OR NEW.owner_id!=OLD.owner_id OR NEW.property_id!=OLD.property_id OR NEW.entity_type!=OLD.entity_type OR NEW.entity_id!=OLD.entity_id OR NEW.summary!=OLD.summary OR NEW.proposed_cost_minor!=OLD.proposed_cost_minor OR NEW.source_hash!=OLD.source_hash OR NEW.created_by!=OLD.created_by OR NEW.created_at!=OLD.created_at OR OLD.status!='pending' BEGIN SELECT RAISE(ABORT,'Owner review intent/decision is immutable'); END;
 CREATE TRIGGER IF NOT EXISTS portal_review_no_delete BEFORE DELETE ON portal_reviews BEGIN SELECT RAISE(ABORT,'Owner reviews are retained'); END;
 CREATE INDEX IF NOT EXISTS portal_tenant_user ON tenants(organization_id,user_id) WHERE deleted_at IS NULL;
 CREATE INDEX IF NOT EXISTS portal_owner_user ON owners(organization_id,user_id) WHERE deleted_at IS NULL;
 CREATE INDEX IF NOT EXISTS portal_invoice_tenant ON invoices(organization_id,tenant_id,due_date,id) WHERE deleted_at IS NULL;
 CREATE INDEX IF NOT EXISTS portal_lease_tenant ON leases(organization_id,tenant_id,end_date,id) WHERE deleted_at IS NULL;
 CREATE INDEX IF NOT EXISTS portal_ticket_tenant ON maintenance_tickets(organization_id,tenant_id,created_at,id) WHERE deleted_at IS NULL;
 CREATE INDEX IF NOT EXISTS portal_statement_owner ON owner_statements(organization_id,owner_id,period_month,id);`);
}
