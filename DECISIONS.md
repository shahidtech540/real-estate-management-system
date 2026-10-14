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
| **Multi-Owner Splits** | Properties support multiple owners via `property_owners` (`ownership_pct`, `is_primary`). Validated so total ownership per property is `> 0%` and `<= 100%`. |Seeded with co-owned flagship projects (`Fahad Garden Housing Scheme` 70%/30%, `Taj Commercial Center` 60%/40%). |
| **CSV Import Format** | 11-column schema (`property_code,building_code,unit_number,type,area_sqft,area_display,bedrooms,bathrooms,status,market_price_pkr,monthly_rent_pkr`) with both `dryRun` and `commit` modes. | Validates property codes, duplicate unit numbers, unit types, status enums, positive area, and PKR values, returning a structured row-by-row error report. |
| **Document Vault Versioning & Expiry** | Uploading a document with the same `entityType + entityId + title` auto-increments `version` (`v1 → v2 → v3`). Expiry status is computed (`valid`, `expiring_soon` <= 60 days, `expired`, `no_expiry`). | Every view or download generates a signed access URL and logs `document.viewed` or `document.downloaded` in `audit_logs`. |
| **Listings Workflow & Syndication** | Listings progress through `draft → published → under_offer → closed`. Each listing generates a deterministic SVG QR code (`data:image/svg+xml;utf8,...`), shareable SEO URL (`/listings/[slug]`), and exports in both JSON and CSV portal syndication feeds (`/api/v1/listings/feed?format=json|csv`). | Enables instant sharing on Zameen/Graana/agency portals and print brochures without external QR service dependencies. |
| **CRM Lead Scoring & Timeline** | Lead score (`0–100`) is dynamically computed from pipeline stage (`new` → `negotiation` → `won`), contact completeness, budget vs. asking price alignment, source intent, and activity engagement. Notes and follow-up tasks/reminders are stored in `leads.notes_json` as a structured timeline. | Gives sales agents transparent, deterministic prioritization and one-click task tracking. |
| **Deals & Multi-Agent Commission Splits** | Closing a deal (`POST /api/v1/crm/deals`) converts the lead into a `Client` record, marks the lead `won`, transitions the listing to `closed` and unit to `sold`/`rented`, and validates that `agentSplits` sum to `100%`, calculating exact integer minor-unit (`PKR paisa`) payouts per agent. | Eliminates manual commission math errors and enforces end-to-end data consistency from Web Form to Closed Deal. |

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

## 3. Phase 3: Tenancy, Billing & Payout Defaults

