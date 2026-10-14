# Project Build Progress (`PROGRESS.md`)

## Phase Summary Matrix

| Phase | Scope | Status | Test Coverage | Checkpoint Deliverable |
|---|---|---|---|---|
| **Phase 0** | Plan, ERD, repo scaffold, Docker, CI, auth + RBAC + multi-tenancy | ✅ **COMPLETED** | **93.26%** | Multi-role login (`admin`, `agent`, `accountant`, `maintenance_staff`, `owner`, `tenant`), TOTP 2FA, RBAC matrix, multi-tenant & branch isolation, 32-table ERD & seed dataset |
| **Phase 1** | Properties, units, owners, documents vault, CSV import | ✅ **COMPLETED** | **91.44%** | Portfolio CRUD, hierarchy (`Property → Building → Unit`), multi-owner percentage splits (`<=100%`), Central Document Vault (`v1→v2` versioning, expiry alerts, view/download audit logs), Bulk CSV import with dry-run & row-by-row validation error report |
| **Phase 2** | Listings, public site, CRM (leads, viewings, deals) | ✅ **COMPLETED** | **91.91%** (15/15 tests passing) | Bilingual public marketplace (`/listings`), SEO detail pages (`/listings/[slug]`), SVG QR code generator, JSON/CSV portal syndication feeds, public Web Lead Capture form, CRM Lead pipeline & scoring (`0–100`), viewing scheduler with Google Calendar links, and deal closing with multi-agent commission splits |
| **Phase 3** | Tenants, leases, invoicing, payments, receipts, owner statements | ✅ **COMPLETED (local / mock-provider scope)** | **93.29%** overall statements; **38/38** unit/integration tests + **1/1** browser workflow | Tenant KYC, validated lease lifecycle, PDF agreements/receipts, deposits, inspections, recurring rent/fees, partial payments, credits, arrears, owner statements/payout records |
| **Phase 4** | Maintenance, vendors, notifications | ⏳ Next | — | Maintenance ticket lifecycle, SLA timers, vendor directory & work orders, preventive schedules, multi-channel notifications |
| **Phase 5** | Accounting, dashboards, reports, exports | ⏳ Pending | — | Chart of accounts, double-entry ledger, budget vs actual, executive KPIs, CSV/PDF exports |
| **Phase 6** | Agent orchestration layer, approval queue, audit, kill switch | ⏳ Pending | — | Tool registry, multi-step agent runner, human-in-the-loop approval queue, cost budgets, kill switches |
| **Phase 7** | Lead, Listing, Rent, Maintenance, Lease & Insights agents + eval suite | ⏳ Pending | — | All 6 domain AI agents + 120+ scenario & adversarial prompt-injection evaluation tests |
| **Phase 8** | Tenant/owner portals, hardening, performance, docs, deployment guide | ⏳ Pending | — | Dedicated Owner & Tenant portals, OWASP security hardening, OpenAPI spec, runbook, user guides |

---

## Phase 3 Detailed Completion Log

### Delivered
- Tenant profiles with CNIC validation/uniqueness, pending/verified/rejected KYC, emergency/reference contacts, search and payment totals; ID evidence uses the existing vault.
- Lease reservations with overlap prevention, verified-KYC activation, explicit lifecycle transitions, one-time renewal escalation, security-deposit receipt/refund events, 90/60/30-day alerts and automatic expiry via the billing job.
- Actual downloadable agreement PDFs (unsigned English templates), structured JSON contracts, move-in/out checklists and HTTPS evidence links.
- Monthly rent and fixed recurring utilities/maintenance charges with transactionally idempotent generation, one-time charges, contractual grace periods/late fees, immutable reasoned credit notes, and accurate overdue aging.
- Five payment-recording methods, partial/final payments, idempotent references, rejected excess payments, atomic receipt issuance, and audited access-controlled PDF receipt downloads. Mock checkout adapters clearly label simulated payments; live charging is not enabled.
- Cash-basis owner statements honoring property ownership percentages and management fees, actual completed work-order expenses, PDF downloads, payout references, and immutable paid statements.
- Permission-aware dashboard workspaces with English/Urdu headings and RTL support. Tenant/owner Phase 3 read endpoints are scoped to their own records.
- Additive SQLite tables/indexes and corresponding PostgreSQL design models; no destructive database reset. Expanded fresh-demo fixtures preserve existing users' databases.
- `npm run billing:cycle -- YYYY-MM` one-shot scheduler entry point; browser workflow added to CI. Setup and payload examples: [`docs/PHASE3.md`](docs/PHASE3.md).

### Verification
- `npm run typecheck` and `npm run build`: passed (Next.js 15.5.27).
- `npm run test:coverage`: **38/38 passing**, **93.29%** statements, **76.71%** branches, **100%** functions.
- Real Chromium browser workflow: **1/1 passed** (tenant onboarding/KYC → lease activation → invoice → partial payment → PDF receipt → owner statement); no page errors in the tested workflow.
- In-memory CLI smoke: November cycle generated 20 PakLand invoices and zero secondary-organization invoices; late fees respected eligibility.
- PR #2 remains open and unmerged. Phases 4–8 have not been started.

### Boundaries
Live merchant charging/webhooks, electronic signature integration, dedicated portals and production hardening are not claimed as implemented. The enabled local workflow uses explicit gateway simulators or records independently verified external transactions. Standard PDF fonts do not render Urdu identities; Unicode records remain intact in JSON/UI. Remaining dependency audit advisories are recorded in `DECISIONS.md`.

