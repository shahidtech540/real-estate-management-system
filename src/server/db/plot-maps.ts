import type { DatabaseSync } from "node:sqlite";
/** Additive only. Existing units, leases and accounting records are untouched. */
export function migratePlotMaps(db: DatabaseSync) {
  db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS map_property_org_identity ON properties(organization_id,id);
  CREATE UNIQUE INDEX IF NOT EXISTS map_user_org_identity ON users(organization_id,id);
  CREATE UNIQUE INDEX IF NOT EXISTS map_client_org_identity ON clients(organization_id,id);
  CREATE UNIQUE INDEX IF NOT EXISTS map_lead_org_identity ON leads(organization_id,id);
  CREATE UNIQUE INDEX IF NOT EXISTS map_owner_org_identity ON owners(organization_id,id);
  CREATE TABLE IF NOT EXISTS plot_map_settings (
    organization_id TEXT NOT NULL REFERENCES organizations(id), project_id TEXT NOT NULL REFERENCES properties(id),
    plot_number_pattern TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY(organization_id,project_id), FOREIGN KEY(organization_id,project_id) REFERENCES properties(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
  );
  CREATE TABLE IF NOT EXISTS project_maps (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), project_id TEXT NOT NULL REFERENCES properties(id),
    version INTEGER NOT NULL CHECK(version>0), original_svg_path TEXT NOT NULL, sanitized_svg_path TEXT NOT NULL,
    view_box TEXT NOT NULL, scale_config TEXT, status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','archived')),
    detection_config TEXT NOT NULL, report_json TEXT NOT NULL, diff_json TEXT NOT NULL, source_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    FOREIGN KEY(organization_id,project_id) REFERENCES properties(organization_id,id), FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id),
    UNIQUE(organization_id,project_id,version), UNIQUE(organization_id,project_id,id), UNIQUE(organization_id,id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_published_project_map ON project_maps(organization_id,project_id) WHERE status='published';
  CREATE TABLE IF NOT EXISTS project_map_assets (
    organization_id TEXT NOT NULL, map_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN ('original','sanitized')),
    content BLOB NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    PRIMARY KEY(organization_id,map_id,kind), FOREIGN KEY(organization_id,map_id) REFERENCES project_maps(organization_id,id)
  );
  CREATE TABLE IF NOT EXISTS plots (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id), project_id TEXT NOT NULL REFERENCES properties(id), map_id TEXT NOT NULL,
    plot_number TEXT NOT NULL, block TEXT, phase TEXT, street TEXT, area_official REAL, dimensions_official TEXT,
    facing TEXT, is_corner INTEGER, category TEXT CHECK(category IN ('residential','commercial')),
    price_per_unit_minor INTEGER CHECK(price_per_unit_minor IS NULL OR (typeof(price_per_unit_minor)='integer' AND price_per_unit_minor>=0 AND price_per_unit_minor<=1000000000000)),
    total_price_minor INTEGER CHECK(total_price_minor IS NULL OR (typeof(total_price_minor)='integer' AND total_price_minor>=0 AND total_price_minor<=1000000000000)), currency TEXT NOT NULL DEFAULT 'PKR',
    status TEXT NOT NULL DEFAULT 'available' CHECK(status IN ('available','reserved','booked','sold','resale','blocked')),
    status_changed_at TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id), deleted_at TEXT,
    UNIQUE(project_id,plot_number), UNIQUE(organization_id,id), UNIQUE(organization_id,project_id,id),
    FOREIGN KEY(organization_id,project_id,map_id) REFERENCES project_maps(organization_id,project_id,id)
  );
  CREATE TABLE IF NOT EXISTS map_plot_geometries (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, project_id TEXT NOT NULL, map_id TEXT NOT NULL, plot_id TEXT,
    plot_number TEXT NOT NULL, svg_element_id TEXT NOT NULL, detection_method TEXT NOT NULL, confidence REAL NOT NULL,
    polygon_points TEXT NOT NULL, centroid TEXT NOT NULL, bounding_box TEXT NOT NULL, area_svg REAL NOT NULL CHECK(area_svg>0),
    area_calculated REAL, dimensions_calculated TEXT, geometry_hash TEXT NOT NULL,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    UNIQUE(organization_id,map_id,svg_element_id),
    FOREIGN KEY(organization_id,project_id,map_id) REFERENCES project_maps(organization_id,project_id,id),
    FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id), FOREIGN KEY(organization_id,project_id,plot_id) REFERENCES plots(organization_id,project_id,id)
  );
  CREATE INDEX IF NOT EXISTS map_geometry_page ON map_plot_geometries(organization_id,map_id,plot_number,id);
  CREATE TABLE IF NOT EXISTS plot_bookings (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plot_id TEXT NOT NULL, client_id TEXT REFERENCES clients(id), lead_id TEXT REFERENCES leads(id),
    agent_id TEXT REFERENCES users(id), token_amount_minor INTEGER NOT NULL DEFAULT 0 CHECK(typeof(token_amount_minor)='integer' AND token_amount_minor>=0 AND token_amount_minor<=1000000000000),
    currency TEXT NOT NULL DEFAULT 'PKR', payment_plan TEXT NOT NULL DEFAULT '{}', booking_date TEXT NOT NULL, expiry_date TEXT, closed_at TEXT,
    status TEXT NOT NULL CHECK(status IN ('pending','confirmed','cancelled','expired')), notes TEXT,
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id), FOREIGN KEY(organization_id,plot_id) REFERENCES plots(organization_id,id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_plot_booking ON plot_bookings(organization_id,plot_id) WHERE status IN ('pending','confirmed') AND closed_at IS NULL;
  CREATE TABLE IF NOT EXISTS plot_sales (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plot_id TEXT NOT NULL, buyer_id TEXT NOT NULL REFERENCES clients(id),
    sale_price_minor INTEGER NOT NULL CHECK(typeof(sale_price_minor)='integer' AND sale_price_minor>=0 AND sale_price_minor<=1000000000000), sale_date TEXT NOT NULL,
    currency TEXT NOT NULL DEFAULT 'PKR', payment_status TEXT NOT NULL, documents TEXT NOT NULL DEFAULT '[]', current_owner INTEGER NOT NULL CHECK(current_owner IN (0,1)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id), FOREIGN KEY(organization_id,plot_id) REFERENCES plots(organization_id,id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_current_plot_sale ON plot_sales(organization_id,plot_id) WHERE current_owner=1;
  CREATE TABLE IF NOT EXISTS plot_ownership_history (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plot_id TEXT NOT NULL, owner_id TEXT NOT NULL REFERENCES owners(id),
    from_date TEXT NOT NULL, to_date TEXT, transfer_type TEXT NOT NULL CHECK(transfer_type IN ('sale','resale','inheritance')),
    currency TEXT NOT NULL DEFAULT 'PKR', price_minor INTEGER CHECK(price_minor IS NULL OR (typeof(price_minor)='integer' AND price_minor>=0 AND price_minor<=1000000000000)),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id), FOREIGN KEY(organization_id,plot_id) REFERENCES plots(organization_id,id)
  );
  CREATE TABLE IF NOT EXISTS resale_listings (
    id TEXT PRIMARY KEY, organization_id TEXT NOT NULL, plot_id TEXT NOT NULL, seller_id TEXT NOT NULL REFERENCES owners(id),
    currency TEXT NOT NULL DEFAULT 'PKR', asking_price_minor INTEGER NOT NULL CHECK(typeof(asking_price_minor)='integer' AND asking_price_minor>=0 AND asking_price_minor<=1000000000000), listed_date TEXT NOT NULL,
    status TEXT NOT NULL CHECK(status IN ('active','sold','withdrawn')), notes TEXT, agent_id TEXT REFERENCES users(id),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL REFERENCES users(id),
    FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id), FOREIGN KEY(organization_id,plot_id) REFERENCES plots(organization_id,id)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_active_plot_resale ON resale_listings(organization_id,plot_id) WHERE status='active';
  CREATE INDEX IF NOT EXISTS plot_status_project ON plots(organization_id,project_id,status);
  CREATE TRIGGER IF NOT EXISTS plot_status_audit AFTER UPDATE OF status ON plots WHEN OLD.status!=NEW.status BEGIN
    INSERT INTO audit_logs(id,organization_id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at,updated_at,created_by)
    VALUES('aud_plot_'||lower(hex(randomblob(16))),NEW.organization_id,NULL,'plot.status.changed','plot',NEW.id,
      json_object('from',OLD.status,'to',NEW.status,'source','database trigger'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.created_by);
  END;
  `);
  for (const [table, column] of [
    ["project_maps", "status"],
    ["plot_bookings", "status"],
    ["resale_listings", "status"],
    ["plot_sales", "payment_status"],
  ])
    db.exec(
      `CREATE TRIGGER IF NOT EXISTS ${table}_${column}_audit AFTER UPDATE OF ${column} ON ${table} WHEN OLD.${column}!=NEW.${column} BEGIN INSERT INTO audit_logs(id,organization_id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at,updated_at,created_by) VALUES('aud_map_'||lower(hex(randomblob(16))),NEW.organization_id,NULL,'${table}.${column}.changed','${table}',NEW.id,json_object('from',OLD.${column},'to',NEW.${column},'source','database trigger'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.created_by); END;`,
    );
  // Phase B: additive columns also upgrade databases created during Phase A.
  for (const [table, definitions] of Object.entries({
    plots: ["area_unit TEXT"],
    project_maps: ["revision INTEGER NOT NULL DEFAULT 0", "published_at TEXT"],
    map_plot_geometries: [
      "excluded INTEGER NOT NULL DEFAULT 0 CHECK(excluded IN (0,1))",
      "review_json TEXT NOT NULL DEFAULT '{}'",
      "fill_rule TEXT",
    ],
  }))
    for (const definition of definitions) {
      const name = definition.split(" ")[0];
      if (
        !db
          .prepare(`PRAGMA table_info(${table})`)
          .all()
          .some((c) => c.name === name)
      )
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${definition}`);
    }
  db.exec(`CREATE TABLE IF NOT EXISTS plot_area_settings (
    organization_id TEXT PRIMARY KEY REFERENCES organizations(id),
    area_unit TEXT NOT NULL DEFAULT 'marla' CHECK(area_unit IN ('sqft','sqm','marla','kanal')),
    marla_sqft REAL NOT NULL DEFAULT 272.25 CHECK(marla_sqft>0 AND marla_sqft<=10000),
    created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
    FOREIGN KEY(organization_id,created_by) REFERENCES users(organization_id,id)
  );`);
  if (
    !db
      .prepare("PRAGMA table_info(plot_area_settings)")
      .all()
      .some((c) => c.name === "created_at")
  )
    db.exec("ALTER TABLE plot_area_settings ADD COLUMN created_at TEXT");
  db.exec(
    "UPDATE plot_area_settings SET created_at=updated_at WHERE created_at IS NULL",
  );
  const references: Record<string, Record<string, string>> = {
    plot_bookings: {
      client_id: "clients",
      lead_id: "leads",
      agent_id: "users",
    },
    plot_sales: { buyer_id: "clients" },
    plot_ownership_history: { owner_id: "owners" },
    resale_listings: { seller_id: "owners", agent_id: "users" },
  };
  for (const [table, columns] of Object.entries(references))
    for (const [column, parent] of Object.entries(columns))
      for (const operation of ["INSERT", "UPDATE"])
        db.exec(
          `CREATE TRIGGER IF NOT EXISTS ${table}_${column}_${operation.toLowerCase()} BEFORE ${operation} ON ${table} WHEN NEW.${column} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ${parent} WHERE id=NEW.${column} AND organization_id=NEW.organization_id) BEGIN SELECT RAISE(ABORT,'Cross-organization plot reference'); END;`,
        );
}
