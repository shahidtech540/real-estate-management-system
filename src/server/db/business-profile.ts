import type { DatabaseSync } from "node:sqlite";

/** Stable internal IDs are retained to preserve existing foreign keys/sessions. */
export const COMPANY_ID = "org_pakland";
export const OFFICE_ID = "br_ryk";
export const PROJECTS = [
  ["prop_1", "Fahad Garden Housing Scheme", "فہد گارڈن ہاؤسنگ اسکیم"],
  ["prop_2", "Abdullah City", "عبداللہ سٹی"],
  ["prop_3", "Taj Commercial Center", "تاج کمرشل سینٹر"],
  ["prop_4", "VIP Block", "وی آئی پی بلاک"],
  ["prop_5", "University Commercial Centers", "یونیورسٹی کمرشل سینٹرز"],
] as const;

/** One-time, non-destructive correction of the original synthetic business setup. */
export function applyBusinessProfile(db: DatabaseSync) {
  db.exec("BEGIN IMMEDIATE");
  try {
    if (
      db
        .prepare(
          "SELECT name FROM feature_migrations WHERE name='fahad-ryk-profile-v1'",
        )
        .get()
    ) {
      db.exec("COMMIT");
      return;
    }
    const now = new Date().toISOString();
    db.prepare(
      `UPDATE organizations SET slug='fahad-real-estate',name='Fahad Real Estate',legal_name='Fahad Real Estate',tax_number=NULL,updated_at=? WHERE id=?`,
    ).run(now, COMPANY_ID);
    db.prepare(
      `INSERT INTO branches (id,organization_id,code,name,city,address,phone,is_headquarters,created_at,updated_at,created_by)
      VALUES (?,?,'RYK','Fahad Real Estate — Rahim Yar Khan Office','Rahim Yar Khan','Rahim Yar Khan, Punjab, Pakistan',NULL,1,?,?,'usr_admin')`,
    ).run(OFFICE_ID, COMPANY_ID, now, now);
    // Move live branch references before retiring the other office records.
    for (const table of ["users", "properties", "leads"])
      db.prepare(
        `UPDATE ${table} SET branch_id=?,updated_at=? WHERE organization_id=?`,
      ).run(OFFICE_ID, now, COMPANY_ID);
    db.prepare(
      "UPDATE branches SET deleted_at=?,updated_at=? WHERE organization_id=? AND id<>?",
    ).run(now, now, COMPANY_ID, OFFICE_ID);
    for (const [id, name] of PROJECTS)
      db.prepare(
        "UPDATE properties SET name=?,branch_id=?,city='Rahim Yar Khan',address='Rahim Yar Khan, Punjab, Pakistan',latitude=NULL,longitude=NULL,updated_at=? WHERE organization_id=? AND id=?",
      ).run(name, OFFICE_ID, now, COMPANY_ID, id);

    // Consolidate invented demo sub-projects, retaining all units and business records.
    // Existing paid statements / ledger history / audit entries remain immutable.
    for (const [oldId, newId] of [
      ["prop_6", "prop_1"],
      ["prop_7", "prop_2"],
      ["prop_8", "prop_3"],
      ["prop_9", "prop_4"],
      ["prop_10", "prop_5"],
    ]) {
      for (const table of [
        "buildings",
        "units",
        "listings",
        "leases",
        "invoices",
        "maintenance_tickets",
      ])
        db.prepare(
          `UPDATE ${table} SET property_id=?,updated_at=? WHERE organization_id=? AND property_id=?`,
        ).run(newId, now, COMPANY_ID, oldId);
      db.prepare(
        "UPDATE documents SET entity_id=?,updated_at=? WHERE organization_id=? AND entity_type='property' AND entity_id=?",
      ).run(newId, now, COMPANY_ID, oldId);
      db.prepare(
        "UPDATE property_owners SET deleted_at=?,updated_at=? WHERE organization_id=? AND property_id=?",
      ).run(now, now, COMPANY_ID, oldId);
      db.prepare(
        "UPDATE properties SET deleted_at=?,status='archived',latitude=NULL,longitude=NULL,updated_at=? WHERE organization_id=? AND id=?",
      ).run(now, now, COMPANY_ID, oldId);
    }
    for (const [id, name] of PROJECTS) {
      db.prepare(
        "UPDATE properties SET total_units=(SELECT COUNT(*) FROM units WHERE property_id=? AND organization_id=? AND deleted_at IS NULL) WHERE id=? AND organization_id=?",
      ).run(id, COMPANY_ID, id, COMPANY_ID);
      db.prepare(
        "UPDATE buildings SET name=?,updated_at=? WHERE organization_id=? AND property_id=? AND id LIKE 'bldg_prop_%'",
      ).run(`${name} — Demo block`, now, COMPANY_ID, id);
    }
    // Seed listings originally had mismatched property/unit references; the unit is authoritative.
    for (let i = 1; i <= 8; i++) {
      const listing = db
        .prepare(
          "SELECT l.id,u.property_id,u.unit_number FROM listings l JOIN units u ON u.id=l.unit_id AND u.organization_id=l.organization_id WHERE l.id=? AND l.organization_id=?",
        )
        .get(`lst_${i}`, COMPANY_ID);
      if (!listing) continue;
      const project = PROJECTS.find((p) => p[0] === listing.property_id);
      if (!project) continue;
      db.prepare(
        `UPDATE listings SET property_id=?,slug=?,title_en=?,title_ur=?,description_en=?,description_ur=?,updated_at=? WHERE id=? AND organization_id=?`,
      ).run(
        project[0],
        `fahad-real-estate-sample-${i}-rahim-yar-khan`,
        `${project[1]} — Sample unit ${listing.unit_number}`,
        `${project[2]} — نمونہ یونٹ`,
        `Demo inventory for ${project[1]}, Rahim Yar Khan. Price, availability, dimensions and facilities are sample data; confirm details with Fahad Real Estate. No planning approval or exact site address has been verified.`,
        `${project[2]}، رحیم یار خان۔ یہ نمونہ معلومات ہیں۔ قیمت، دستیابی اور تفصیلات کی تصدیق فہد رئیل اسٹیٹ سے کریں۔`,
        now,
        `lst_${i}`,
        COMPANY_ID,
      );
    }
    for (let i = 1; i <= 6; i++)
      db.prepare(
        "UPDATE leads SET requirements_text='Demo property enquiry in Rahim Yar Khan. Confirm requirements with the customer.',updated_at=? WHERE id=? AND organization_id=?",
      ).run(now, `lead_${i}`, COMPANY_ID);
    for (const table of ["owners", "tenants"])
      db.prepare(
        `UPDATE ${table} SET email=REPLACE(email,'@pakland.pk','@fahadrealestate.test') WHERE organization_id=? AND email LIKE '%@pakland.pk'`,
      ).run(COMPANY_ID);
    // Remove fabricated legal approvals only from the six known seeded vault entries.
    for (let i = 1; i <= 6; i++)
      db.prepare(
        `UPDATE documents SET title=?,category='other',tags_json='["demo","unverified"]',content_text=?,expiry_date=NULL,updated_at=? WHERE id=? AND organization_id=?`,
      ).run(
        `Sample document ${i} — verification required`,
        "Demonstration record only. No NOC, title, insurance, tax or identity verification is asserted. Replace with an authentic document supplied by Fahad Real Estate.",
        now,
        `doc_${i}`,
        COMPANY_ID,
      );
    const names: Record<string, string> = {
      admin: "Demo Administrator",
      agent: "Demo Sales Agent",
      accountant: "Demo Accountant",
      maintenance: "Demo Maintenance Coordinator",
      owner: "Demo Owner",
      tenant: "Demo Tenant",
    };
    for (const [role, id] of Object.entries({
      admin: "usr_admin",
      agent: "usr_agent",
      accountant: "usr_accountant",
      maintenance: "usr_maintenance",
      owner: "usr_owner",
      tenant: "usr_tenant",
    }))
      db.prepare(
        "UPDATE users SET email=?,full_name=?,branch_id=?,updated_at=? WHERE id=? AND organization_id=?",
      ).run(
        `${role}@fahadrealestate.test`,
        names[role],
        OFFICE_ID,
        now,
        id,
        COMPANY_ID,
      );
    db.prepare(
      "UPDATE vendors SET name='Demo Plumbing Services — Rahim Yar Khan',updated_at=? WHERE id='ven_plumber' AND organization_id=?",
    ).run(now, COMPANY_ID);
    // Suspend, rather than erase, the unrelated seeded company and its historical records.
    db.prepare(
      "UPDATE organizations SET status='inactive',deleted_at=?,updated_at=? WHERE id='org_indus'",
    ).run(now, now);
    for (const table of ["users", "branches", "properties"])
      db.prepare(
        `UPDATE ${table} SET deleted_at=?,updated_at=? WHERE organization_id='org_indus'`,
      ).run(now, now);
    db.prepare(
      "UPDATE users SET status='suspended' WHERE organization_id='org_indus'",
    ).run();
    db.prepare(
      "UPDATE refresh_tokens SET revoked_at=? WHERE organization_id='org_indus' AND revoked_at IS NULL",
    ).run(now);
    db.prepare(
      "INSERT INTO feature_migrations VALUES ('fahad-ryk-profile-v1',?)",
    ).run(now);
    db.prepare(
      "INSERT INTO audit_logs (id,organization_id,actor_user_id,action,entity_type,entity_id,metadata_json,created_at,updated_at,created_by) VALUES ('aud_fahad_ryk_profile',?,'usr_admin','business.profile_corrected','organization',?,'{\"reason\":\"User confirmed Fahad Real Estate, Rahim Yar Khan only\",\"preserved\":\"units, leases, invoices, payments and immutable history\"}',?,?,'usr_admin')",
    ).run(COMPANY_ID, COMPANY_ID, now, now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}