---

## Phase 2 Detailed Completion Log

### What Was Built
1. **Listings & Marketing Service (`src/server/modules/listings/listings.service.ts`, `/api/v1/listings`, `/api/v1/listings/feed`, `/api/v1/listings/[slug]`)**:
   - Seeded 8 bilingual (`en`/`ur`) property listings across **Fahad Garden Housing Scheme**, **Abdullah City**, **Taj Commercial Center**, **VIP Block**, and **University Commercial Centers**.
   - Full status lifecycle (`draft → published → under_offer → closed`) with automatic underlying unit status synchronization (`sold` / `rented`) when a listing closes.
   - Deterministic SVG QR Code generator (`generateListingQrSvg`) producing self-contained data URIs (`data:image/svg+xml;utf8,...`) for print flyers and property brochures.
   - Syndication-ready portal feed exporter (`/api/v1/listings/feed?format=json|csv`) for Zameen, Graana, and partner portals.
2. **Public Property Portal & SEO Detail Pages (`src/app/listings/page.tsx`, `src/app/listings/[slug]/page.tsx`)**:
   - Multi-filter search by purpose (`For Sale` / `For Rent`), city (`Lahore`, `Rawalpindi`, `Islamabad`), unit type (`plot`, `house`, `shop`, `office`), price range (`PKR`), minimum area (`Sq.Ft.`), and bedrooms.
   - Bilingual English (`LTR`) and Urdu (`RTL`) toggle, QR Code modal, one-click shareable link copy, Next.js dynamic `generateMetadata` SEO tags, and an embedded **Web Lead Capture Form** (`POST /api/v1/public/leads`).
3. **CRM: Leads Pipeline, Scoring, Viewings & Deals (`src/server/modules/crm/crm.service.ts`, `/api/v1/crm/leads`, `/api/v1/crm/viewings`, `/api/v1/crm/deals`)**:
   - Multi-source lead capture (`web`, `whatsapp`, `phone`, `email`, `walk_in`) with dynamic lead scoring (`0–100`) and pipeline stages (`new → contacted → viewing_scheduled → negotiation → won/lost`).
   - Structured activity timeline with call notes and follow-up tasks/reminders (due dates + completion toggle).
   - Viewing scheduler with automatic Google Calendar event link generation (`buildGoogleCalendarUrl`) and automatic lead advancement to `viewing_scheduled`.
   - Deal closing engine (`createDealFromLead`) that converts the lead to a `Client`, marks the lead `won`, closes the listing/unit, validates multi-agent commission splits (`sum === 100%`), and calculates exact integer minor-unit (`PKR paisa`) payouts per agent.
4. **Interactive Dashboard Workspaces (`src/components/Phase2Workspaces.tsx`, `src/app/dashboard/page.tsx`)**:
   - Added **Listings & Marketing** (`listings`) and **CRM: Leads & Deals** (`crm`) tabs to the staff dashboard.

---

## Phase 1 Detailed Completion Log

### What Was Built
1. **Property, Building & Unit Hierarchy (`src/server/modules/portfolio/portfolio.service.ts`, `/api/v1/properties`, `/api/v1/buildings`, `/api/v1/units`)**
2. **Multi-Owner Records & Ownership Percentage Splits (`/api/v1/owners`)**
3. **Bulk CSV Import with Validation & Error Report (`/api/v1/portfolio/import-csv`)**
4. **Central Document Vault (`src/server/modules/documents/documents.service.ts`, `/api/v1/documents`, `/api/v1/documents/[id]/access`)**
5. **Interactive Phase 1 Dashboard Tabs (`src/app/dashboard/page.tsx`)**

---

## Phase 0 Detailed Completion Log

### What Was Built
1. **Master Engineering Plan & Decisions (`docs/PLAN.md`, `DECISIONS.md`)**
2. **Complete 32-Table Entity-Relationship Diagram & Schema (`docs/ERD.md`, `prisma/schema.prisma`, `src/server/db/schema.ts`)**
3. **Demo Seed Dataset (`src/server/db/seed.ts`)**
4. **Authentication, RBAC, Optional 2FA & Multi-Tenancy (`src/server/auth/`, `src/server/modules/`)**
5. **Responsive Bilingual UI (`src/app/login/page.tsx`, `src/app/dashboard/page.tsx`)**
6. **Docker, CI & Automated Tests (`Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `tests/phase0.test.ts`)**

## Post-Phase 3 correction — embedded-preview sign-in

- Reproduced the reported sign-in loop: login succeeded, but iframe cookie
  restrictions caused the dashboard's `/auth/me` request to return 401.
- Added a shared tab-scoped bearer transport with storage-denied memory fallback;
  wired sign-in, dashboard, Phase 2/3 API calls, token rotation, role/context
  switching, logout and protected file downloads through it. Cookies/RBAC retain
  their existing protections. No credentials are added to URLs.
- Sign-in now verifies the session before navigation and restores an existing
  tab session after the preview reloads. Storage exceptions no longer masquerade
  as network failures.
- Verification: **49/49 unit/integration tests**, **93.37% statement coverage**,
  TypeScript and production build passed; **4/4 Chromium browser tests** passed,
  including actual sign-in form submission, wrong-password feedback, cookie-blocked
  cross-site iframe sign-in/reload, PDF download, role switching/sign-out, and
  operation with both Web Storage APIs disabled. Phase 3 workflow still passes.
