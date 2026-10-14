# PakLand Agentic Real Estate Management System (REMS)

A production-grade, multi-tenant **Real Estate Management System (REMS)** with **Agentic AI** capabilities built for housing scheme developers, commercial centers, property managers, and real estate agencies.

---

## Quick Start

### Option A: Zero-Daemon Local Run (Node.js 22+)
```bash
npm install
npm run db:seed
npm run dev
```
Open `http://localhost:3000`. The embedded SQLite database (`./data/rems.sqlite`) initializes all 32 tables and seeds the full demo dataset automatically.

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
- [`docs/ERD.md`](./docs/ERD.md) — Complete 32-table Entity-Relationship Diagram and data model specification
