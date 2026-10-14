# PakLand Agentic Real Estate Management System (REMS)

A phased, multi-tenant **Real Estate Management System (REMS)** with planned **Agentic AI** capabilities, built for housing scheme developers, commercial centers, property managers, and real estate agencies.

---

## Quick Start

### Option A: Zero-Daemon Local Run (Node.js 22+)
```bash
npm install
npm run db:seed
npm run dev
```
Phases 0–4 are implemented for local use; external integrations use explicit mocks.
See `PROGRESS.md` for current capabilities and remaining production hardening.

Open `http://localhost:3000`. The embedded SQLite database (`./data/rems.sqlite`) initializes the schema and seeds the full demo dataset automatically.

### Option B: Docker Compose (PostgreSQL + pgvector, Redis, MinIO, App)
```bash
cp .env.example .env
docker compose up --build
```

---

## Seeded Demo Accounts (All 6 Roles + Secondary Organization)

Default Password for all accounts: **`Password123!`**

| Role | Email | Organization | Branch | Key Capabilities |
|---|---|---|---|---|
| **Admin** | `admin@pakland.pk` | PakLand Developers | Islamabad HQ | Full access (all 36 permissions), RBAC matrix editor, user/branch admin, audit trail |
| **Sales Agent** | `agent@pakland.pk` | PakLand Developers | Islamabad HQ | Listings, CRM leads, viewings, deals, Lead & Listing AI agents |
| **Accountant** | `accountant@pakland.pk` | PakLand Developers | Islamabad HQ | Rent invoicing, payments, receipts, owner statements, chart of accounts |
| **Maintenance** | `maintenance@pakland.pk` | PakLand Developers | Rawalpindi | Maintenance ticket triage, SLA tracking, vendor & work order dispatch |
| **Owner** | `owner@pakland.pk` | PakLand Developers | Islamabad HQ | Owner portal, property performance, payout statements, approvals |
| **Tenant** | `tenant@pakland.pk` | PakLand Developers | Rawalpindi | Tenant portal (Urdu RTL default), lease details, invoices, ticket submission |
| **Org 2 Admin** | `admin@indusvalley.pk` | Indus Valley Estates | Karachi HQ | Demonstrates strict row-level multi-tenant isolation (`org_indus`) |

---

## Verification & Testing Commands

```bash
# TypeScript strict check
npm run typecheck

# Run unit & integration test suite with >=70% coverage enforcement
npm run test:coverage

# Production build verification
npm run build
```

---

## Key Documentation
- [`DECISIONS.md`](./DECISIONS.md) — Architectural & domain defaults
- [`PROGRESS.md`](./PROGRESS.md) — Phase-by-phase completion log
- [`docs/PLAN.md`](./docs/PLAN.md) — Architecture diagram, stack justification, folder structure, and risk register
- [`docs/ERD.md`](./docs/ERD.md) — Core Entity-Relationship Diagram and data model specification


## Phase 3: Tenancy & Billing

Open **Tenants & Leases** and **Rent & Payments** in `/dashboard`.
See [`docs/PHASE3.md`](./docs/PHASE3.md) for the complete tenant-to-receipt
walkthrough, API payloads, scheduled cycle command, browser test and explicit
mock/live boundaries. Existing databases are preserved; to explore the expanded
fixtures use `SQLITE_DB_PATH=./data/phase3-demo.sqlite npm run dev`.

**Deployment note:** The current services run on SQLite even if `DATABASE_URL`
is set. The Prisma PostgreSQL schema is a deployment design, not a functioning
switchable repository. Live payment-provider processing is disabled; external
verified payments may be recorded manually, or explicitly simulated locally.


## Phase 4: Maintenance, Vendors & Notifications

Open **Maintenance & Vendors** and **Notifications** in the dashboard (or the
**Workspace** dropdown on smaller screens). Report a tenant issue with photos,
triage/assign it as maintenance staff, complete work with actual PKR costs, then
confirm/rate it as the tenant. Administrators can review delivery logs and templates.

Run the background scheduler in a second terminal using the app's database path:

```bash
npm run maintenance:worker  # every 60 seconds; Ctrl+C stops it
# Or one scan (also suitable for cron):
npm run maintenance:cycle
```

In-app notifications are real; **email/SMS/WhatsApp are simulated by default** and
shown as `mock_sent`. No external message is sent in mock mode. Switching to live
mode fails closed until a real provider adapter is implemented and validated.

Walkthrough, SLA defaults, consent/retry rules, API reference and provider
requirements: [`docs/PHASE4.md`](docs/PHASE4.md). Existing databases migrate without
resetting rent/portfolio records. PR #2 remains unmerged; Phase 5 awaits approval.
