# Project Build Progress (`PROGRESS.md`)

## Current business profile correction

The user confirmed **Fahad Real Estate** with **one Rahim Yar Khan office**;
all five named projects are in Rahim Yar Khan. This supersedes the earlier demo
company/branch/project assumptions in the historical logs below.

- Rebranded login/dashboard/public portal, metadata, PDF producer and demo accounts.
- One office and five projects in normal runtime; unrelated company suspended,
  extra offices/sub-projects archived, retained inventory consolidated safely.
- Removed guessed coordinates/addresses, old-city filters and false approval claims.
- Preserved unit identities, leases, invoices, payments and immutable paid statements.
- Six business-profile integration tests and three production browser checks added;
  **90/90 unit/integration tests** and **19/19 browser tests** pass, with production
  build/typecheck green (Phases 0–4 only).
- Local backup made before preview migration. Details: [`docs/BUSINESS_PROFILE.md`](docs/BUSINESS_PROFILE.md).
- **Phases 5 and 6 completed for their documented local scopes. Phase 7 not started. PR #2 remains unmerged.**

## Phase Summary Matrix

| Phase | Scope | Status | Test Coverage | Checkpoint Deliverable |
|---|---|---|---|---|
| **Phase 0** | Plan, ERD, repo scaffold, Docker, CI, auth + RBAC + multi-tenancy | ✅ **COMPLETED** | **93.26%** | Multi-role login (`admin`, `agent`, `accountant`, `maintenance_staff`, `owner`, `tenant`), TOTP 2FA, RBAC matrix, multi-tenant & branch isolation, 32-table ERD & seed dataset |
| **Phase 1** | Properties, units, owners, documents vault, CSV import | ✅ **COMPLETED** | **91.44%** | Portfolio CRUD, hierarchy (`Property → Building → Unit`), multi-owner percentage splits (`<=100%`), Central Document Vault (`v1→v2` versioning, expiry alerts, view/download audit logs), Bulk CSV import with dry-run & row-by-row validation error report |
| **Phase 2** | Listings, public site, CRM (leads, viewings, deals) | ✅ **COMPLETED** | **91.91%** (15/15 tests passing) | Bilingual public marketplace (`/listings`), SEO detail pages (`/listings/[slug]`), SVG QR code generator, JSON/CSV portal syndication feeds, public Web Lead Capture form, CRM Lead pipeline & scoring (`0–100`), viewing scheduler with Google Calendar links, and deal closing with multi-agent commission splits |
| **Phase 3** | Tenants, leases, invoicing, payments, receipts, owner statements | ✅ **COMPLETED (local / mock-provider scope)** | **93.29%** overall statements; **38/38** unit/integration tests + **1/1** browser workflow | Tenant KYC, validated lease lifecycle, PDF agreements/receipts, deposits, inspections, recurring rent/fees, partial payments, credits, arrears, owner statements/payout records |
| **Phase 4** | Maintenance, vendors, notifications | ✅ **COMPLETED (local / mock-provider scope)** | **84/84** tests; **16/16** browser checks; **94.32%** statements | Tenant photo tickets → triage → vendor work order → actual cost → tenant confirmation; SLA alerts; preventive schedules; durable notification outbox |
| **Phase 5** | Accounting, dashboards, reports, exports | ✅ Completed (property-operations / local scope) | 112 unit tests; 21 browser tests; 95.07% statements | Immutable balanced ledger, source posting/reconciliation, expenses/receipts, budgets, KPIs, CSV/XLSX/PDF, personal digests |
| **Phase 6** | Agent orchestration layer, approval queue, audit, kill switch | ✅ Completed (local structured-plan scope) | 142 unit/integration; 24 browser workflows | Versioned allowlist, durable cursor, independent source-bound approvals, budgets, fresh RBAC and org/agent kill controls |
| **Phase 7** | Lead, Listing, Rent, Maintenance, Lease & Insights agents + eval suite | ⏳ Pending | — | All 6 domain AI agents + 120+ scenario & adversarial prompt-injection evaluation tests |
| **Phase 8** | Tenant/owner portals, hardening, performance, docs, deployment guide | ⏳ Pending | — | Dedicated Owner & Tenant portals, OWASP security hardening, OpenAPI spec, runbook, user guides |

---

## Phase 6 completion checkpoint

- Delivered working local structured-plan adapter and 10 strict versioned domain
  tools; no model/network/payment-provider usage fabricated. Domain agents stay Phase 7.
- Durable ordered runs/cursor/results, request-key idempotency, independent approvals
  with exact intent/version/source snapshots, no self-review, fresh creator/reviewer
  authorization and stale-source rejection. Source effects and progress commit together.
- Per-org/per-agent controls, budgets, cost-independent quotas, terminal kill/cancel,
  trace and approval UI, bounded requests/outputs, serial CLI/worker and audited decisions.
- Tests include actual file-backed restart and two separate workers racing one approved
  credit. Browser coverage includes role-switched finance review, kill controls and RTL.
- Prisma design and Compose shared-volume configuration validated with executable CI
  checks. Docker container execution remains unavailable. See docs/PHASE6.md.
- Preserved preview DB imported **474 balanced journals / 948 lines**; repeated sync
  posted zero. All 240 invoices, 17 payments/receipts, 20 leases and other preexisting
  financial source rows match the pre-Phase-5 backup exactly; foreign keys are clean.
- Recorded cash from actual receipts: **PKR 1,597,500**; legacy clearing **PKR 20,520,000**
  is NOT verified cash. No bank receipts were invented or source records reset.
