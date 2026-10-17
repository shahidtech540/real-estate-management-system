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

### Proxy-reserved Authorization header follow-up

The first embedded-preview test covered cookie blocking but not a proxy consuming
`Authorization`. A separate browser regression removing both cookies and the
standard authorization header reproduced the reported session-establishment
error. The same signed access JWT is now also sent in `X-REMS-Access-Token` for
same-origin API calls. Server guards verify its signature and expiry just like a
bearer token; it grants no special access and does not accept unsigned user/role
claims. Standard bearer and cookie clients remain supported. Explicit caller
bearer credentials are mirrored rather than replaced with a different identity.
This header is never attached to external URLs and never placed in query strings.

## 5. Responsive dashboard chrome

- Replace the fixed-height, wrapping header with an intrinsic-height grid. Role,
  branch, language and logout controls have bounded columns and minimum hit areas;
  long account/organization text truncates instead of pushing adjacent controls.
- Below 1280px, expose all existing workspaces through a labeled native selector.
  At desktop widths, wrap navigation buttons into visible rows instead of hiding
  modules in a horizontally scrolling strip. Active buttons expose `aria-current`.
- Short, wide previews (at least 768px wide, at most 500px tall) use one compact
  header row and omit secondary account/status metadata to leave the workspace
  visible. Metadata remains present at ordinary viewport heights. The header is
  sticky only on sufficiently tall desktop viewports, never trapping short previews.
- Dashboard grid children may shrink; table overflow stays within its own panel.
  No blanket `overflow-x: hidden` is used to mask inaccessible content.

## 6. Phase 4 — maintenance, vendors and notifications

- Use existing granular maintenance/vendor permissions. Tenants create against a
  current leased unit and confirm only linked completed tickets. Coordinators
  triage and manage work, but cannot impersonate tenant confirmation. Admin
  overrides require a reason and are separately audited; owners are read-only.
- SLA deadlines are measured from original creation: emergency 1h, high 4h,
  medium 24h, low 72h. Reopening resumes the original SLA; completion stops it.
  Escalations are transactional, per-deadline idempotent in-app notifications.
- Preserve every work order and its immutable completed actual cost. Rejection
  creates a new work cycle instead of erasing the prior expense. Only real tenant
  confirmations contribute to calculated vendor ratings. Actual expenses feed
  the existing owner-statement calculation; no vendor bank payout is performed.
- Preventive schedules use UTC instants and day-based intervals. Missed occurrences
  coalesce into one due ticket, then advance on the original cadence. A durable
  occurrence key prevents duplicate tickets. Pause/resume is explicit.
- Store up to five validated raster photo data URIs (max 1MB each) privately with
  the ticket for this local SQLite phase. Browser uploads resize to 1200px. No
  arbitrary URLs, remote image fetches, SVG uploads or public photo endpoint.
- Use a durable SQLite notification outbox instead of claiming a Redis integration.
  In-app messages deliver transactionally. External channels use functional mock
  adapters and distinct `mock_sent` status. Live mode fails closed; provider
  credentials alone never enable external sends. Consent is explicitly asserted
  for human-composed external messages; automatic events are in-app only.
- Delivery uses claim leases, five attempts with exponential backoff, dead-letter
  state, admin retry and stable provider idempotency keys. The 60s serial worker
  and one-shot cron command share the app's database; run a single worker locally.
- Template interpolation is one pass over four allowlisted variables, not executable
  template code. User text is rendered plainly. English/Urdu overrides are scoped
  to the organization; all accounts have a private communications inbox.
- Self-host SIL-OFL Noto Sans Arabic, scoped to Arabic Unicode ranges, after visual
  browser checks revealed missing Urdu glyphs in sandbox fallback fonts. Preserve
  the existing Latin UI font; do not depend on Google Fonts network access.
- Phase 4 is local/mock-provider complete, not a production-security certification.
  Dedicated portals, production object storage/provider callbacks, accounting and
  agent approval/orchestration remain in their planned later phases.

## 7. User-confirmed business correction (supersedes original seed assumptions)

