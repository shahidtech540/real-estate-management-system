# Fahad Real Estate — Rahim Yar Khan

Property management for **Fahad Real Estate**, with a single office in
**Rahim Yar Khan, Punjab, Pakistan**.

## Projects

All five projects are in Rahim Yar Khan:

1. Fahad Garden Housing Scheme
2. Abdullah City
3. Taj Commercial Center
4. VIP Block
5. University Commercial Centers

Exact street addresses, map coordinates, legal approvals and the company's real
email/domain/phone have **not** been supplied. None are asserted by this setup.
The units, owners, customers, prices and financial transactions remain **demo
records**, not a verified inventory or legal/financial representation of the business.

## Run locally (Node.js 22.22.3+ recommended in the 22.x series)

```bash
npm ci
npm run db:seed
npm run dev
# Second terminal, using the SAME database path/environment as the app:
npm run maintenance:worker
# Optional separate terminals, using the SAME database:
npm run accounting:sync  # one-time existing-source import (safe to repeat)
npm run reports:worker
npm run agents:worker
```

Open `http://localhost:3000`. SQLite at `./data/rems.sqlite` initializes and migrates
automatically. To use a different file, export `SQLITE_DB_PATH` in both terminals.
Production build: `npm run build`, then `npm start`.

### Demo sign-in

Password for all six demo roles: **`Password123!`**.

| Role | Demo email |
|---|---|
| Administrator | `admin@fahadrealestate.test` |
| Sales agent | `agent@fahadrealestate.test` |
| Accountant | `accountant@fahadrealestate.test` |
| Maintenance coordinator | `maintenance@fahadrealestate.test` |
| Owner | `owner@fahadrealestate.test` |
| Tenant | `tenant@fahadrealestate.test` |

`.test` is a reserved demo domain, not an operational company email address.
Original `@pakland.pk` sign-ins remain aliases for the six existing demo users.
The unrelated secondary demo company is retired and no longer available to sign in.

## Current capabilities

Phases 0–6 are complete for local/mock-provider use:
- Role-based access, organization isolation, optional TOTP and English/Urdu RTL.
- Properties/units, ownership splits, document vault and CSV import.
- Listings/public enquiries, CRM pipeline, viewings and commission tracking.
- Tenants/leases, rent invoices, payment records, PDF receipts and owner statements.
- Photo maintenance tickets, vendor work orders, costs, tenant confirmations,
  SLA alerts, preventive schedules and a notification inbox/outbox.
- Accrual accounting, immutable double-entry journals, expenses/receipts, budgets,
  financial/operational reports, CSV/XLSX/PDF exports and private scheduled digests.
  See [`docs/PHASE5.md`](docs/PHASE5.md).
- Durable local structured-plan orchestration, independent approval queues, fresh
  permission checks, immutable intent/source hashes, budgets and kill switches.
  See [`docs/PHASE6.md`](docs/PHASE6.md). The six source-backed local assessments are now available in [Phase 7](docs/PHASE7.md).

At narrow widths use the **Workspace** dropdown. Existing rent records and unit
identities survive the business correction. The five invented sub-projects are
archived and their operational inventory consolidated under the five named projects.
Paid statements, ledger records and audit history are not rewritten. See
[`docs/BUSINESS_PROFILE.md`](docs/BUSINESS_PROFILE.md) for migration details.

**External payment and email/SMS/WhatsApp adapters are mock implementations.**
`mock_sent` is simulated delivery. Live delivery fails closed until a validated
provider adapter is implemented. No real charges, bank payouts or messages are
performed by the mocks. Local accounting, bounded agent orchestration and personal portals are implemented.
Live providers and production security certification are not implied.

## Tests

```bash
npm run typecheck
npm run test:coverage
npm run build
npx playwright install --with-deps chromium
CI=true npm run test:e2e
```

Security regression suites intentionally retain the original multi-organization
fixture world under `NODE_ENV=test`. Business-profile tests explicitly migrate it
and check the corrected setup. Normal demo/browser workflows use the corrected
Fahad Real Estate profile; the production smoke provisions a separate empty fixture; no old branches/company are exposed by the normal app.

## Deployment notes

Demo Docker: `docker compose up --build`; app and all three workers share
a persistent SQLite volume. Docker execution was unavailable in the development
sandbox. PostgreSQL, Redis and S3 settings remain deployment designs, not enabled
runtime switches. Use secure deployment-specific secrets; the demo is not a
production-security certification.

Set `PUBLIC_SITE_URL` to your actual deployed origin for absolute QR/feed links.
Until then exports use relative listing paths rather than an invented domain.

## Documentation / next checkpoint

