# Architectural & Product Decisions (`DECISIONS.md`)

This document records all architectural, product, and domain defaults made for the **Agentic Real Estate Management System (REMS)** so development proceeds autonomously without blocking on ambiguity.

---

## 1. Business & Domain Defaults (Pakistan Real Estate Context)

| Area | Decision / Default | Rationale |
|---|---|---|
| **Primary Organization** | **PakLand Developers & Builders (Pvt) Ltd** (`org_pakland`) | Matches the prompt's business context: Real Estate Company, Town & Commercial Center Developers in Pakistan. |
| **Secondary Organization (Multi-Tenancy Proof)** | **Indus Valley Estates** (`org_indus`) | Seeded alongside `org_pakland` to prove and test strict row-level multi-tenant isolation (`organization_id`). |
| **Branches** | 3 branches under `org_pakland`: **Islamabad Head Office**, **Rawalpindi Regional Office**, **Lahore Gulberg Branch** | Supports multi-branch filtering within an organization from Phase 0 onward. |
| **Flagship Portfolio Projects** | 10 seeded properties anchored by the 5 named projects in the prompt: **Fahad Garden Housing Scheme**, **Abdullah City**, **Taj Commercial Center**, **VIP Block**, and **University Commercial Centers**, plus 5 sub-projects/plazas (**Fahad Executive Enclave**, **Abdullah Heights Residency**, **Taj Arcade Annex**, **VIP Boulevard Commercial**, **University Tech Tower**) | Honors both the 5 named flagship projects in Section 1 and the Section 7 Rule 5 requirement of **3 owners, 10 properties, 30 units, 20 tenants, and 12 months of invoices**. |
| **Property & Unit Types** | Properties: `housing_scheme`, `commercial_center`, `mixed_use`, `residential_complex`. Units: `plot`, `house`, `shop`, `apartment`, `office` | Covers residential, commercial, plots, houses, and shops as specified. |
| **Area Units** | Stored normalized in `area_sqft` alongside display unit (`Marla`, `Kanal`, `Sq.Ft.`) | Standard in Pakistani real estate (e.g., 5 Marla, 10 Marla, 1 Kanal plots/houses; Sq.Ft. for commercial shops/offices). |
| **Currency & Money Storage** | Default currency: `PKR` (Pakistani Rupee). Stored in **integer minor units (paisa, `amount_minor = PKR * 100`)** with explicit `currency` column (`PKR`). | Prevents floating-point rounding errors across invoices, payments, commissions, and double-entry ledger entries (Section 5). |
| **Languages & Localization** | **English (`en`, LTR)** and **Urdu (`ur`, RTL)** | Full bilingual dictionary and instant LTR/RTL layout switching in the UI header. |
| **Payment Gateways** | Adapter pattern supporting `bank_transfer`, `cash`, `jazzcash`, `easypaisa`, and `stripe` | Mock providers enabled by default for local dev/testing; production credentials configurable via `.env`. |
| **Roles (RBAC)** | 6 built-in roles per organization: `admin`, `agent`, `accountant`, `maintenance_staff`, `owner`, `tenant` | Directly matches Section 1 ("admin, agents, accountants, maintenance staff, owners, tenants") with 36 granular permissions. |

---

## 2. Technology Stack & Architecture Decisions

### 2.1 Unified TypeScript Stack (Next.js App Router + Modular Server Layer)
- **Decision:** Use **Next.js 15 (App Router) + TypeScript + Tailwind CSS** for the responsive frontend and serve the REST API (`/api/v1/*`) from a cleanly decoupled server layer (`src/server/`) following NestJS-style modular architecture (Controllers/Route Handlers → Services → Repositories → Guards/Middleware → Adapters).
- **Justification:**
  1. **Single-Origin Live Preview & Zero CORS Friction:** Browser requests hit relative `/api/v1/*` routes on the same host (`0.0.0.0:3000`), guaranteeing compatibility with cloud sandbox previews and reverse proxies.
  2. **End-to-End Type Safety:** Shared Zod schemas and TypeScript interfaces across database entities, API payloads, agent tools, and React components eliminate serialization drift.
  3. **Fast CI & Test Execution:** Vitest unit and integration tests can invoke both service-layer logic and Next.js Route Handlers directly in milliseconds.

### 2.2 Dual-Mode Database Strategy (PostgreSQL + Embedded SQLite Fallback)
- **Decision:**
  - Provide a complete **Prisma PostgreSQL schema (`prisma/schema.prisma`)** with `pgvector` support and Docker Compose (`pgvector/pgvector:pg16`) for containerized environments.
  - Provide a built-in **Node.js native SQLite (`node:sqlite`) repository engine** (`src/server/db/`) that automatically initializes all 32 tables and seeds the full demo dataset when running locally or in CI without a PostgreSQL daemon.
- **Justification:**
  - Developers, CI runners, and sandboxed environments can run `npm run dev` and `npm test` immediately with zero external daemon dependencies, while `docker compose up` provides the full PostgreSQL + pgvector + Redis + MinIO topology.

### 2.3 Authentication, Session Security & Optional 2FA
- **Decision:**
  - **Stateless JWT Access Tokens** (15-minute expiry, HMAC-SHA256) paired with **Stateful Refresh Tokens** (7-day expiry, stored hashed in `refresh_tokens` table with rotation and revocation support).
  - Tokens are delivered both in JSON response bodies (for API/mobile clients) and `HttpOnly`, `SameSite=Lax` cookies (for browser navigation).
  - **Optional TOTP 2FA (RFC 6238)** implemented natively using Node `crypto` HMAC-SHA1 so any user can enroll with Google Authenticator / Authy or verify with a 6-digit code.

### 2.4 Multi-Tenancy Isolation Model
- **Decision:** Shared database, shared schema with mandatory `organization_id` column on every domain table and mandatory tenant scoping in `AuthContext`.
- **Enforcement:** Every authenticated token encodes `organizationId`, `branchId`, `userId`, and `role`. All repository queries require `organizationId` and reject cross-organization access with `403 Forbidden` / `404 Not Found`.

### 2.5 Agentic AI Layer & Safety Defaults
- **Decision:**
  - Agents execute solely through a typed **Tool Registry** (`src/server/agents/tools/`) where every tool declares its JSON schema, required RBAC permission, and `requiresApproval: boolean`.
  - Default autonomy level for sensitive actions (sending bulk external messages, adjusting lease terms, issuing refunds/payment plans, legal/arrears notices, deleting records) is `act_with_approval`, routing execution into the `approval_requests` queue until a human with `agents:approve` permission approves it.
  - Supports Anthropic Claude API (`ANTHROPIC_API_KEY`) with a deterministic policy-compliant mock reasoning fallback when no API key is configured, ensuring all agent workflows and 20+ adversarial/scenario evaluations run deterministically in CI.