- Name the company/office **Fahad Real Estate**, with **Rahim Yar Khan only**.
  The five user-named projects are all in Rahim Yar Khan. Do not invent street
  addresses, map pins, legal suffixes, tax numbers, approvals or contact domains.
- Replace visible branding and use reserved `.test` demo mailboxes; retain old
  demo email aliases and internal IDs only to preserve sessions/foreign keys.
- Archive the unrelated demo organization and extra offices. Consolidate invented
  sub-project operational records into the named parents; retain units and money.
  Preserve paid statements, ledger and audit history. Parent ownership is still
  explicitly demo data, not a verified real-world ownership assertion.
- Correct misleading seeded listing/document text and clear guessed coordinates.
  Remove unrelated city filters and the regional-office creation form, not the
  completed Phase 0–4 capabilities or generic RBAC/isolation infrastructure.
- Keep the old fixture world only for test-mode security regressions. Normal app,
  CLI and production browser tests apply the corrected profile automatically.
- No real website/email domain is known; use relative listing URLs until
  `PUBLIC_SITE_URL` is configured. Back up existing SQLite before migration.
- This is a Phase 0–4 configuration correction. Do not begin Phase 5 or merge PR #2.

## 8. Phase 5 accounting defaults (user authorized after business correction)

- Accrual property-operations ledger, separate from corporate statutory accounts;
  do not double count cash-basis owner statements or CRM commission estimates.
- Balanced immutable two-line journals; source-transaction hooks, atomic/idempotent
  backfill, reserved AR/AP/deposit controls and reasoned reversals. No editing posted
  history. Snapshot owner allocation with exact integer largest-remainder rounding.
- Missing historical receipt evidence goes to **legacy settlements clearing**, not
  invented cash. Display its amount and posting discrepancies prominently.
- Maintenance accrues to payable; explicit full vendor settlement records cash
  movement but never initiates a transfer. Expenses support private receipt uploads.
- Actual date scopes versus full-month budgets; current operational KPIs are labeled
  as current, unknown vacancy dates stay unknown. Historical fee date limitations,
  consolidated owner payouts and report definitions are explicit in docs/PHASE5.md.
- CSV formula protection, genuine XLSX (fflate ZIP, inline text), English PDF with
  Unicode-preserving alternatives; exports never silently truncate the ledger.
- Scheduled reports deliver private personal in-app snapshots only, with fresh RBAC,
  missed-run coalescing and daily/weekly/monthly intervals. External delivery stays off.
- User subsequently authorized **finishing Phase 5 and continuing directly to Phase 6**.
  PR #2 remains unmerged. Phase 7 still requires a later authorization.

## 9. Phase 6 orchestration defaults

- Working local human-authored structured-plan adapter, no fabricated LLM usage.
  Natural-language reasoning/domain agents remain Phase 7; all nonlocal planner modes
  fail closed. There is no asynchronous external operation inside transactions.
- Strict versioned allowlisted tools. All engine writes require independent review,
  even when an admin initiates them. Suggest-only agents cannot write. No external
  message, deletion, arbitrary SQL/network/shell or unsupported operation is registered.
- Persist immutable plan/intent and cursor. Use nested savepoints so source effects,
  ledger/audit writes and cursor/result commit together. Test separate workers racing
  an approved credit; do not rely solely on repeated sequential idempotency tests.
- Bind approval to exact input, tool/version and source snapshot hash; reject stale
  balances/ownership/vendor state. Recheck fresh creator and reviewer permissions.
  Owners do not inherit full-org engine data via their existing approval permission.
- Per-org/per-agent kill terminally stops unexecuted work, preserving completed
  history. Re-enable only permits new runs. No promise to interrupt/undo in-flight
  synchronous source transactions. Cancellation/rejection/failure are terminal.
- Provider costs are zero for local plans; recorded budgets are enforced, alongside
  cost-independent daily attempt and per-run step quotas. Paid async provider budget
  reservation is explicitly required before a future provider can be switched on.
- Financial timestamps and receipt/maintenance date scopes use the Karachi business
  date consistently; historical paid owner snapshots are never rewritten.
