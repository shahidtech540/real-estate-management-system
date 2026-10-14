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

## Run locally (Node.js 22+)

```bash
npm ci
npm run db:seed
npm run dev
# Second terminal, using the SAME database path/environment as the app:
npm run maintenance:worker
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

Phases 0–5 are complete for local/mock-provider use:
- Role-based access, organization isolation, optional TOTP and English/Urdu RTL.
- Properties/units, ownership splits, document vault and CSV import.
- Listings/public enquiries, CRM pipeline, viewings and commission tracking.
- Tenants/leases, rent invoices, payment records, PDF receipts and owner statements.
- Photo maintenance tickets, vendor work orders, costs, tenant confirmations,
  SLA alerts, preventive schedules and a notification inbox/outbox.
- Accrual accounting, immutable double-entry journals, expenses/receipts, budgets,
  financial/operational reports, CSV/XLSX/PDF exports and private scheduled digests.
  See [`docs/PHASE5.md`](docs/PHASE5.md).

At narrow widths use the **Workspace** dropdown. Existing rent records and unit
identities survive the business correction. The five invented sub-projects are
archived and their operational inventory consolidated under the five named projects.
Paid statements, ledger records and audit history are not rewritten. See
[`docs/BUSINESS_PROFILE.md`](docs/BUSINESS_PROFILE.md) for migration details.

**External payment and email/SMS/WhatsApp adapters are mock implementations.**
`mock_sent` is simulated delivery. Live delivery fails closed until a validated
provider adapter is implemented. No real charges, bank payouts or messages are
performed by the mocks. Agent orchestration, full accounting, dedicated portals
and production hardening remain in their later phases.

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
and check the corrected setup. Production and browser tests always use the actual
Fahad Real Estate profile; no old branches/company are exposed by the normal app.

## Deployment notes

Docker scaffolding: `docker compose up --build`; app and maintenance worker share
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

**Phase 5 is on hold** until the user approves continuing. PR #2 remains unmerged.
