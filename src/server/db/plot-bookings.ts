import type { DatabaseSync } from "node:sqlite";
/** D is strictly additive; legacy rental invoices/leases and all balances remain untouched. */
export function migratePlotBookings(db: DatabaseSync) {
  for (const [table, definitions] of Object.entries({
    clients: ["address TEXT"],
    plot_bookings: [
      "request_key TEXT",
      "input_hash TEXT",
      "booking_type TEXT CHECK(booking_type IS NULL OR booking_type IN ('reserve','book'))",
      "revision INTEGER NOT NULL DEFAULT 0 CHECK(typeof(revision)='integer' AND revision>=0)",
      "price_minor INTEGER CHECK(price_minor IS NULL OR (typeof(price_minor)='integer' AND price_minor>0 AND price_minor<=1000000000000))",
      "map_version_id TEXT",
    ],
  }))
    for (const definition of definitions) {
      if (
        !db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((c) => c.name === definition.split(" ")[0])
      )
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  db.exec(`
 CREATE UNIQUE INDEX IF NOT EXISTS plot_booking_org_identity ON plot_bookings(organization_id,id);
 CREATE UNIQUE INDEX IF NOT EXISTS document_org_identity ON documents(organization_id,id);
 CREATE UNIQUE INDEX IF NOT EXISTS plot_booking_request ON plot_bookings(organization_id,created_by,request_key) WHERE request_key IS NOT NULL;
 CREATE TABLE IF NOT EXISTS plot_token_invoices (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, booking_id TEXT NOT NULL, invoice_number TEXT NOT NULL,
 amount_minor INTEGER NOT NULL CHECK(typeof(amount_minor)='integer' AND amount_minor>=0 AND amount_minor<=1000000000000),
 currency TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','not_due','cancelled')),
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
 UNIQUE(organization_id,booking_id), UNIQUE(organization_id,invoice_number),
 FOREIGN KEY(organization_id,booking_id) REFERENCES plot_bookings(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id));
 CREATE TABLE IF NOT EXISTS plot_booking_files (
 organization_id TEXT NOT NULL, booking_id TEXT NOT NULL, document_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('confirmation','invoice','id_copy','payment_receipt')), content BLOB NOT NULL,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
 PRIMARY KEY(organization_id,document_id), FOREIGN KEY(organization_id,booking_id) REFERENCES plot_bookings(organization_id,id),
 FOREIGN KEY(organization_id,document_id) REFERENCES documents(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id));
 CREATE TRIGGER IF NOT EXISTS plot_token_invoice_status_audit AFTER UPDATE OF status ON plot_token_invoices WHEN OLD.status!=NEW.status BEGIN INSERT INTO audit_logs(id,organization_id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at,updated_at,created_by) VALUES('aud_pinv_'||lower(hex(randomblob(16))),NEW.organization_id,NULL,'plot_token_invoices.status.changed','plot_invoice',NEW.id,json_object('from',OLD.status,'to',NEW.status),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.created_by); END;
 CREATE INDEX IF NOT EXISTS plot_booking_files_booking ON plot_booking_files(organization_id,booking_id);
 `);
}