- Static Prisma/WASM and Compose validation is now executable in CI. Docker runtime
  execution remains unavailable. No production-security certification is asserted.
- Historical Phase 6 checkpoint: stopped and waited. Phase 7 was subsequently
  authorized; current checkpoint is documented in section 10. Do not merge PR #2.

## 10. Phase 7 domain-agent defaults

- User authorized Phase 7. Implement all six as source-backed local rules/retrieval
  on durable Phase 6 runs; do not fabricate live LLM reasoning/tokens, embeddings,
  OCR, integrations, verified prices or legal conclusions. Nonlocal modes fail closed.
- Guided English/Urdu workflows plus strict assessment contracts, structured findings,
  citations, warnings and persisted proposals. Read assessment never changes business
  records; each proposal creates a separate independently approved write plan.
- Use org/slug lookup, not hardcoded seed agent IDs. Preserve custom allowlists and
  all existing administrator controls; extend untouched defaults once, additively.
- Bind derived proposals to immutable first-level expected source hashes before
  submission and staging, retaining approved-source rechecks at execution. Never
  accept replacement proposal arguments from clients. Fresh secondary permissions
  also gate cached financial/document outputs and approval payloads.
- Reuse existing CRM scoring/stage vocabulary and conflict-check explicit viewing
  times. Listing drafts use recorded asking prices and never publish or syndicate.
  Sparse comparables abstain; asking medians are not market appraisals.
- Rent illustrations conserve exact paisa, do not agree dates or fabricate receipt
  evidence. Reminders are courteous idempotent in-app messages only; no fees, bank
  verification, external sending or automated legal action.
- Maintenance is conservative safety advice, not diagnosis/credential verification.
  Emergency users must contact emergency services immediately, never wait for agent
  approval. Reject automatic priority downgrades; dispatch requires an explicit time.
- Lease text extraction is anchored stored text, not PDF/OCR. Offers are immutable
  private unsigned nonbinding artifacts, only within the current 0–90-day window;
  no actual lease renewal, refund, damage deduction or financial source changes.
- Insights supports typed current metrics, accrual finance or bounded Unicode lexical
  retrieval of latest authorized source excerpts. It abstains unsupported questions;
  no predictive forecasts or model-based semantic-search claim. Legacy clearing is
  never cash. Financial filters are explicit, not inferred from arbitrary prose.
- Keep separate-reader/initiator permissions. Do not seed extra privileged demo users
  or weaken independence: admin-initiated lease writes require a second authorized
  administrator created through existing user management.
- Run 125 named local source-backed/adversarial evaluations plus engine integration
  and browser regressions. Record defaults/limitations in docs/PHASE7.md.
- Stop at Phase 7; do not start Phase 8 or merge PR #2 without authorization.


## Phase 8 — authorized 2026-10-15, personal portals / operations

- User authorized the next phase after Phase 7. Finish Phase 8 completely, then
  stop; keep branch/PR #2 open and unmerged. No implicit next-phase authorization.
- Preserve Fahad Real Estate / one RYK office. Existing additive schemas retain
  source money/history. Restored workspace has no prior runtime database: identify
  `data/phase8-demo.sqlite` as a fresh demo, never recovered business history.
- Personal access derives from current role/org/active linked profile, not client
  IDs or matching emails. Explicit administrator linkage with matching-role active
  accounts is audited; absent links mean empty records. Staff collection access
  is separate from owner/tenant consent UI. Preserve secondary domain permissions.
- Default page/limit 1/20, maximum 50; no unbounded personal collections. Owner
  whole-property invoice balance is not pro-rata payout. Staff consent/onboarding
  option lists are bounded; use known IDs through privileged API beyond UI limits.
- Consent is an immutable source-hashed nonbinding acknowledgement only. A stale
  source needs a fresh request; final decisions cannot be edited. Never execute
  money/contracts or bypass independent staff/agent approvals after owner consent.
- Keep 15-minute access / 7-day rotating refresh; revoke all account sessions on
  authenticated logout, with current permissions/status/token version on each call.
  Preserve legacy deterministic demo hashes; new passwords use 600k PBKDF2.
