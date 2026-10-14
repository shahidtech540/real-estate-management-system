import { getDb } from "./index";

const db = getDb();

const counts = {
  organizations: (db.prepare("SELECT COUNT(*) as c FROM organizations WHERE deleted_at IS NULL").get() as { c: number }).c,
  branches: (db.prepare("SELECT COUNT(*) as c FROM branches WHERE organization_id = 'org_pakland' AND deleted_at IS NULL").get() as { c: number }).c,
  roles: (db.prepare("SELECT COUNT(*) as c FROM roles WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
  permissions: (db.prepare("SELECT COUNT(*) as c FROM permissions WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
  users: (db.prepare("SELECT COUNT(*) as c FROM users WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
  owners: (db.prepare("SELECT COUNT(*) as c FROM owners WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
  properties: (db.prepare("SELECT COUNT(*) as c FROM properties WHERE organization_id = 'org_pakland' AND deleted_at IS NULL").get() as { c: number }).c,
  units: (db.prepare("SELECT COUNT(*) as c FROM units WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
  tenants: (db.prepare("SELECT COUNT(*) as c FROM tenants WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
  leases: (db.prepare("SELECT COUNT(*) as c FROM leases WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
  invoices: (db.prepare("SELECT COUNT(*) as c FROM invoices WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
  agents: (db.prepare("SELECT COUNT(*) as c FROM agents WHERE organization_id = 'org_pakland'").get() as { c: number }).c,
};

console.log("✅ REMS Database initialized and seeded successfully:");
console.table(counts);
