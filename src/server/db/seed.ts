import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "../auth/crypto";
import { PERMISSION_CATALOG, ROLE_DEFINITIONS } from "../auth/rbac-catalog";

export const DEMO_PASSWORD = "Password123!";

export function seedDatabase(db: DatabaseSync): void {
  const existingOrg = db
    .prepare("SELECT id FROM organizations WHERE id = ?")
    .get("org_pakland") as { id: string } | undefined;

  if (existingOrg) {
    return; // Already seeded
  }

  const now = "2026-10-14T08:00:00.000Z";
  const passwordHash = hashPassword(DEMO_PASSWORD, "pakland_static_salt_2026");

  db.exec("BEGIN TRANSACTION;");
  try {
    // 1. Organizations
    const insertOrg = db.prepare(`
      INSERT INTO organizations (
        id, slug, name, legal_name, country, default_currency, default_locale, tax_number, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
    `);

    insertOrg.run(
      "org_pakland",
      "pakland-developers",
      "PakLand Developers & Builders",
      "PakLand Real Estate, Town & Commercial Center Developers (Pvt) Ltd",
      "PK",
      "PKR",
      "en",
      "NTN-4829103-7",
      now,
      now
    );

    insertOrg.run(
      "org_indus",
      "indus-valley-estates",
      "Indus Valley Estates",
      "Indus Valley Housing & Commercial Enterprises (Pvt) Ltd",
      "PK",
      "PKR",
      "en",
      "NTN-9182736-4",
      now,
      now
    );

    // 2. Branches
    const insertBranch = db.prepare(`
      INSERT INTO branches (
        id, organization_id, code, name, city, address, phone, is_headquarters, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insertBranch.run(
      "br_isb",
      "org_pakland",
      "ISB-HQ",
      "Islamabad Head Office",
      "Islamabad",
      "Plot 44, Jinnah Avenue, Blue Area, Islamabad",
      "+92-51-2800100",
      1,
      now,
      now
    );
    insertBranch.run(
      "br_rwp",
      "org_pakland",
      "RWP-01",
      "Rawalpindi Regional Office",
      "Rawalpindi",
      "Civic Center, Phase 4, GT Road Corridor, Rawalpindi",
      "+92-51-5700200",
      0,
      now,
      now
    );
    insertBranch.run(
      "br_lhr",
      "org_pakland",
      "LHR-01",
      "Lahore Gulberg Branch",
      "Lahore",
      "88 Main Boulevard, Gulberg III, Lahore",
      "+92-42-35700300",
      0,
      now,
      now
    );
    insertBranch.run(
      "br_indus_khi",
      "org_indus",
      "KHI-HQ",
      "Karachi Clifton HQ",
      "Karachi",
      "Block 5, Clifton, Karachi",
      "+92-21-35800400",
      1,
      now,
      now
    );

    // 3. Permissions & Roles for both organizations
    const insertPerm = db.prepare(`
      INSERT INTO permissions (id, organization_id, code, module, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertRole = db.prepare(`
      INSERT INTO roles (id, organization_id, slug, name, description, is_system, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    const insertRolePerm = db.prepare(`
      INSERT INTO role_permissions (id, organization_id, role_id, permission_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    for (const orgId of ["org_pakland", "org_indus"]) {
      const permIdByCode = new Map<string, string>();
      for (const perm of PERMISSION_CATALOG) {
        const permId = `perm_${orgId}_${perm.code.replace(":", "_")}`;
        permIdByCode.set(perm.code, permId);
        insertPerm.run(permId, orgId, perm.code, perm.module, perm.description, now, now);
      }

      for (const roleDef of ROLE_DEFINITIONS) {
        const roleId = `role_${orgId}_${roleDef.slug}`;
        insertRole.run(roleId, orgId, roleDef.slug, roleDef.name, roleDef.description, now, now);
        for (const code of roleDef.permissions) {
          const permId = permIdByCode.get(code);
          if (permId) {
            insertRolePerm.run(
              `rp_${orgId}_${roleDef.slug}_${code.replace(":", "_")}`,
              orgId,
              roleId,
              permId,
              now,
              now
            );
          }
        }
      }
    }

    // 4. Users across all 6 roles in org_pakland + 1 Admin in org_indus
    const insertUser = db.prepare(`
      INSERT INTO users (
        id, organization_id, branch_id, role_id, email, password_hash, full_name, phone, locale,
        two_factor_enabled, two_factor_secret, status, last_login_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
    `);

    const paklandUsers = [
      {
        id: "usr_admin",
        branchId: "br_isb",
        roleSlug: "admin",
        email: "admin@pakland.pk",
        fullName: "Tariq Mahmood (COO)",
        phone: "+92-300-8500001",
        locale: "en",
      },
      {
        id: "usr_agent",
        branchId: "br_isb",
        roleSlug: "agent",
        email: "agent@pakland.pk",
        fullName: "Bilal Ahmed (Senior Sales Agent)",
        phone: "+92-300-8500002",
        locale: "en",
      },
      {
        id: "usr_accountant",
        branchId: "br_isb",
        roleSlug: "accountant",
        email: "accountant@pakland.pk",
        fullName: "Ayesha Siddiqui (Chief Accountant)",
        phone: "+92-300-8500003",
        locale: "en",
      },
      {
        id: "usr_maintenance",
        branchId: "br_rwp",
        roleSlug: "maintenance_staff",
        email: "maintenance@pakland.pk",
        fullName: "Kamran Raza (Facilities Supervisor)",
        phone: "+92-300-8500004",
        locale: "en",
      },
      {
        id: "usr_owner",
        branchId: "br_isb",
        roleSlug: "owner",
        email: "owner@pakland.pk",
        fullName: "Malik Fahad Nawaz (Project Owner)",
        phone: "+92-300-8500005",
        locale: "en",
      },
      {
        id: "usr_tenant",
        branchId: "br_rwp",
        roleSlug: "tenant",
        email: "tenant@pakland.pk",
        fullName: "Usman Ghani (Tenant)",
        phone: "+92-300-8500006",
        locale: "ur",
      },
    ];

    for (const u of paklandUsers) {
      insertUser.run(
        u.id,
        "org_pakland",
        u.branchId,
        `role_org_pakland_${u.roleSlug}`,
        u.email,
        passwordHash,
        u.fullName,
        u.phone,
        u.locale,
        0,
        null,
        now,
        now,
        now
      );
    }

    // Secondary organization user for multi-tenancy isolation tests
    insertUser.run(
      "usr_indus_admin",
      "org_indus",
      "br_indus_khi",
      "role_org_indus_admin",
      "admin@indusvalley.pk",
      passwordHash,
      "Zafar Iqbal (Indus Admin)",
      "+92-321-9000001",
      "en",
      0,
      null,
      now,
      now,
      now
    );

    // 5. Three Owners (Section 7 Rule 5: 3 owners)
    const insertOwner = db.prepare(`
      INSERT INTO owners (
        id, organization_id, user_id, full_name, cnic_ntn, email, phone, bank_name, iban, management_fee_pct, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr_admin')
    `);

    insertOwner.run(
      "own_1",
      "usr_owner",
      "Malik Fahad Nawaz",
      "37405-1122334-1",
      "owner@pakland.pk",
      "+92-300-8500005",
      "Meezan Bank Limited",
      "PK36MEZN0001020304050607",
      5.0,
      now,
      now
    );
    insertOwner.run(
      "own_2",
      null,
      "Chaudhry Abdullah Khan",
      "61101-8877665-3",
      "abdullah.khan@pakland.pk",
      "+92-300-8500008",
      "Habib Bank Limited (HBL)",
      "PK88HABB0009080706050403",
      6.0,
      now,
      now
    );
    insertOwner.run(
      "own_3",
      null,
      "Begum Samina Taj",
      "35202-4455667-2",
      "samina.taj@pakland.pk",
      "+92-300-8500009",
      "United Bank Limited (UBL)",
      "PK19UNIL0109000234567891",
      5.5,
      now,
      now
    );

    // 6. Ten Properties (5 named flagship projects + 5 sub-projects)
    const propertiesData = [
      {
        id: "prop_1",
        branchId: "br_lhr",
        code: "FGHS-01",
        name: "Fahad Garden Housing Scheme",
        type: "housing_scheme",
        city: "Lahore",
        address: "Main GT Road, Kala Shah Kaku Interchange, Lahore",
        lat: 31.7245,
        lng: 74.2682,
        ownerId: "own_1",
      },
      {
        id: "prop_2",
        branchId: "br_rwp",
        code: "AC-01",
        name: "Abdullah City",
        type: "housing_scheme",
        city: "Rawalpindi",
        address: "Chakri Road, Ring Road Interchange, Rawalpindi/Islamabad",
        lat: 33.5121,
        lng: 72.8934,
        ownerId: "own_2",
      },
      {
        id: "prop_3",
        branchId: "br_rwp",
        code: "TCC-01",
        name: "Taj Commercial Center",
        type: "commercial_center",
        city: "Rawalpindi",
        address: "Main Markaz, Satellite Town Commercial Hub, Rawalpindi",
        lat: 33.6389,
        lng: 73.0712,
        ownerId: "own_3",
      },
      {
        id: "prop_4",
        branchId: "br_isb",
        code: "VIP-01",
        name: "VIP Block",
        type: "residential_complex",
        city: "Islamabad",
        address: "VIP Enclave, Zone IV Park Road, Islamabad",
        lat: 33.6691,
        lng: 73.1518,
        ownerId: "own_1",
      },
      {
        id: "prop_5",
        branchId: "br_isb",
        code: "UCC-01",
        name: "University Commercial Centers",
        type: "commercial_center",
        city: "Islamabad",
        address: "University Road, Sector H-11/I-10 Link, Islamabad",
        lat: 33.6512,
        lng: 73.0189,
        ownerId: "own_2",
      },
      {
        id: "prop_6",
        branchId: "br_lhr",
        code: "FGHS-02",
        name: "Fahad Garden Overseas Block",
        type: "housing_scheme",
        city: "Lahore",
        address: "Sector B, Fahad Garden Housing Scheme, Lahore",
        lat: 31.729,
        lng: 74.271,
        ownerId: "own_1",
      },
      {
        id: "prop_7",
        branchId: "br_rwp",
        code: "AC-02",
        name: "Abdullah City Golf Villas",
        type: "residential_complex",
        city: "Rawalpindi",
        address: "Golf Executive Zone, Abdullah City, Rawalpindi",
        lat: 33.518,
        lng: 72.899,
        ownerId: "own_2",
      },
      {
        id: "prop_8",
        branchId: "br_rwp",
        code: "TCC-02",
        name: "Taj Trade Tower & Galleria",
        type: "commercial_center",
        city: "Rawalpindi",
        address: "Adjacent Taj Commercial Center, Murree Road, Rawalpindi",
        lat: 33.641,
        lng: 73.074,
        ownerId: "own_3",
      },
      {
        id: "prop_9",
        branchId: "br_isb",
        code: "VIP-02",
        name: "VIP Block Executive Villas",
        type: "residential_complex",
        city: "Islamabad",
        address: "Street 1-8, VIP Block, Islamabad",
        lat: 33.671,
        lng: 73.154,
        ownerId: "own_1",
      },
      {
        id: "prop_10",
        branchId: "br_isb",
        code: "UCC-02",
        name: "University IT & Corporate Plaza",
        type: "mixed_use",
        city: "Islamabad",
        address: "Block B, University Commercial Centers, Islamabad",
        lat: 33.654,
        lng: 73.021,
        ownerId: "own_3",
      },
    ];

    const insertProp = db.prepare(`
      INSERT INTO properties (
        id, organization_id, branch_id, code, name, type, city, address, latitude, longitude, total_units, status, amenities_json, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, ?, ?, ?, 3, 'active', ?, ?, ?, 'usr_admin')
    `);
    const insertPropOwner = db.prepare(`
      INSERT INTO property_owners (
        id, organization_id, property_id, owner_id, ownership_pct, is_primary, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, ?, 'usr_admin')
    `);
    const insertBuilding = db.prepare(`
      INSERT INTO buildings (
        id, organization_id, property_id, code, name, floors, block_sector, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, ?, ?, 'usr_admin')
    `);

    for (const p of propertiesData) {
      insertProp.run(
        p.id,
        p.branchId,
        p.code,
        p.name,
        p.type,
        p.city,
        p.address,
        p.lat,
        p.lng,
        JSON.stringify(["24/7 Security", "Underground Electricity", "Masjid", "Backup Generator"]),
        now,
        now
      );
      if (p.id === "prop_1") {
        insertPropOwner.run(`po_${p.id}_1`, p.id, "own_1", 70.0, 1, now, now);
        insertPropOwner.run(`po_${p.id}_2`, p.id, "own_2", 30.0, 0, now, now);
      } else if (p.id === "prop_3") {
        insertPropOwner.run(`po_${p.id}_1`, p.id, "own_3", 60.0, 1, now, now);
        insertPropOwner.run(`po_${p.id}_2`, p.id, "own_1", 40.0, 0, now, now);
      } else {
        insertPropOwner.run(`po_${p.id}`, p.id, p.ownerId, 100.0, 1, now, now);
      }
      insertBuilding.run(
        `bldg_${p.id}`,
        p.id,
        `${p.code}-A`,
        `${p.name} - Block A`,
        p.type === "commercial_center" ? 5 : 2,
        "Block A",
        now,
        now
      );
    }

    // Also add 1 property in org_indus to test strict multi-tenant isolation
    db.prepare(
      `INSERT INTO properties (
        id, organization_id, branch_id, code, name, type, city, address, latitude, longitude, total_units, status, amenities_json, created_at, updated_at, created_by
      ) VALUES ('prop_indus_1', 'org_indus', 'br_indus_khi', 'IND-01', 'Indus Clifton Marina Tower', 'commercial_center', 'Karachi', 'Clifton Block 5, Karachi', 24.8138, 67.0303, 5, 'active', '[]', ?, ?, 'usr_indus_admin')`
    ).run(now, now);

    // 7. 30 Units (3 per property across the 10 PakLand properties)
    const insertUnit = db.prepare(`
      INSERT INTO units (
        id, organization_id, property_id, building_id, unit_number, type, area_sqft, area_display,
        bedrooms, bathrooms, status, market_price_minor, monthly_rent_minor, currency, amenities_json, photos_json, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', '["Electricity","Water","Security"]', '[]', ?, ?, 'usr_admin')
    `);

    const unitTypes = ["house", "shop", "plot", "apartment", "office"];
    for (let i = 1; i <= 30; i++) {
      const propIndex = Math.floor((i - 1) / 3);
      const prop = propertiesData[propIndex];
      const uType =
        prop.type === "commercial_center"
          ? i % 2 === 0
            ? "shop"
            : "office"
          : unitTypes[i % unitTypes.length];
      const isRented = i <= 20; // First 20 units rented to our 20 tenants
      const status = isRented ? "rented" : i <= 27 ? "available" : "under_maintenance";
      const rentPkr = 45000 + (i % 8) * 15000; // 45,000 PKR to 150,000 PKR
      const pricePkr = 8500000 + i * 750000;

      insertUnit.run(
        `unit_${i}`,
        prop.id,
        `bldg_${prop.id}`,
        `${prop.code}-U${String(i).padStart(2, "0")}`,
        uType,
        uType === "plot" ? 2250 : uType === "shop" ? 450 : 1800,
        uType === "plot" ? "10 Marla" : uType === "shop" ? "450 Sq.Ft." : "7 Marla",
        uType === "shop" || uType === "plot" ? 0 : 3,
        uType === "shop" || uType === "plot" ? 1 : 3,
        status,
        pricePkr * 100, // in paisa minor units
        rentPkr * 100, // in paisa minor units
        now,
        now
      );
    }

    // 8. 20 Tenants & 20 Active Leases & 12 Months of Invoices (240 invoices)
    const insertTenant = db.prepare(`
      INSERT INTO tenants (
        id, organization_id, user_id, full_name, cnic, phone, email, kyc_status, emergency_contact_name, emergency_contact_phone, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?, 'usr_admin')
    `);
    const insertLease = db.prepare(`
      INSERT INTO leases (
        id, organization_id, property_id, unit_id, tenant_id, lease_number, status, start_date, end_date,
        rent_minor, deposit_minor, escalation_pct, due_day, grace_days, late_fee_minor, currency, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, 'active', '2025-11-01', '2026-12-31', ?, ?, 10.0, 5, 5, 500000, 'PKR', ?, ?, 'usr_admin')
    `);
    const insertInvoice = db.prepare(`
      INSERT INTO invoices (
        id, organization_id, lease_id, property_id, unit_id, tenant_id, invoice_number, type, period_month,
        due_date, amount_minor, late_fee_minor, total_minor, paid_minor, currency, status, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, 'rent', ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, 'usr_accountant')
    `);

    const tenantNames = [
      "Usman Ghani",
      "Hamza Tariq",
      "Zainab Bibi",
      "Farhan Saeed",
      "Nadia Jamil",
      "Salman Qureshi",
      "Rabia Basri",
      "Imran Abbasi",
      "Sana Mir",
      "Faisal Kapadia",
      "Adeel Hashmi",
      "Hمایوں سعید (Humayun Saeed)",
      "Mahira Raza",
      "Atif Aslam Butt",
      "Saba Qamar",
      "Fawad Afzal",
      "Ayeza Khan",
      "Danish Taimoor",
      "Syra Yousuf",
      "Sheheryar Munawar",
    ];

    const months = [
      "2025-11",
      "2025-12",
      "2026-01",
      "2026-02",
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
      "2026-09",
      "2026-10",
    ];

    for (let t = 1; t <= 20; t++) {
      const tenantId = `ten_${t}`;
      const propIndex = Math.floor((t - 1) / 3);
      const prop = propertiesData[propIndex];
      const rentMinor = (45000 + (t % 8) * 15000) * 100;

      insertTenant.run(
        tenantId,
        t === 1 ? "usr_tenant" : null,
        tenantNames[t - 1],
        `35202-10000${String(t).padStart(2, "0")}-1`,
        `+92-301-70000${String(t).padStart(2, "0")}`,
        t === 1 ? "tenant@pakland.pk" : `tenant${t}@example.pk`,
        "Ahmed Ali",
        "+92-300-1112223",
        now,
        now
      );

      const leaseId = `lease_${t}`;
      insertLease.run(
        leaseId,
        prop.id,
        `unit_${t}`,
        tenantId,
        `LSE-2026-${String(t).padStart(3, "0")}`,
        rentMinor,
        rentMinor * 2,
        now,
        now
      );

      // 12 months of invoices per tenant (240 total invoices)
      for (let m = 0; m < months.length; m++) {
        const period = months[m];
        const invId = `inv_${t}_${m + 1}`;
        const isCurrentMonth = m === months.length - 1;
        const isOverdue = isCurrentMonth && t > 16;
        const status = !isCurrentMonth ? "paid" : isOverdue ? "overdue" : "paid";
        const lateFee = isOverdue ? 250000 : 0; // PKR 2,500 in paisa
        const total = rentMinor + lateFee;
        const paid = status === "paid" ? total : 0;

        insertInvoice.run(
          invId,
          leaseId,
          prop.id,
          `unit_${t}`,
          tenantId,
          `INV-${period.replace("-", "")}-${String(t).padStart(3, "0")}`,
          period,
          `${period}-05`,
          rentMinor,
          lateFee,
          total,
          paid,
          status,
          now,
          now
        );
      }
    }

    // 9. Seed 6 AI Agents (Section 4)
    const insertAgent = db.prepare(`
      INSERT INTO agents (
        id, organization_id, slug, name, description, goal, autonomy_level, is_enabled, cost_budget_minor, currency, allowed_tools_json, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, 1, 500000, 'PKR', ?, ?, ?, 'usr_admin')
    `);

    const agentsData = [
      {
        id: "agt_lead",
        slug: "lead-agent",
        name: "Lead Qualification & Matching Agent",
        desc: "Responds to new leads, qualifies budget/timeline, matches units, and proposes viewing slots.",
        goal: "Maximize lead response speed and qualify hot prospects for human sales agents.",
        autonomy: "act_with_approval",
        tools: ["leads.qualify", "units.match", "viewings.propose", "leads.escalate"],
      },
      {
        id: "agt_listing",
        slug: "listing-agent",
        name: "Bilingual Listing & Pricing Agent",
        desc: "Drafts English & Urdu listing copy, recommends comparable pricing, and flags stale listings.",
        goal: "Ensure high-converting bilingual listings across Fahad Garden, Abdullah City, Taj Center, VIP Block & University Centers.",
        autonomy: "act_with_approval",
        tools: ["listings.generate_copy", "listings.suggest_price", "listings.audit_quality"],
      },
      {
        id: "agt_rent",
        slug: "rent-collection-agent",
        name: "Rent Collection & Reconciliation Agent",
        desc: "Dispatches staged rent reminders, reconciles payments, and drafts arrears payment plans.",
        goal: "Reduce 30/60/90+ day arrears while requiring human approval for payment plans or legal notices.",
        autonomy: "act_with_approval",
        tools: ["invoices.send_reminder", "payments.reconcile", "arrears.propose_plan"],
      },
      {
        id: "agt_maintenance",
        slug: "maintenance-triage-agent",
        name: "Maintenance Triage & SLA Dispatch Agent",
        desc: "Classifies ticket urgency, detects emergencies (gas/flooding/electrical), and selects best vendor.",
        goal: "Ensure rapid emergency escalation and SLA-compliant vendor dispatch.",
        autonomy: "act_with_approval",
        tools: ["tickets.classify", "vendors.recommend", "work_orders.draft"],
      },
      {
        id: "agt_lease",
        slug: "lease-lifecycle-agent",
        name: "Lease Renewal & Extraction Agent",
        desc: "Tracks 90/60/30-day renewals, drafts renewal offers, and extracts terms from lease PDFs.",
        goal: "Proactively retain tenants and eliminate manual lease data entry errors.",
        autonomy: "act_with_approval",
        tools: ["leases.draft_renewal", "leases.extract_terms", "leases.move_out_summary"],
      },
      {
        id: "agt_insights",
        slug: "insights-knowledge-agent",
        name: "Portfolio Insights & Semantic Knowledge Agent",
        desc: "Answers natural-language portfolio questions using safe parameterized tools and document citations.",
        goal: "Deliver instant executive intelligence and weekly anomaly summaries.",
        autonomy: "suggest_only",
        tools: ["analytics.query_kpis", "documents.semantic_search", "reports.weekly_summary"],
      },
    ];

    for (const a of agentsData) {
      insertAgent.run(
        a.id,
        a.slug,
        a.name,
        a.desc,
        a.goal,
        a.autonomy,
        JSON.stringify(a.tools),
        now,
        now
      );
    }

    // 9.5 Seed Initial Document Vault Records (Section 3.8)
    const insertDoc = db.prepare(`
      INSERT INTO documents (
        id, organization_id, entity_type, entity_id, title, category, version, storage_key,
        mime_type, size_bytes, tags_json, expiry_date, content_text, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'usr_admin')
    `);

    const seedDocs = [
      {
        id: "doc_1",
        entityType: "property",
        entityId: "prop_1",
        title: "Fahad Garden Housing Scheme — LDA NOC & Town Planning Approval",
        category: "noc_approval",
        version: 2,
        storageKey: "s3://rems-documents/org_pakland/prop_1/fghs-lda-noc-v2.pdf",
        mimeType: "application/pdf",
        sizeBytes: 2458000,
        tags: ["NOC", "LDA", "Fahad Garden", "Town Planning"],
        expiryDate: "2028-12-31",
        contentText:
          "Lahore Development Authority Final NOC for Fahad Garden Housing Scheme (FGHS-01) covering Residential Plots, Commercial Boulevard, Parks, and Underground Electrification.",
      },
      {
        id: "doc_2",
        entityType: "property",
        entityId: "prop_2",
        title: "Abdullah City — RDA Master Layout Plan & Environmental Clearance",
        category: "floor_plan",
        version: 1,
        storageKey: "s3://rems-documents/org_pakland/prop_2/abdullah-city-masterplan.pdf",
        mimeType: "application/pdf",
        sizeBytes: 5120000,
        tags: ["RDA", "Master Plan", "Abdullah City", "Chakri Road"],
        expiryDate: "2029-06-30",
        contentText:
          "Rawalpindi Development Authority Master Layout Plan and EPA Clearance for Abdullah City Executive & Golf Sectors.",
      },
      {
        id: "doc_3",
        entityType: "property",
        entityId: "prop_3",
        title: "Taj Commercial Center — Trade Licence & Civil Defense Fire Safety Certificate",
        category: "trade_licence",
        version: 1,
        storageKey: "s3://rems-documents/org_pakland/prop_3/taj-center-fire-safety.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1280000,
        tags: ["Trade Licence", "Fire Safety", "Taj Commercial Center"],
        expiryDate: "2026-11-10", // Expiring soon (< 30 days from 2026-10-14)
        contentText:
          "Annual Commercial Trade Licence and Fire Fighting Inspection Certificate for Taj Commercial Center (TCC-01), Satellite Town Rawalpindi.",
      },
      {
        id: "doc_4",
        entityType: "property",
        entityId: "prop_4",
        title: "VIP Block — CDA Title Deed & Co-Ownership Registry",
        category: "title_deed",
        version: 1,
        storageKey: "s3://rems-documents/org_pakland/prop_4/vip-block-title-deed.pdf",
        mimeType: "application/pdf",
        sizeBytes: 3140000,
        tags: ["CDA", "Title Deed", "VIP Block", "Islamabad"],
        expiryDate: null,
        contentText:
          "Registered Title Deed and Allotment Registry for VIP Block Residential Enclave, Zone IV Islamabad.",
      },
      {
        id: "doc_5",
        entityType: "property",
        entityId: "prop_5",
        title: "University Commercial Centers — Comprehensive Building & Liability Insurance",
        category: "insurance",
        version: 3,
        storageKey: "s3://rems-documents/org_pakland/prop_5/ucc-insurance-policy-v3.pdf",
        mimeType: "application/pdf",
        sizeBytes: 1890000,
        tags: ["Insurance", "EFU", "University Commercial Centers"],
        expiryDate: "2026-09-30", // Already expired relative to 2026-10-14
        contentText:
          "Comprehensive Commercial Property & Public Liability Insurance Policy for University Commercial Centers (UCC-01), Sector H-11 Islamabad.",
      },
      {
        id: "doc_6",
        entityType: "owner",
        entityId: "own_1",
        title: "Malik Fahad Nawaz — FBR Active Taxpayer & KYC Verification Dossier",
        category: "kyc_identity",
        version: 1,
        storageKey: "s3://rems-documents/org_pakland/own_1/malik-fahad-kyc.pdf",
        mimeType: "application/pdf",
        sizeBytes: 940000,
        tags: ["KYC", "FBR", "CNIC", "Owner"],
        expiryDate: "2027-06-30",
        contentText:
          "Verified CNIC, FBR Active Taxpayer Certificate, and Meezan Bank IBAN Mandate for Principal Owner Malik Fahad Nawaz.",
      },
    ];

    for (const d of seedDocs) {
      insertDoc.run(
        d.id,
        d.entityType,
        d.entityId,
        d.title,
        d.category,
        d.version,
        d.storageKey,
        d.mimeType,
        d.sizeBytes,
        JSON.stringify(d.tags),
        d.expiryDate,
        d.contentText,
        now,
        now
      );
    }

    // 9.6 Seed Phase 2 Bilingual Listings (Section 3.2)
    const insertListing = db.prepare(`
      INSERT INTO listings (
        id, organization_id, property_id, unit_id, slug, title_en, title_ur,
        description_en, description_ur, purpose, asking_price_minor, currency,
        status, syndicate_portals, published_at, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, ?, ?, 'usr_agent')
    `);

    const seedListings = [
      {
        id: "lst_1",
        propertyId: "prop_1",
        unitId: "unit_21",
        slug: "fahad-garden-10-marla-corner-plot-lahore",
        titleEn: "Prime 10 Marla Corner Plot in Fahad Garden Housing Scheme",
        titleUr: "فہد گارڈن ہاؤسنگ اسکیم میں بہترین 10 مرلہ کارنر پلاٹ",
        descEn:
          "LDA-approved 10 Marla residential corner plot facing main boulevard park in Fahad Garden Housing Scheme, Kala Shah Kaku Interchange, Lahore. Underground electricity and 24/7 gated security.",
        descUr:
          "ایل ڈی اے سے منظور شدہ فہد گارڈن ہاؤسنگ اسکیم لاہور میں مین بلیوارڈ پارک فیسنگ 10 مرلہ رہائشی پلاٹ۔ زیر زمین بجلی اور 24 گھنٹے سیکیورٹی۔",
        purpose: "sale",
        askingPriceMinor: 24250000 * 100,
        status: "published",
        syndicate: 1,
      },
      {
        id: "lst_2",
        propertyId: "prop_2",
        unitId: "unit_22",
        slug: "abdullah-city-7-marla-luxury-villa-rawalpindi",
        titleEn: "Brand New 7 Marla Designer Villa in Abdullah City Rawalpindi",
        titleUr: "عبداللہ سٹی راولپنڈی میں نیا 7 مرلہ ڈیزائنر ولا",
        descEn:
          "Modern 3-bedroom luxury house near Ring Road Interchange in Abdullah City. Features imported fittings, solar backup readiness, and servant quarter.",
        descUr:
          "رنگ روڈ انٹرچینج کے قریب عبداللہ سٹی میں جدید 3 بیڈروم لگژری گھر۔ امپورٹڈ فٹنگز اور سولر بیک اپ کی سہولت۔",
        purpose: "sale",
        askingPriceMinor: 25000000 * 100,
        status: "published",
        syndicate: 1,
      },
      {
        id: "lst_3",
        propertyId: "prop_3",
        unitId: "unit_23",
        slug: "taj-commercial-center-ground-floor-showroom-rent",
        titleEn: "High-Footfall Ground Floor Commercial Shop in Taj Commercial Center",
        titleUr: "تاج کمرشل سینٹر راولپنڈی میں گراؤنڈ فلور کمرشل دکان کرایہ کے لیے",
        descEn:
          "450 Sq.Ft. front-facing commercial showroom in Taj Commercial Center, Satellite Town Rawalpindi. Ideal for banks, retail brands, and pharmacies.",
        descUr:
          "سیٹلائٹ ٹاؤن راولپنڈی کے تاج کمرشل سینٹر میں 450 مربع فٹ فرنٹ فیسنگ شوروم۔ بینکوں اور برانڈز کے لیے بہترین۔",
        purpose: "rent",
        askingPriceMinor: 150000 * 100,
        status: "published",
        syndicate: 1,
      },
      {
        id: "lst_4",
        propertyId: "prop_4",
        unitId: "unit_24",
        slug: "vip-block-islamabad-executive-family-residence",
        titleEn: "Executive 3-Bed Residence for Rent in VIP Block Islamabad",
        titleUr: "وی آئی پی بلاک اسلام آباد میں ایگزیکٹو 3 بیڈ رہائشی مکان",
        descEn:
          "Peaceful gated enclave in VIP Block, Zone IV Park Road Islamabad. Lush green surroundings, dedicated parking, and 24/7 security patrol.",
        descUr:
          "زون فور پارک روڈ اسلام آباد کے وی آئی پی بلاک میں پرسکون اور محفوظ رہائشی مکان۔",
        purpose: "rent",
        askingPriceMinor: 135000 * 100,
        status: "published",
        syndicate: 1,
      },
      {
        id: "lst_5",
        propertyId: "prop_5",
        unitId: "unit_25",
        slug: "university-commercial-centers-corporate-office-suite",
        titleEn: "Corporate IT Office Suite in University Commercial Centers H-11",
        titleUr: "یونیورسٹی کمرشل سینٹرز اسلام آباد میں کارپوریٹ آئی ٹی آفس",
        descEn:
          "Ready-to-move corporate office space in University Commercial Centers, Sector H-11 Link Islamabad. High-speed fiber optic and backup power.",
        descUr:
          "سیکٹر H-11 اسلام آباد کے یونیورسٹی کمرشل سینٹرز میں جدید کارپوریٹ آفس۔ ہائی اسپیڈ انٹرنیٹ اور جنریٹر بیک اپ۔",
        purpose: "rent",
        askingPriceMinor: 165000 * 100,
        status: "under_offer",
        syndicate: 1,
      },
      {
        id: "lst_6",
        propertyId: "prop_6",
        unitId: "unit_26",
        slug: "fahad-garden-overseas-block-plot-for-sale",
        titleEn: "Overseas Block 10 Marla Residential Plot in Fahad Garden",
        titleUr: "فہد گارڈن اوورسیز بلاک میں 10 مرلہ رہائشی پلاٹ برائے فروخت",
        descEn:
          "Direct possession plot in Fahad Garden Overseas Block with smart street lights, biometric gate entry, and community club access.",
        descUr:
          "فہد گارڈن اوورسیز بلاک میں فوری قبضہ کے ساتھ 10 مرلہ پلاٹ۔",
        purpose: "sale",
        askingPriceMinor: 28000000 * 100,
        status: "published",
        syndicate: 1,
      },
      {
        id: "lst_7",
        propertyId: "prop_8",
        unitId: "unit_27",
        slug: "taj-trade-tower-corner-retail-outlet",
        titleEn: "Corner Retail Shop in Taj Trade Tower & Galleria",
        titleUr: "تاج ٹریڈ ٹاور اینڈ گیلریا میں کارنر ریٹیل دکان",
        descEn:
          "Prime commercial retail unit on Murree Road corridor adjacent to Taj Commercial Center.",
        descUr:
          "مری روڈ راولپنڈی پر تاج ٹریڈ ٹاور میں کارنر کمرشل دکان۔",
        purpose: "sale",
        askingPriceMinor: 28750000 * 100,
        status: "draft",
        syndicate: 0,
      },
      {
        id: "lst_8",
        propertyId: "prop_9",
        unitId: "unit_1",
        slug: "vip-block-executive-villa-sold-archive",
        titleEn: "VIP Block Signature Villa (Closed Deal)",
        titleUr: "وی آئی پی بلاک سگنیچر ولا (فروخت شدہ)",
        descEn: "Successfully leased/sold signature unit in VIP Block Islamabad.",
        descUr: "وی آئی پی بلاک اسلام آباد کا کامیابی سے مکمل شدہ یونٹ۔",
        purpose: "sale",
        askingPriceMinor: 31000000 * 100,
        status: "closed",
        syndicate: 0,
      },
    ];

    for (const lst of seedListings) {
      insertListing.run(
        lst.id,
        lst.propertyId,
        lst.unitId,
        lst.slug,
        lst.titleEn,
        lst.titleUr,
        lst.descEn,
        lst.descUr,
        lst.purpose,
        lst.askingPriceMinor,
        lst.status,
        lst.syndicate,
        lst.status === "published" || lst.status === "under_offer" ? now : null,
        now,
        now
      );
    }

    // 9.7 Seed CRM Leads, Clients, Viewings & Deals (Section 3.3)
    const insertLead = db.prepare(`
      INSERT INTO leads (
        id, organization_id, branch_id, listing_id, assigned_agent_id,
        full_name, phone, email, source, stage, score, budget_minor, currency,
        requirements_text, notes_json, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, 'usr_agent', ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, ?, 'usr_agent')
    `);

    const seedLeads = [
      {
        id: "lead_1",
        branchId: "br_lhr",
        listingId: "lst_1",
        fullName: "Dr. Kashif Mehmood",
        phone: "+92-300-4112233",
        email: "kashif.mehmood@hospital.pk",
        source: "web",
        stage: "new",
        score: 78,
        budgetMinor: 25000000 * 100,
        requirements: "Looking for 10 Marla corner plot in Fahad Garden Housing Scheme with immediate possession.",
        notes: [
          {
            id: "note_1",
            type: "note",
            text: "Submitted web inquiry on Fahad Garden 10 Marla Corner Plot.",
            author: "System Web Capture",
            createdAt: now,
          },
          {
            id: "task_1",
            type: "task",
            text: "Send LDA NOC copy and schedule site visit this Saturday",
            dueDate: "2026-10-17",
            completed: false,
            author: "Bilal Ahmed",
            createdAt: now,
          },
        ],
      },
      {
        id: "lead_2",
        branchId: "br_rwp",
        listingId: "lst_2",
        fullName: "Brig. (R) Sohail Akhtar",
        phone: "+92-321-5119988",
        email: "sohail.akhtar@defence.pk",
        source: "whatsapp",
        stage: "viewing_scheduled",
        score: 88,
        budgetMinor: 26000000 * 100,
        requirements: "Interested in 7 Marla Designer Villa in Abdullah City near Ring Road.",
        notes: [
          {
            id: "note_2",
            type: "note",
            text: "Qualified via WhatsApp. Confirmed cash buyer, viewing scheduled.",
            author: "Bilal Ahmed",
            createdAt: now,
          },
        ],
      },
      {
        id: "lead_3",
        branchId: "br_rwp",
        listingId: "lst_3",
        fullName: "Shaheen Chemist & Pharmacy Group",
        phone: "+92-333-5566778",
        email: "expansion@shaheenpharmacy.pk",
        source: "phone",
        stage: "negotiation",
        score: 92,
        budgetMinor: 155000 * 100,
        requirements: "Ground floor commercial showroom in Taj Commercial Center for flagship pharmacy branch.",
        notes: [
          {
            id: "note_3",
            type: "note",
            text: "Viewing completed. Negotiating 3-year lease with 10% annual escalation.",
            author: "Bilal Ahmed",
            createdAt: now,
          },
        ],
      },
      {
        id: "lead_4",
        branchId: "br_isb",
        listingId: "lst_5",
        fullName: "TechVerse Software Solutions (Pvt) Ltd",
        phone: "+92-345-8899001",
        email: "ceo@techverse.io",
        source: "email",
        stage: "contacted",
        score: 74,
        budgetMinor: 170000 * 100,
        requirements: "Corporate IT office suite in University Commercial Centers H-11.",
        notes: [
          {
            id: "note_4",
            type: "note",
            text: "Shared floor plan and fiber connectivity specs via email.",
            author: "Bilal Ahmed",
            createdAt: now,
          },
        ],
      },
      {
        id: "lead_5",
        branchId: "br_isb",
        listingId: "lst_8",
        fullName: "Justice (R) Javed Iqbal",
        phone: "+92-300-9112244",
        email: "javed.iqbal@chambers.pk",
        source: "walk_in",
        stage: "won",
        score: 99,
        budgetMinor: 31000000 * 100,
        requirements: "Purchased signature villa in VIP Block Islamabad.",
        notes: [
          {
            id: "note_5",
            type: "note",
            text: "Deal closed and full token + transfer completed.",
            author: "Bilal Ahmed",
            createdAt: now,
          },
        ],
      },
      {
        id: "lead_6",
        branchId: "br_lhr",
        listingId: "lst_6",
        fullName: "Waqas Butt",
        phone: "+92-302-4001122",
        email: "waqas@example.pk",
        source: "web",
        stage: "lost",
        score: 35,
        budgetMinor: 12000000 * 100,
        requirements: "Requested 5-year installment plan on cash-only Overseas Block plot.",
        notes: [
          {
            id: "note_6",
            type: "note",
            text: "Budget mismatch for cash-only Overseas Block.",
            author: "Bilal Ahmed",
            createdAt: now,
          },
        ],
      },
    ];

    for (const ld of seedLeads) {
      insertLead.run(
        ld.id,
        ld.branchId,
        ld.listingId,
        ld.fullName,
        ld.phone,
        ld.email,
        ld.source,
        ld.stage,
        ld.score,
        ld.budgetMinor,
        ld.requirements,
        JSON.stringify(ld.notes),
        now,
        now
      );
    }

    // Seed Clients
    const insertClient = db.prepare(`
      INSERT INTO clients (
        id, organization_id, lead_id, full_name, cnic, phone, email, client_type, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, ?, ?, ?, ?, 'usr_agent')
    `);

    insertClient.run(
      "cli_1",
      "lead_5",
      "Justice (R) Javed Iqbal",
      "61101-1234567-1",
      "+92-300-9112244",
      "javed.iqbal@chambers.pk",
      "buyer",
      now,
      now
    );
    insertClient.run(
      "cli_2",
      "lead_3",
      "Shaheen Chemist & Pharmacy Group",
      "NTN-7766554-1",
      "+92-333-5566778",
      "expansion@shaheenpharmacy.pk",
      "corporate_tenant",
      now,
      now
    );

    // Seed Viewings
    const insertViewing = db.prepare(`
      INSERT INTO viewings (
        id, organization_id, lead_id, unit_id, agent_id, scheduled_at, status, calendar_event_id, feedback, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, 'usr_agent', ?, ?, ?, ?, ?, ?, 'usr_agent')
    `);

    insertViewing.run(
      "vw_1",
      "lead_2",
      "unit_22",
      "2026-10-16T11:00:00.000Z",
      "scheduled",
      "gcal_evt_abdullah_city_22",
      "Client bringing family and architect for site inspection.",
      now,
      now
    );
    insertViewing.run(
      "vw_2",
      "lead_3",
      "unit_23",
      "2026-10-12T15:00:00.000Z",
      "completed",
      "gcal_evt_taj_center_23",
      "Very positive feedback on front signage visibility and parking.",
      now,
      now
    );

    // Seed Deals with Commission Splits
    const insertDeal = db.prepare(`
      INSERT INTO deals (
        id, organization_id, lead_id, client_id, unit_id, primary_agent_id,
        deal_type, deal_value_minor, commission_pct, commission_minor,
        agent_splits_json, currency, status, closed_at, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, 'usr_agent', ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, ?, 'usr_agent')
    `);

    insertDeal.run(
      "deal_1",
      "lead_5",
      "cli_1",
      "unit_1",
      "sale",
      31000000 * 100,
      2.0,
      620000 * 100, // 2% of 31M PKR = 620,000 PKR
      JSON.stringify([
        {
          agentId: "usr_agent",
          agentName: "Bilal Ahmed (Senior Sales Agent)",
          splitPct: 70,
          amountMinor: 434000 * 100,
        },
        {
          agentId: "usr_admin",
          agentName: "Tariq Mahmood (COO / Referral)",
          splitPct: 30,
          amountMinor: 186000 * 100,
        },
      ]),
      "closed_won",
      now,
      now,
      now
    );

    // 10. Initial Audit Log entries
    const insertAudit = db.prepare(`
      INSERT INTO audit_logs (
        id, organization_id, actor_user_id, action, entity_type, entity_id, ip_address, user_agent, metadata_json, created_at, updated_at, created_by
      ) VALUES (?, 'org_pakland', ?, ?, ?, ?, '127.0.0.1', 'REMS-System-Seeder/1.0', ?, ?, ?, ?)
    `);

    insertAudit.run(
      "aud_seed_1",
      "usr_admin",
      "system.seed_completed",
      "organization",
      "org_pakland",
      JSON.stringify({
        properties: 10,
        units: 30,
        owners: 3,
        tenants: 20,
        invoices: 240,
        roles: 6,
      }),
      now,
      now,
      "usr_admin"
    );

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }
}