- Stream JSON with 1 MiB object-only bound, retain agent 64 KB checks; production
  error responses omit internals. Explicit signed header requests are not cookie
  CSRF. Compare browser target Host for Next bound URLs and allow exact configured
  origins for trusted TLS proxies; do not trust forwarded IP as authorization.
- Fixed-window persistent limits are modest same-office defaults, not an edge
  anti-DDoS service. Runtime CSP permits inline Next code; production framing is
  self-only by default, bare wildcard rejected. Demo allows Arena embedding.
- REMS_DEPLOYMENT=production is separate from the Next build NODE_ENV. It requires
  explicit DB/distinct strong secrets, refuses demo accounts/implicit seeding,
  hides initial-render demo controls and health counts. Production user creation
  requires an explicit 14+ character password and a non-demo email.
- Add an absent-path production bootstrap (one admin/RBAC/RYK office/local agents,
  zero inventory/money), verified SQLite online backup CLI and documented staged
  upgrade/recovery. No placeholder live Postgres/Redis/S3/provider switch or invented
  domain. Docker non-root runtime keeps tsx CLIs; design services are opt-in only.
- Next 15.5.28/Vitest 4.1.11/PostCSS patched graph. Runtime audit zero at checkpoint;
  full graph retains five high Tailwind/braces build-chain reports, not full-zero.
  The regenerated lock installs with npm 10; no npm 11 requirement remains.
- Query benchmark uses 10k extra synthetic invoices/50 bounded reads in-memory,
  conservative 1000ms p95 gate; not a concurrent production SLA. Browser tests use
  disposable databases. SPA role readiness uses explicit UI assertions, not
  network-idle waits affected by unrelated Next prefetch streams.
- Route-complete OpenAPI inventory plus strict new portal request schemas; do not
  falsely advertise complete strict schemas for every historical DTO. Static
  validator checks actual route/method coverage and references.
- No security/legal certification, live payment/outbound/model/OCR, automatic
  contract execution, bank verification or historical-data recovery is claimed.

## Interactive Plot Map — Phase A (2026-10-17)

- Latest main pulled fast-forward-only on the active feature branch; user authorizes
  Phase A only, with a plan first and a testing stop after every phase. No Phase B
  UI/calibration/publish work, booking actions or feature PR merge yet.
- `properties` are projects. Do not create a parallel projects table or mutate/link
  the existing `units`, leases or ledger. Additive/idempotent SQLite migration plus
  Prisma design models; cross-org references and integer money checks in new tables.
- Keep canonical `plots` unique per project/number, and per-version candidate/geometry
  snapshots separately. Draft duplicate numbers are reviewable, not silently merged.
  Re-upload inserts drafts and computes diff; canonical plots/bookings/sales remain
  untouched until a later explicitly confirmed/published workflow.
- Store original/sanitized SVG as private SQLite BLOB assets with opaque `sqlite:`
  locators in the specified path columns. This matches the actual local architecture,
  makes assets part of atomic transactions/online backups, and avoids public files
  or orphaned writes. Never expose an original SVG through HTTP.
- Phase A raw upload API is administrator-role + admin:manage + properties:write,
  freshly checked. 10 MiB streamed UTF-8 image/svg+xml; existing JSON cap unchanged.
  Read draft endpoints are equally private; public map privacy comes in later phases.
- DOMPurify 3.4.17 + jsdom 30.1.3 maintained server sanitizer; streaming saxes preflight
  limits depth/nodes before DOM allocation. Remove all CSS/style/URL/escaped-attribute,
  external-resource, animation, script/event and foreignObject mechanisms. Regenerate
  all interaction IDs; keep sanitized source identifiers only as data.
- Transform/path processing uses svgpath; 32 samples per normalized curve/arc segment.
  Closed polygon rings, evenodd/nonzero fills and centroid/bounds/area are SVG-unit
  approximations, not calibrated/official survey measurements. Rounded rects currently
  use their rectangular footprint; overlap/self-intersection resolution stays in B.