- [Business setup and safe migration](docs/BUSINESS_PROFILE.md)
- [Progress](PROGRESS.md) and [decisions](DECISIONS.md)
- [Architecture](docs/PLAN.md) and [data model](docs/ERD.md)
- [Phase 3 walkthrough/API](docs/PHASE3.md)
- [Phase 4 walkthrough/API](docs/PHASE4.md)

**Phases 0–8 are complete for their documented local scope. PR #2 remains unmerged.**

## Phase 7: six domain agents

Open **Agent orchestration → Six domain agents** for lead matching, bilingual listing
copy, rent reconciliation/reminders, maintenance safety triage, lease text/offer
review and cited portfolio insights. Queue an assessment, advance it (or run the
same-database agent worker), inspect citations and request independent approval
for a persisted proposal. No silent record changes, publication or contract execution.

This is working **local rules / lexical retrieval**, not a configured live LLM,
verified appraisal, neural semantic search or OCR. Offers remain unsigned/nonbinding;
reminders are in-app only. An administrator cannot approve their own write.

```bash
npm run test:agents  # 125 evaluations + 20 guarded-engine integration tests
```

See [Phase 7 guide and limitations](docs/PHASE7.md). **Phase 8 complete; PR #2 was merged. Subsequent authorized plot-map work is tracked below.**


## Phase 8: owner and tenant portals

Visit **`/portal/tenant`** or **`/portal/owner`** after signing in with the matching
role (demo emails above, password `Password123!`). Staff opens **`/portal`** for
source-bound owner consent; administrators can explicitly link/unlink personal
accounts after verifying identity. No automatic business write follows consent.
Guided English/Urdu navigation, bounded source records, tenant repairs, statement/
unsigned-lease PDFs and private in-app messages are implemented.

```bash
npm run test:portals
npm run perf:portals       # 10,000 synthetic in-memory invoices, no business DB touched
npm run validate:api
npm run audit:production
npm run test:e2e:production # after build + Chromium install
```

Real deployment is **opt-in**: `REMS_DEPLOYMENT=production`, strong distinct signing
secrets, persistent database and HTTPS. Use `npm run db:provision` only for an absent
production path with environment-supplied real admin credentials. It creates zero
inventory/financial fixtures. `npm run db:backup -- <new-path>` creates a verified
online SQLite backup. Do not treat `NODE_ENV=production` alone as the security switch.

See [portal/user/security guide](docs/PHASE8.md), [deployment/recovery runbook](docs/DEPLOYMENT.md)
and [API](docs/API.md) / [OpenAPI](docs/openapi.json). The preview is a **fresh demo**,
not recovered historical data. Runtime audit is clean at this checkpoint; the full
build graph still has five documented high Tailwind/braces advisory reports.
**Phase 8 checkpoint complete. Further phases and PR merges require explicit authorization; see current plot-map progress below.**


## Interactive Plot Map — Phases A–D

Phase A ingestion, **Phase B administrator review/publish**,
**Phase C interactive viewer** and **Phase D private booking workflow** are available.
Select **Plot Map** in the dashboard as an administrator, then **Review & publish**
or **Published map**. The viewer supports status patterns, zoom/pan/pinch, search,
filters/counts and hover information. Click/tap/Enter opens a transactional admin
booking form or private booking details, with real PDFs, unpaid token invoice, CRM
lead, audit and in-app notices.
Admin uploads create private, versioned draft candidates and a diff. Calibration,
number/geometry repair, official overrides and CSV exchange stay draft until explicit
validated publication. Existing rental units, contracts and financial history remain
unchanged. Plot bookings create separate buyer token obligations, never fake rental
leases/receipts, received cash, sale revenue or ledger postings.

```bash
npm ci
npm run test:plot-maps
npm run plot-maps:sample -- prop_1 samples/plots-explicit.svg
```

Try all three `samples/plots-*.svg` fixtures (eight plots each). See
[Phase D booking/testing guide](docs/PLOT_MAP_PHASE_D.md),
[Phase C viewer/testing guide](docs/PLOT_MAP_PHASE_C.md),
[Phase B review/publish walkthrough](docs/PLOT_MAP_PHASE_B.md),
[Phase A upload/API guide](docs/PLOT_MAP_PHASE_A.md) and
[SVG preparation guide](docs/SVG_PREPARATION.md). Node 22.22.3 is tested; the new SVG
sanitizer DOM requires at least 22.22.2 in that series. Review/calibration/publishing
is implemented in B, admin published viewing in C, and human-admin booking in D.
Sold/resale ownership actions, public-role privacy/access, automatic live updates
and hold-expiry worker are Phase E and await authorization. Agent tools remain F.
**Stop after D for user testing; feature PR #3 remains draft and unmerged.**
