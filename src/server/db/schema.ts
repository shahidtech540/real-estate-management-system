export const SCHEMA_DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  legal_name TEXT NOT NULL,
  country TEXT NOT NULL DEFAULT 'PK',
  default_currency TEXT NOT NULL DEFAULT 'PKR',
  default_locale TEXT NOT NULL DEFAULT 'en',
  tax_number TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT,
  is_headquarters INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_branches_org ON branches(organization_id);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  is_system INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT,
  UNIQUE(organization_id, slug)
);
CREATE INDEX IF NOT EXISTS idx_roles_org ON roles(organization_id);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(organization_id, code)
);
CREATE INDEX IF NOT EXISTS idx_permissions_org ON permissions(organization_id);

CREATE TABLE IF NOT EXISTS role_permissions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  permission_id TEXT NOT NULL REFERENCES permissions(id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  UNIQUE(role_id, permission_id)
);
CREATE INDEX IF NOT EXISTS idx_role_permissions_org ON role_permissions(organization_id);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  branch_id TEXT REFERENCES branches(id),
  role_id TEXT NOT NULL REFERENCES roles(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  phone TEXT,
  locale TEXT NOT NULL DEFAULT 'en',
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  two_factor_secret TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  last_login_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT,
  UNIQUE(organization_id, email)
);
CREATE INDEX IF NOT EXISTS idx_users_org_role ON users(organization_id, role_id);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user ON refresh_tokens(organization_id, user_id);