- Per-project regex uses bounded RE2JS patterns, not user-supplied native backtracking.
  Explicit attributes win; numbered groups own children; fallback chooses the smallest
  containing unclaimed closed shape. Ignore known nonplot layers/large fallback shapes;
  keep warnings rather than inventing unlabeled bookable plots.
- Enforce explicit XML/shape/point/comparison limits; docs describe accepted SVG subset.
  8/8 on each supplied fixture is not an arbitrary-file 95% accuracy certification.
- Sample imports are opt-in/demo-only and seed draft candidates, not live inventory.
  No automatic production fixtures. Fresh preview DB is labeled synthetic; prior
  absent runtime history is not represented as recovered data.
- New jsdom raises supported Node to ^22.22.2 / ^24.15 / >=26; tested Node 22.22.3.
  Runtime Next externalizes jsdom/DOMPurify to preserve their package loading.
- Later-transaction schema fields do not imply implemented money, CRM, notifications,
  bookings, hold expiry, sale/resale or agent tools. Stop at the Phase A boundary.

## Interactive Plot Map — Phase B (2026-10-17)

- User's “continue” authorizes B only. Add `PlotMapWorkspace` to existing dashboard,
  administrator navigation and server-fresh admin/manage/property-write guard. No
  new visitor/public endpoints, Phase C map tools, booking/billing or agent work.
- Additive Phase A upgrade: map revision/published time, candidate exclusion/review
  JSON/fill rule, explicit official area unit, per-org area defaults. No data reset.
  Legacy Phase A holes infer fill rule from stored filled area when rule was absent.
- Calibration is ratio or two distinct SVG points + known feet/meters distance.
  Default marla is 272.25 sq ft, configurable, kanal=20 marla. Org display defaults
  are reused for future maps, while calibration remains a map-specific snapshot.
  Official/price units bind when entered; display recalibration does not relabel them.
- Longest-edge-oriented extents and edge lengths are calculated approximations;
  optional nearby parallel roads infer adjacent-side corner, facing only if north-up
  is declared. Ambiguous/complex road cases remain unknown; official values separate.
- `polygon-clipping` normalizes compound/group fills (including child hole rules),
  then handles overlap diagnostics, union merges and
  vertical/horizontal SVG-axis splits with holes. Edited outlines get actual safe
  generated SVG path IDs; source originals remain immutable private BLOBs. Split
  official area/dimensions/total/corner/facing/status are cleared, not duplicated.
- CSV UTF-8 is the Excel exchange (Save As CSV); not claiming native XLSX. Strict
  named headers, exact unique plot-number matching, blank=no change, whole-batch
  rollback, integer minor money and formula-safe export. Clear overrides via UI/API.
- All writes require revision compare-and-swap under BEGIN IMMEDIATE; publish also
  compares the currently published baseline. No last-writer-wins silent overwrites.
  Published/archived review is read-only, prior publication archived atomically.
- Keep existing data defaults true; preserve stable canonical IDs, financial/booking/
  sale/ownership/resale references. Explicit draft metadata overrides apply on publish.
  Replacing metadata is allowed only for unencumbered plots, never replacing identity.
  Protected removals/renumbering/merge/split are blocked; unencumbered removals require
  diff acknowledgment and soft archive. Booking/sale statuses cannot be fabricated
  through review/CSV. Source leases/units/invoices/ledger remain untouched.
- Duplicate/missing numbers, calibration, protected removals and overlap-comparison
  budget are blocking. Geometry/source warnings require explicit audited acceptance
  reason; bounded diagnostics include truncation summaries. Acceptance never bypasses
  blocking business or tenant-integrity checks.
- New review/CSV/publish operation quotas are 60/user/org/15min. Phase A raw SVG limit
  and 20-upload quota remain unchanged. Assets stay private and SVG sandbox CSP stays
  intact; only trusted, server-sanitized bytes reach the review markup rendering sink.
- Testing uses isolated seeded demo databases. Preview remains the previously labeled
  synthetic file; this does not restore absent business history. Stop for user testing
  after B, keep the existing feature PR draft/unmerged, await C authorization.
