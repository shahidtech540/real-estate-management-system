export interface PermissionDefinition {
  code: string;
  module: string;
  description: string;
}

export interface RoleDefinition {
  slug: "admin" | "agent" | "accountant" | "maintenance_staff" | "owner" | "tenant";
  name: string;
  description: string;
  permissions: string[];
}

export const PERMISSION_CATALOG: PermissionDefinition[] = [
  // Properties & Units (3.1)
  { code: "properties:read", module: "Properties & Units", description: "View properties, buildings, units, and floor plans" },
  { code: "properties:write", module: "Properties & Units", description: "Create, edit, and import properties, buildings, and units" },
  { code: "properties:delete", module: "Properties & Units", description: "Soft-delete properties and units" },
  { code: "owners:read", module: "Properties & Units", description: "View property owners and ownership percentages" },
  { code: "owners:write", module: "Properties & Units", description: "Manage owner records and ownership allocations" },

  // Listings & Marketing (3.2)
  { code: "listings:read", module: "Listings & Marketing", description: "View internal and public property listings" },
  { code: "listings:write", module: "Listings & Marketing", description: "Create, update, publish, and syndicate listings" },

  // CRM: Leads, Clients, Viewings, Deals (3.3)
  { code: "leads:read", module: "CRM & Deals", description: "View leads, activity timeline, and pipeline stages" },
  { code: "leads:write", module: "CRM & Deals", description: "Create, score, assign, and progress leads" },
  { code: "viewings:manage", module: "CRM & Deals", description: "Schedule and update property viewings" },
  { code: "deals:read", module: "CRM & Deals", description: "View deals and commission breakdowns" },
  { code: "deals:write", module: "CRM & Deals", description: "Create deals and calculate commission splits" },

  // Tenants & Leases (3.4)
  { code: "tenants:read", module: "Tenants & Leases", description: "View tenant profiles and KYC documents" },
  { code: "tenants:write", module: "Tenants & Leases", description: "Onboard and update tenant profiles" },
  { code: "leases:read", module: "Tenants & Leases", description: "View lease agreements, terms, and renewal alerts" },
  { code: "leases:write", module: "Tenants & Leases", description: "Draft, activate, renew, and terminate leases" },

  // Rent, Billing & Payments (3.5)
  { code: "invoices:read", module: "Billing & Payments", description: "View rent/utility invoices and arrears aging" },
  { code: "invoices:write", module: "Billing & Payments", description: "Generate recurring invoices and apply late fees" },
  { code: "payments:read", module: "Billing & Payments", description: "View recorded payments and downloadable receipts" },
  { code: "payments:write", module: "Billing & Payments", description: "Record payments and issue receipts" },
  { code: "statements:read", module: "Billing & Payments", description: "View owner payout statements and management fees" },

  // Maintenance & Vendors (3.6)
  { code: "maintenance:read", module: "Maintenance & Vendors", description: "View maintenance tickets, SLAs, and work orders" },
  { code: "maintenance:create", module: "Maintenance & Vendors", description: "Submit maintenance tickets with photos" },
  { code: "maintenance:triage", module: "Maintenance & Vendors", description: "Triage tickets, assign vendors, and manage work orders" },
  { code: "vendors:manage", module: "Maintenance & Vendors", description: "Manage vendor directory, rates, and ratings" },

  // Accounting & Reporting (3.7)
  { code: "accounting:read", module: "Accounting & Reports", description: "View chart of accounts, ledgers, and financial reports" },
  { code: "accounting:write", module: "Accounting & Reports", description: "Post ledger entries, expenses, and budgets" },
  { code: "reports:export", module: "Accounting & Reports", description: "Export financial and operational reports to CSV/PDF" },

  // Documents (3.8)
  { code: "documents:read", module: "Document Vault", description: "Search and download authorized documents" },
  { code: "documents:write", module: "Document Vault", description: "Upload, tag, and version documents" },

  // Portals (3.9)
  { code: "portal:owner", module: "Portals", description: "Access Owner Portal views and maintenance approvals" },
  { code: "portal:tenant", module: "Portals", description: "Access Tenant Portal lease, invoices, and ticket submission" },

  // Admin, Security & Agentic AI (3.10 & 4)
  { code: "agents:read", module: "Agentic AI", description: "View AI agents, execution logs, and tool calls" },
  { code: "agents:run", module: "Agentic AI", description: "Trigger AI agents and configure autonomy/kill switches" },
  { code: "agents:approve", module: "Agentic AI", description: "Approve or reject human-in-the-loop agent actions" },
  { code: "admin:manage", module: "Admin & Security", description: "Manage users, roles, branches, audit logs, and tenant settings" },
];

export const ROLE_DEFINITIONS: RoleDefinition[] = [
  {
    slug: "admin",
    name: "Organization Administrator",
    description: "Full access across all properties, branches, financials, RBAC settings, audit logs, and AI agent approvals.",
    permissions: PERMISSION_CATALOG.map((p) => p.code),
  },
  {
    slug: "agent",
    name: "Sales & Leasing Agent",
    description: "Manages property listings, leads, viewings, deals, and AI Lead/Listing assistants.",
    permissions: [
      "properties:read",
      "listings:read",
      "listings:write",
      "leads:read",
      "leads:write",
      "viewings:manage",
      "deals:read",
      "deals:write",
      "tenants:read",
      "leases:read",
      "documents:read",
      "documents:write",
      "agents:read",
      "agents:run",
    ],
  },
  {
    slug: "accountant",
    name: "Finance & Accountant",
    description: "Manages rent invoicing, payment reconciliation, receipts, owner statements, chart of accounts, and financial exports.",
    permissions: [
      "properties:read",
      "owners:read",
      "tenants:read",
      "leases:read",
      "invoices:read",
      "invoices:write",
      "payments:read",
      "payments:write",
      "statements:read",
      "accounting:read",
      "accounting:write",
      "reports:export",
      "documents:read",
      "agents:read",
      "agents:run",
      "agents:approve",
    ],
  },
  {
    slug: "maintenance_staff",
    name: "Maintenance & Facilities Coordinator",
    description: "Triages maintenance tickets, manages SLA timers, assigns vendors, and tracks work orders.",
    permissions: [
      "properties:read",
      "tenants:read",
      "maintenance:read",
      "maintenance:create",
      "maintenance:triage",
      "vendors:manage",
      "documents:read",
      "documents:write",
      "agents:read",
      "agents:run",
    ],
  },
  {
    slug: "owner",
    name: "Property Owner / Investor",
    description: "Views owned properties, occupancy, income/expense statements, and approves major maintenance/lease actions.",
    permissions: [
      "properties:read",
      "owners:read",
      "leases:read",
      "invoices:read",
      "payments:read",
      "statements:read",
      "maintenance:read",
      "documents:read",
      "portal:owner",
      "agents:approve",
    ],
  },
  {
    slug: "tenant",
    name: "Resident / Commercial Tenant",
    description: "Accesses active lease agreement, rent invoices, payment receipts, and submits/confirms maintenance tickets.",
    permissions: [
      "leases:read",
      "invoices:read",
      "payments:read",
      "maintenance:read",
      "maintenance:create",
      "documents:read",
      "portal:tenant",
    ],
  },
];