- **Runtime persistence:** Phase 3 extends the existing SQLite runtime with additive `CREATE TABLE/INDEX IF NOT EXISTS` DDL. Existing records are not deleted or reseeded. The Prisma models remain a PostgreSQL deployment design; merely setting `DATABASE_URL` does **not** switch the running services to PostgreSQL.
- **KYC:** New tenants default to `pending`. Admin verification is required before activating a lease. CNIC uses `12345-1234567-1` format and is unique per organization. Emergency and reference contacts are stored on the profile; KYC files use the existing Document Vault (`entityType=tenant`). Verification is a human attestation, not an external NADRA check.
- **Lease lifecycle:** Draft → pending signature → active → expiring → renewed, or terminated / expired. Renewal must extend the end date and applies the contractual escalation once per transition; repeating the same transition is rejected. Overlapping non-terminal lease reservations for a unit are rejected, including drafts. Sold / under-maintenance units cannot be leased. Deposits are separate from rental income, with audited receipt/refund events and refunds limited to the balance held after termination/expiry.
- **Lease dates and alerts:** Calendar dates use Pakistan's business timezone (`Asia/Karachi`). Expiry alerts are mutually exclusive 0–30, 31–60 and 61–90 day windows. Production calculations use the current date, not a frozen demo date. Tests inject a fixed clock. Scheduled cycle execution also advances expiring/expired lifecycle states.
- **Contracts and inspections:** Generate actual downloadable English PDF agreements with execution/witness fields, plus JSON terms for integrations. These are unsigned templates, not electronic signatures or legal advice; local legal review is required. Standard PDF fonts are used, so non-Latin characters in names are replaced with `?` in the PDF only; original Unicode identities remain intact in JSON/database/UI. Move-in/out checklists preserve condition notes and HTTPS photo evidence links; file uploads can use the existing vault.
- **Invoice recurrence:** One rent invoice per organization/lease/month, enforced by a partial unique index and transaction. Bill the full contractual month when the period intersects the lease term; no automatic daily proration. Due days are restricted to 1–28. Utilities/maintenance/parking/service fees can be one-time or fixed monthly recurring rules over an explicit month range. Cycle execution is idempotent for both rent and recurring rules. `npm run billing:cycle -- YYYY-MM` is a schedulable one-shot job; deployment must configure cron/its scheduler.
- **Fees, credits and money:** All API amounts are bounded integer paisa. A fixed late fee is applied once, only after the lease grace period and only to outstanding invoices, including partial payments. Credit notes are immutable records with mandatory reasons; credits cannot exceed outstanding balance. No automatic refunds. Invoice arithmetic remains `amount + late fee = total` after adjustments.
- **Payments:** Supported recording methods are cash, bank transfer, JazzCash, Easypaisa and Stripe. A repeated reference with identical details returns the original receipt; conflicting reuse is rejected. Payment + receipt + invoice mutation is atomic. Overpayments are rejected explicitly rather than silently lost or treated as revenue. Do not use this endpoint as a gateway webhook without independently authenticating provider events.
- **Gateway simulation:** The separate checkout endpoint supplies deterministic, clearly prefixed `MOCK-*` confirmations for JazzCash/Easypaisa/Stripe. It is staff-only. Live mode fails closed with 503; real merchant checkout/webhooks are not enabled. Verified externally completed transfers/wallet/card transactions can be recorded manually without simulating a charge.
- **Owner statements:** Cash basis: collect actual completed payments dated in the statement month for rent invoices, allocate by current property ownership percentage, subtract actual completed work-order costs and the owner's management fee on gross share. No fabricated operating reserve. Negative balances are retained. Statements can refresh until a payout is recorded; paid statements are locked, and payout records are unique per statement. A payout records an independently executed transfer, not a bank API instruction.
- **Access:** All Phase 3 routes require authentication and module permissions. Tenant lease/invoice/receipt views are restricted to their linked tenant profile. Owner views are restricted to their owned properties, and statements to their own owner profile. Organization scoping applies to every service mutation. Dedicated portals remain Phase 8; these restrictions already apply in the staff dashboard and APIs.
- **Dependency update:** Added `pdf-lib` for real PDF generation and updated Next.js from 15.1.6 to 15.5.27 within the existing major version. `npm audit --omit=dev` still reports one high and one moderate advisory (Next.js/transitive PostCSS); the suggested full fix requires a Next.js major upgrade. These remain deployment blockers for the Phase 8 hardening pass, not claims of a completed production security audit.

## 4. Embedded-preview sign-in correction

The browser UI previously wrote an access token to `localStorage` but never
attached it to dashboard API calls. A cross-site iframe rejects the existing
`SameSite=Lax` cookies, yielding login 200 → `/auth/me` 401 → `/login`.
Reproduced this using the actual sign-in form under a synthetic cross-site parent.

- Preserve HttpOnly/SameSite cookie protections; do not loosen CORS or put tokens in URLs.
- Use a shared `authFetch` for same-origin `/api/v1/*` requests. It attaches the
  existing short-lived access JWT, captures rotated/context-switched tokens,
  and clears stale tokens on 401 or logout. Never attach it to external URLs.
- Keep the access token tab-scoped in `sessionStorage`, with an in-memory fallback
  if Web Storage throws. Delete the old persistent `localStorage` copy. Refresh
  tokens remain in HttpOnly cookies and are never persisted by the browser helper.
- Verify `/auth/me` before leaving the sign-in form, resume existing tab sessions
  on preview reload, and show a visible error if session establishment fails.
- Protected downloads use authenticated fetch + Blob downloads, not token query
  parameters. Original cookie-based API clients and backend RBAC are unchanged.
- If both cookies and storage are blocked, in-memory auth survives client-side
  navigation but not a full page reload. If refresh cookies are blocked, the
  short-lived token expires normally and the user must sign in again.