- Final verification: **142/142 unit/integration tests**, **24/24 browser tests**,
  typecheck/build/design validation green. Coverage **95.43% statements/lines**,
  **83.56% branches**, **100% functions**.
- **STOP at Phase 6. Phase 7 not started/authorized. PR #2 remains unmerged.**

## Phase 5 completion checkpoint

- Delivered accounting workspace, typed chart of accounts, paired immutable journals,
  atomic billing/deposit/maintenance/payout posting, audited reversals, exact owner
  allocation snapshots, explicit legacy clearing and organization-wide reconciliation.
- Expenses/private receipt downloads, vendor payment records, monthly budget/actual,
  financial and operational reports, authenticated CSV/XLSX/English PDF, personal
  scheduled in-app snapshots with a serial worker and permission revocation checks.
- No historical financial rows reset; no bank receipt, legal status or vacancy date
  fabricated. Boundaries, measurement definitions and run/API guide: docs/PHASE5.md.
- Typecheck/build passed, **112/112 unit/integration**, **21/21 browser**; coverage
  **95.07% statements/lines, 82.99% branches, 100% functions**.
- User explicitly authorized proceeding directly to Phase 6. PR #2 stays unmerged.

## Phase 4 Detailed Completion Log

### Delivered
- Validated, organization/RBAC-scoped maintenance requests with private raster
  photos, current-lease tenant submission, owned-property reads and ordered history.
- Triage, priority SLA deadlines, trade/availability-aware vendor assignment,
  scheduled/in-progress/completed/cancelled work orders and immutable actual costs.
- Tenant completion ratings, rejection/reopen flow, audited reasoned admin override,
  directory rates/availability, calculated ratings and paginated vendor work history.
- Preventive schedules with pause/resume, idempotent due-ticket generation and
  missed-interval coalescing; deduplicated SLA alerts and a serial 60s worker/cron CLI.
- Transactional in-app notifications; consented single-recipient email/SMS/WhatsApp
  mock adapters, durable outbox, backoff, claim recovery, dead letters and admin retry.
- Private inbox/read acknowledgements, admin delivery log, English/Urdu templates,
  responsive dashboard workspaces and locally bundled licensed Urdu font coverage.
- Non-destructive old-schema migration and corresponding PostgreSQL design records.
  Setup, role walkthrough, API examples and integration boundaries: [`docs/PHASE4.md`](docs/PHASE4.md).

### Verification
- TypeScript and production build passed. **84/84** unit/integration tests passed;
  overall coverage **94.32%** statements/lines, **80.84%** branches, **100%** functions.
- **16/16** browser tests passed: existing rent and proxy-safe sign-in regressions,
  photo ticket through role switches and rated closure, preventive scheduling,
  mock email delivery/read acknowledgement, all 14 workspaces and expanded mobile/RTL forms.
- CLI smoke on a copy of the existing demo database: one SLA escalation on the
  first run, zero repeats on the second; secondary organization remained isolated.
- Old Phase 3-schema migration preserves every invoice row; completed maintenance
  actual costs are verified in owner statements, with estimates excluded.
- Reviewed real screenshots for completed work, desktop navigation and mobile Urdu
  forms; font coverage corrected after identifying missing Urdu fallback glyphs.

### Boundaries / checkpoint
- Real external messaging is **not enabled**; `mock_sent` is visibly simulated.
  Live mode fails closed. No automatic bulk messages, payments or AI dispatch.
- SQLite is the active runtime; production hardening/dedicated portals remain later.
- Keep PR #2 open/unmerged. **Stop here; Phase 5 requires the user's “continue”.**

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
- At the Phase 3 checkpoint, PR #2 remained open and unmerged; later phase status is tracked in the matrix above.

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

### Sign-in follow-up — proxy-reserved authorization transport

The reported session-check error persisted after the cookie-only correction.
Added a regression that strips both Authorization and cookies: it reproduced the
failure before the change. The client now mirrors its signed access JWT in an
application-specific header, and server guards apply the existing token signature,
expiry, permissions and organization checks. No authentication bypass was added.
Corrected the proxy-test harness to explicitly blank cookies (removing the header
alone allowed Playwright's API cookie jar to add it back), and to finish outstanding
intercepted requests before teardown.

Verification: **52/52 unit/integration tests**, production build and **5/5 browser
tests** pass. New negative tests reject missing, forged and expired custom-header
credentials and preserve RBAC/organization isolation. The browser regression now
covers a proxy removing Authorization with cookies unavailable, including session
verification, a protected workspace, reload and logout. PR #2 stays unmerged.

## Post-Phase 3 correction — responsive dashboard UI

- Fixed the screenshot's root cause: wrapped controls escaped a fixed 64px header
  and overlapped role/status navigation. The header now sizes to its content and
  arranges controls using bounded responsive grid columns.
- Replaced the horizontal workspace scrollbar with a compact selector below
  desktop widths and wrapping, fully visible buttons on desktop. Every workspace
  remains reachable; role/branch/language/logout controls remain available.
- Added compact chrome for short, wide embedded previews, shortened status text,
  prevented grid children from widening the page, and retained Urdu/RTL behavior.
- Reviewed actual browser screenshots at 375, 768, 940, 1280 and 1440px widths,
  including the reported short-preview shape (940 × 260).
- Verification: TypeScript, production build, **52/52 unit/integration tests** and
  **12/12 browser tests** passed. Browser assertions check control containment,
  no header/context overlap, no page-level horizontal overflow, all 12 workspaces
  at mobile width in both English and Urdu, and short-preview content visibility.
- Tightened a sign-in test locator to distinguish the error message from Next.js's
  screen-reader route announcer. Authentication regressions continue to pass.
