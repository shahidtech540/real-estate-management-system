import type { DatabaseSync } from "node:sqlite";
export const DEFAULT_ACCOUNTS = [
  ["1000", "Recorded cash and bank", "asset"],
  ["1100", "Tenant receivables", "asset"],
  ["1190", "Legacy settlements clearing — not verified cash", "asset"],
  ["2000", "Maintenance payables", "liability"],
  ["2100", "Tenant security deposits held", "liability"],
  ["3000", "Opening equity / adjustments", "equity"],
  ["3100", "Owner distributions (consolidated)", "equity"],
  ["4000", "Rental and lease charges", "income"],
  ["4010", "Utility charges recovered", "income"],
  ["4020", "Service and maintenance charges recovered", "income"],
  ["5000", "Repairs and maintenance", "expense"],
  ["5010", "Utilities expense", "expense"],
  ["5020", "Management and administration", "expense"],
  ["5090", "Other property expenses", "expense"],
] as const;
export function migratePhase5(db: DatabaseSync) {
  const unitColumns = new Set(
    db
      .prepare("PRAGMA table_info(units)")
      .all()
      .map((c) => c.name),
  );
  if (!unitColumns.has("vacant_since"))
    db.exec("ALTER TABLE units ADD COLUMN vacant_since TEXT");
  db.exec(`
 CREATE TABLE IF NOT EXISTS journal_batches (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), property_id TEXT REFERENCES properties(id),
  entry_date TEXT NOT NULL, description TEXT NOT NULL, source_type TEXT NOT NULL, source_id TEXT NOT NULL,
  reference TEXT NOT NULL, reversed_batch_id TEXT UNIQUE REFERENCES journal_batches(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
  UNIQUE(organization_id,reference)
 );
 CREATE INDEX IF NOT EXISTS idx_journal_org_date ON journal_batches(organization_id,entry_date,property_id);
 CREATE TABLE IF NOT EXISTS accounting_source_state (
  organization_id TEXT NOT NULL REFERENCES organizations(id), source_type TEXT NOT NULL, source_id TEXT NOT NULL,
  posted_minor INTEGER NOT NULL, property_id TEXT REFERENCES properties(id), revision INTEGER NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
  PRIMARY KEY(organization_id,source_type,source_id)
 );
 CREATE TABLE IF NOT EXISTS ledger_owner_allocations (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), ledger_entry_id TEXT NOT NULL REFERENCES ledger_entries(id),
  owner_id TEXT REFERENCES owners(id), amount_minor INTEGER NOT NULL CHECK(amount_minor>=0), ownership_basis_points INTEGER NOT NULL,
  created_at TEXT NOT NULL, created_by TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS idx_ledger_owner_scope ON ledger_owner_allocations(organization_id,owner_id,ledger_entry_id);
 CREATE TABLE IF NOT EXISTS accounting_expenses (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), property_id TEXT NOT NULL REFERENCES properties(id),
  account_id TEXT NOT NULL REFERENCES accounts(id), amount_minor INTEGER NOT NULL, expense_date TEXT NOT NULL,
  description TEXT NOT NULL, reference TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'posted', journal_id TEXT NOT NULL REFERENCES journal_batches(id),
  receipt_name TEXT, receipt_mime TEXT, receipt_data TEXT, void_reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
  UNIQUE(organization_id,reference)
 );
 CREATE TABLE IF NOT EXISTS accounting_budgets (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), property_id TEXT NOT NULL REFERENCES properties(id),
  account_id TEXT NOT NULL REFERENCES accounts(id), period_month TEXT NOT NULL, amount_minor INTEGER NOT NULL, owner_shares_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
  UNIQUE(organization_id,property_id,account_id,period_month)
 );
 CREATE TABLE IF NOT EXISTS accounting_vendor_payments (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), work_order_id TEXT NOT NULL UNIQUE REFERENCES work_orders(id),
  reference TEXT NOT NULL, paid_date TEXT NOT NULL, amount_minor INTEGER NOT NULL, journal_id TEXT NOT NULL REFERENCES journal_batches(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE(organization_id,reference)
 );
 CREATE TABLE IF NOT EXISTS report_schedules (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), user_id TEXT NOT NULL REFERENCES users(id),
  frequency TEXT NOT NULL, next_due_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL
 );
 CREATE TABLE IF NOT EXISTS report_deliveries (
  id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), schedule_id TEXT NOT NULL REFERENCES report_schedules(id),
  due_at TEXT NOT NULL, report_json TEXT NOT NULL, notification_id TEXT NOT NULL REFERENCES notifications(id),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL, UNIQUE(organization_id,schedule_id,due_at)
 );
 CREATE TRIGGER IF NOT EXISTS unit_vacancy_created AFTER INSERT ON units WHEN NEW.status='available'
 BEGIN UPDATE units SET vacant_since=NEW.created_at WHERE id=NEW.id; END;
 CREATE TRIGGER IF NOT EXISTS unit_vacancy_changed AFTER UPDATE OF status ON units WHEN OLD.status<>NEW.status
 BEGIN UPDATE units SET vacant_since=CASE WHEN NEW.status='available' THEN NEW.updated_at ELSE NULL END WHERE id=NEW.id; END;
 `);
  const cols = new Set(
    db
      .prepare("PRAGMA table_info(ledger_entries)")
      .all()
      .map((c) => c.name),
  );
  if (!cols.has("journal_id"))
    db.exec(
      "ALTER TABLE ledger_entries ADD COLUMN journal_id TEXT REFERENCES journal_batches(id)",
    );
  if (!cols.has("line_number"))
    db.exec("ALTER TABLE ledger_entries ADD COLUMN line_number INTEGER");
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_journal_lines ON ledger_entries(organization_id,journal_id,line_number) WHERE journal_id IS NOT NULL;
 CREATE TRIGGER IF NOT EXISTS posted_ledger_no_update BEFORE UPDATE ON ledger_entries WHEN OLD.journal_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Posted ledger entries are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS posted_ledger_no_delete BEFORE DELETE ON ledger_entries WHEN OLD.journal_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'Posted ledger entries are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS posted_journal_no_update BEFORE UPDATE ON journal_batches BEGIN SELECT RAISE(ABORT,'Posted journals are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS posted_journal_no_delete BEFORE DELETE ON journal_batches BEGIN SELECT RAISE(ABORT,'Posted journals are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS posted_allocations_no_update BEFORE UPDATE ON ledger_owner_allocations BEGIN SELECT RAISE(ABORT,'Posted allocations are immutable'); END;
 CREATE TRIGGER IF NOT EXISTS posted_allocations_no_delete BEFORE DELETE ON ledger_owner_allocations BEGIN SELECT RAISE(ABORT,'Posted allocations are immutable'); END;`);
}
export function seedPhase5(db: DatabaseSync) {
  const now = new Date().toISOString();
  for (const org of db
    .prepare(
      "SELECT id FROM organizations WHERE deleted_at IS NULL AND status='active'",
    )
    .all())
    for (const [code, name, type] of DEFAULT_ACCOUNTS)
      db.prepare(
        "INSERT OR IGNORE INTO accounts (id,organization_id,code,name,type,created_at,updated_at,created_by) VALUES (?,?,?,?,?,?,?,'system')",
      ).run(`acc_${org.id}_${code}`, org.id, code, name, type, now, now);
}