CREATE TABLE IF NOT EXISTS owners (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT REFERENCES users(id),
  full_name TEXT NOT NULL,
  cnic_ntn TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  bank_name TEXT,
  iban TEXT,
  management_fee_pct REAL NOT NULL DEFAULT 5.0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_owners_org ON owners(organization_id);

CREATE TABLE IF NOT EXISTS properties (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  branch_id TEXT NOT NULL REFERENCES branches(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  city TEXT NOT NULL,
  address TEXT NOT NULL,
  latitude REAL,
  longitude REAL,
  total_units INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  amenities_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_properties_org_branch ON properties(organization_id, branch_id);

CREATE TABLE IF NOT EXISTS property_owners (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  owner_id TEXT NOT NULL REFERENCES owners(id),
  ownership_pct REAL NOT NULL,
  is_primary INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_property_owners_prop ON property_owners(organization_id, property_id);

CREATE TABLE IF NOT EXISTS buildings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  floors INTEGER NOT NULL DEFAULT 1,
  block_sector TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_buildings_prop ON buildings(organization_id, property_id);

CREATE TABLE IF NOT EXISTS units (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  building_id TEXT REFERENCES buildings(id),
  unit_number TEXT NOT NULL,
  type TEXT NOT NULL,
  area_sqft REAL NOT NULL,
  area_display TEXT NOT NULL,
  bedrooms INTEGER NOT NULL DEFAULT 0,
  bathrooms INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'available',
  market_price_minor INTEGER NOT NULL DEFAULT 0,
  monthly_rent_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  amenities_json TEXT NOT NULL DEFAULT '[]',
  photos_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_units_org_prop_status ON units(organization_id, property_id, status);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  slug TEXT NOT NULL UNIQUE,
  title_en TEXT NOT NULL,
  title_ur TEXT NOT NULL,
  description_en TEXT NOT NULL,
  description_ur TEXT NOT NULL,
  purpose TEXT NOT NULL,
  asking_price_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'draft',
  syndicate_portals INTEGER NOT NULL DEFAULT 1,
  published_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_listings_org_status ON listings(organization_id, status);

CREATE TABLE IF NOT EXISTS leads (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  branch_id TEXT REFERENCES branches(id),
  listing_id TEXT REFERENCES listings(id),
  assigned_agent_id TEXT REFERENCES users(id),
  full_name TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  source TEXT NOT NULL,
  stage TEXT NOT NULL DEFAULT 'new',
  score INTEGER NOT NULL DEFAULT 50,
  budget_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  requirements_text TEXT,
  notes_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leads_org_stage ON leads(organization_id, stage);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  lead_id TEXT REFERENCES leads(id),
  full_name TEXT NOT NULL,
  cnic TEXT,
  phone TEXT NOT NULL,
  email TEXT,
  client_type TEXT NOT NULL DEFAULT 'buyer',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_clients_org ON clients(organization_id);

CREATE TABLE IF NOT EXISTS viewings (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  lead_id TEXT NOT NULL REFERENCES leads(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  agent_id TEXT NOT NULL REFERENCES users(id),
  scheduled_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  calendar_event_id TEXT,
  feedback TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_viewings_org_agent ON viewings(organization_id, agent_id);

CREATE TABLE IF NOT EXISTS deals (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  lead_id TEXT REFERENCES leads(id),
  client_id TEXT NOT NULL REFERENCES clients(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  primary_agent_id TEXT NOT NULL REFERENCES users(id),
  deal_type TEXT NOT NULL,
  deal_value_minor INTEGER NOT NULL,
  commission_pct REAL NOT NULL,
  commission_minor INTEGER NOT NULL,
  agent_splits_json TEXT NOT NULL DEFAULT '[]',
  currency TEXT NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'pending',
  closed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_deals_org_status ON deals(organization_id, status);

CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT REFERENCES users(id),
  full_name TEXT NOT NULL,
  cnic TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT NOT NULL,
  kyc_status TEXT NOT NULL DEFAULT 'verified',
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  references_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tenants_org ON tenants(organization_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tenant_cnic ON tenants(organization_id, cnic) WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  lease_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  rent_minor INTEGER NOT NULL,
  deposit_minor INTEGER NOT NULL,
  escalation_pct REAL NOT NULL DEFAULT 10.0,
  due_day INTEGER NOT NULL DEFAULT 5,
  grace_days INTEGER NOT NULL DEFAULT 5,
  late_fee_minor INTEGER NOT NULL DEFAULT 500000,
  currency TEXT NOT NULL DEFAULT 'PKR',
  document_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_leases_org_status ON leases(organization_id, status);

CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  lease_id TEXT NOT NULL REFERENCES leases(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  invoice_number TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'rent',
  period_month TEXT NOT NULL,
  due_date TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  late_fee_minor INTEGER NOT NULL DEFAULT 0,
  total_minor INTEGER NOT NULL,
  paid_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_invoices_org_status_due ON invoices(organization_id, status, due_date);

CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  method TEXT NOT NULL,
  reference_number TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'completed',
  paid_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_payments_org_inv ON payments(organization_id, invoice_id);

CREATE TABLE IF NOT EXISTS receipts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  payment_id TEXT NOT NULL UNIQUE REFERENCES payments(id),
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  receipt_number TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  issued_at TEXT NOT NULL,
  pdf_url TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_receipts_org_tenant ON receipts(organization_id, tenant_id);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT,
  UNIQUE(organization_id, code)
);

CREATE TABLE IF NOT EXISTS ledger_entries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  account_id TEXT NOT NULL REFERENCES accounts(id),
  property_id TEXT REFERENCES properties(id),
  owner_id TEXT REFERENCES owners(id),
  invoice_id TEXT REFERENCES invoices(id),
  payment_id TEXT REFERENCES payments(id),
  entry_date TEXT NOT NULL,
  direction TEXT NOT NULL,
  amount_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_ledger_org_prop_date ON ledger_entries(organization_id, property_id, entry_date);

CREATE TABLE IF NOT EXISTS owner_statements (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  owner_id TEXT NOT NULL REFERENCES owners(id),
  property_id TEXT REFERENCES properties(id),
  period_month TEXT NOT NULL,
  gross_rent_minor INTEGER NOT NULL DEFAULT 0,
  expenses_minor INTEGER NOT NULL DEFAULT 0,
  management_fee_pct REAL NOT NULL DEFAULT 5.0,
  management_fee_minor INTEGER NOT NULL DEFAULT 0,
  net_payout_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  status TEXT NOT NULL DEFAULT 'issued',
  line_items_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_owner_statements_org_owner ON owner_statements(organization_id, owner_id, period_month);

CREATE TABLE IF NOT EXISTS vendors (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  name TEXT NOT NULL,
  trade_category TEXT NOT NULL,
  phone TEXT NOT NULL,
  email TEXT,
  rating REAL NOT NULL DEFAULT 4.5,
  base_rate_minor INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'PKR',
  sla_hours INTEGER NOT NULL DEFAULT 24,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_vendors_org_trade ON vendors(organization_id, trade_category);

CREATE TABLE IF NOT EXISTS maintenance_tickets (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  property_id TEXT NOT NULL REFERENCES properties(id),
  unit_id TEXT NOT NULL REFERENCES units(id),
  tenant_id TEXT REFERENCES tenants(id),
  ticket_number TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  sla_due_at TEXT NOT NULL,
  photos_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_tickets_org_status_prio ON maintenance_tickets(organization_id, status, priority);

CREATE TABLE IF NOT EXISTS work_orders (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  ticket_id TEXT NOT NULL REFERENCES maintenance_tickets(id),
  vendor_id TEXT NOT NULL REFERENCES vendors(id),
  work_order_number TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled',
  estimated_cost_minor INTEGER NOT NULL,
  actual_cost_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  scheduled_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_work_orders_org_ticket ON work_orders(organization_id, ticket_id);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  tags_json TEXT NOT NULL DEFAULT '[]',
  expiry_date TEXT,
  content_text TEXT,
  embedding_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_org_entity ON documents(organization_id, entity_type, entity_id);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  user_id TEXT REFERENCES users(id),
  channel TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'sent',
  is_ai_drafted INTEGER NOT NULL DEFAULT 0,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_notifications_org_user ON notifications(organization_id, user_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  actor_user_id TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created ON audit_logs(organization_id, created_at);

CREATE TABLE IF NOT EXISTS agents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  goal TEXT NOT NULL,
  autonomy_level TEXT NOT NULL DEFAULT 'act_with_approval',
  is_enabled INTEGER NOT NULL DEFAULT 1,
  cost_budget_minor INTEGER NOT NULL DEFAULT 500000,
  currency TEXT NOT NULL DEFAULT 'PKR',
  allowed_tools_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT,
  deleted_at TEXT,
  UNIQUE(organization_id, slug)
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  agent_id TEXT NOT NULL REFERENCES agents(id),
  trigger_type TEXT NOT NULL,
  input_text TEXT NOT NULL,
  reasoning_summary TEXT NOT NULL,
  output_text TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'completed',
  tokens_used INTEGER NOT NULL DEFAULT 0,
  cost_minor INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'PKR',
  approved_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_agent_runs_org_agent ON agent_runs(organization_id, agent_id);

CREATE TABLE IF NOT EXISTS tool_calls (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
  tool_name TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  requires_approval INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'executed',
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_tool_calls_org_run ON tool_calls(organization_id, agent_run_id);

CREATE TABLE IF NOT EXISTS approval_requests (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations(id),
  agent_run_id TEXT NOT NULL REFERENCES agent_runs(id),
  tool_call_id TEXT REFERENCES tool_calls(id),
  agent_slug TEXT NOT NULL,
  action_type TEXT NOT NULL,
  summary TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_approval_requests_org_status ON approval_requests(organization_id, status);

CREATE UNIQUE INDEX IF NOT EXISTS idx_owner_statement_period ON owner_statements(organization_id, owner_id, period_month);
CREATE TABLE IF NOT EXISTS lease_events (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 lease_id TEXT NOT NULL REFERENCES leases(id), type TEXT NOT NULL, payload_json TEXT NOT NULL,
 created_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS credit_notes (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 invoice_id TEXT NOT NULL REFERENCES invoices(id), amount_minor INTEGER NOT NULL,
 reason TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS lease_checklists (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 lease_id TEXT NOT NULL REFERENCES leases(id), kind TEXT NOT NULL,
 items_json TEXT NOT NULL, photos_json TEXT NOT NULL DEFAULT '[]',
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT NOT NULL,
 UNIQUE(organization_id, lease_id, kind)
);
CREATE TABLE IF NOT EXISTS statement_payouts (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 statement_id TEXT NOT NULL UNIQUE REFERENCES owner_statements(id),
 amount_minor INTEGER NOT NULL, reference_number TEXT NOT NULL,
 paid_at TEXT NOT NULL, created_by TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_reference ON payments(organization_id, reference_number) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_rent_period ON invoices(organization_id, lease_id, period_month) WHERE type = 'rent' AND deleted_at IS NULL;
CREATE TABLE IF NOT EXISTS recurring_charges (
 id TEXT PRIMARY KEY, organization_id TEXT NOT NULL REFERENCES organizations(id),
 lease_id TEXT NOT NULL REFERENCES leases(id), type TEXT NOT NULL, amount_minor INTEGER NOT NULL,
 start_month TEXT NOT NULL, end_month TEXT NOT NULL, created_at TEXT NOT NULL, created_by TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS recurring_charge_invoices (
 charge_id TEXT NOT NULL REFERENCES recurring_charges(id), period_month TEXT NOT NULL,
 invoice_id TEXT NOT NULL REFERENCES invoices(id), PRIMARY KEY(charge_id, period_month)
);
`;
