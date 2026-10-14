import type { DatabaseSync } from "node:sqlite";

/** Idempotent additive migration; also supports databases created before Phase 4. */
export function migratePhase4(db: DatabaseSync) {
  const additions: Record<string, Record<string, string>> = {
    vendors: { available: "INTEGER NOT NULL DEFAULT 1" },
    maintenance_tickets: {
      confirmed_at: "TEXT",
      resolution_notes: "TEXT",
      rating: "INTEGER",
    },
    work_orders: { completion_notes: "TEXT" },
    notifications: {
      event_key: "TEXT",
      attempt_count: "INTEGER NOT NULL DEFAULT 0",
      next_attempt_at: "TEXT",
      last_error: "TEXT",
      read_at: "TEXT",
      provider_id: "TEXT",
      locked_at: "TEXT",
    },
  };
  for (const [table, columns] of Object.entries(additions)) {
    const existing = new Set(
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name),
    );
    for (const [column, ddl] of Object.entries(columns))
      if (!existing.has(column))
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${ddl}`);
  }
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_notification_event ON notifications(organization_id, event_key) WHERE event_key IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_notification_queue ON notifications(organization_id, status, next_attempt_at);
    CREATE TABLE IF NOT EXISTS maintenance_events (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id), type TEXT NOT NULL,
      note TEXT NOT NULL, sequence INTEGER NOT NULL, event_key TEXT, created_at TEXT NOT NULL, created_by TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_events ON maintenance_events(organization_id, ticket_id, sequence);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_maintenance_event_key ON maintenance_events(organization_id,event_key) WHERE event_key IS NOT NULL;
    CREATE TABLE IF NOT EXISTS vendor_reviews (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      vendor_id TEXT NOT NULL REFERENCES vendors(id), ticket_id TEXT NOT NULL UNIQUE REFERENCES maintenance_tickets(id),
      rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), note TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS preventive_schedules (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      unit_id TEXT NOT NULL REFERENCES units(id), title TEXT NOT NULL, category TEXT NOT NULL,
      interval_days INTEGER NOT NULL, next_due_at TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL, deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_preventive_due ON preventive_schedules(organization_id, active, next_due_at);
    CREATE TABLE IF NOT EXISTS preventive_runs (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      schedule_id TEXT NOT NULL REFERENCES preventive_schedules(id), due_at TEXT NOT NULL,
      ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id), created_at TEXT NOT NULL, created_by TEXT NOT NULL,
      UNIQUE(organization_id, schedule_id, due_at)
    );
    CREATE TABLE IF NOT EXISTS notification_templates (
      id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
      event TEXT NOT NULL, locale TEXT NOT NULL, subject TEXT NOT NULL, body TEXT NOT NULL,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
      UNIQUE(organization_id, event, locale)
    );
    CREATE TABLE IF NOT EXISTS feature_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
  `);
}

export function seedPhase4(db: DatabaseSync) {
  if (
    db
      .prepare("SELECT name FROM feature_migrations WHERE name = 'phase4-demo'")
      .get()
  )
    return;
  const now = new Date().toISOString();
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const [id, name, category, rate] of [
      ["ven_plumber", "Fahad Real Estate Plumbing Services", "plumbing", 250000],
      ["ven_electric", "Safe Circuit Electricians", "electrical", 300000],
      ["ven_hvac", "Punjab HVAC Care", "hvac", 500000],
    ] as const)
      db.prepare(
        `INSERT OR IGNORE INTO vendors
      (id, organization_id, name, trade_category, phone, rating, base_rate_minor, created_at, updated_at, created_by)
      VALUES (?, 'org_pakland', ?, ?, '+923001234567', 0, ?, ?, ?, 'usr_admin')`,
      ).run(id, name, category, rate, now, now);
    db.prepare(
      `INSERT OR IGNORE INTO maintenance_tickets
      (id,organization_id,property_id,unit_id,tenant_id,ticket_number,title,description,category,priority,status,sla_due_at,created_at,updated_at,created_by)
      SELECT 'mt_demo','org_pakland',u.property_id,u.id,'ten_1','MT-DEMO-001','Kitchen tap leaking',
      'Water is dripping beneath the kitchen sink. Please inspect the pipe joint.','plumbing','medium','open',?,?,?,'usr_tenant'
      FROM units u WHERE u.id = 'unit_1'`,
    ).run(new Date(Date.now() + 24 * 3600000).toISOString(), now, now);
    db.prepare(
      `INSERT OR IGNORE INTO preventive_schedules
      (id,organization_id,unit_id,title,category,interval_days,next_due_at,created_at,updated_at,created_by)
      VALUES ('ps_demo','org_pakland','unit_1','Quarterly HVAC inspection','hvac',90,?,?,?,'usr_admin')`,
    ).run(new Date(Date.now() + 30 * 86400000).toISOString(), now, now);
    db.prepare("INSERT INTO feature_migrations VALUES ('phase4-demo', ?)").run(
      now,
    );
    db.exec("COMMIT");
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}
