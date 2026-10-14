# Phase 3 — Tenants, leases and billing

## Run

Node.js 22+ is required for the existing native SQLite engine.

```bash
npm ci
npm run db:seed
npm run dev
```

`db:seed` initializes a new database; it is not a reset command. Existing databases
receive additive tables/indexes on startup and retain their existing records.
To explore the expanded Phase 3 fixtures without deleting your old database:

```bash
SQLITE_DB_PATH=./data/phase3-demo.sqlite npm run dev
```

The new demo includes 20 tenants/leases, 240 invoices, October payment receipts,
renewal windows, a partial payment and overdue balances in all aging buckets.
The seed is a reproducible October 2026 snapshot, not a clock frozen in production.

## UI walkthrough

1. Sign in at `/login` as `admin@pakland.pk` / `Password123!`.
2. Open **Tenants & Leases**. Onboard a tenant, verify KYC, then draft a lease on
   an available unreserved unit. Upload supporting ID records through Document Vault.
3. Click its lease number. Progress `draft → pending_signature → active` after
   independently confirming execution. Download the Agreement PDF. Record the
   security deposit and a move-in checklist, with condition notes/photo links.
4. Open **Rent & Payments**. Select the lease's billing month, generate the rent
   cycle, optionally add one-time or recurring utilities/maintenance charges.
5. Record a verified payment with a unique transaction reference. Partial payments
   leave the remaining balance; download the actual PDF receipt in payment history.
6. Apply eligible late fees and issue reasoned credit notes where appropriate.
   View actual overdue balances in the four aging buckets.
7. Generate owner statements for the month in which payments were received.
   Download statement PDFs; record a payout only after independently executing it.
8. For renewal, select the lease and extend its end date. Rent escalates according
   to its configured percentage. Termination/expiry releases the unit; a refund
   may then be recorded up to the held deposit balance.

Accountants can invoice, record payments, issue receipts and generate statements.
Only admins have tenant/lease write permissions by default. Tenants and owners
have restricted read access to their own linked records, not the full organization.

## API map

All amounts are **integer paisa** (`PKR * 100`), not PKR floats.
All routes are under `/api/v1` and use existing HttpOnly cookies or bearer tokens.

| Route | Methods | Purpose |
|---|---|---|
| `/tenants` | GET, POST, PATCH | Search/history, onboarding, KYC attestation |
| `/leases` | GET, POST, PATCH | Filtered register, draft/create, lifecycle/renewal |
| `/leases/:id/agreement` | GET | PDF; append `?format=json` for structured contract |
| `/leases/:id/checklist` | GET, PUT | Move-in/out evidence and lease events |
| `/leases/:id/deposit` | POST | Receive/refund deposit (not rental income) |
| `/billing/invoices` | GET, POST, PATCH | Invoice register, cycle, recurring rules, fees/credits |
| `/billing/payments` | GET, POST | Payment history and atomic receipt issuance |
| `/billing/checkout` | POST | Staff-only **mock** gateway simulation |
| `/billing/receipts/:id` | GET | Access-controlled, audited PDF receipt |
| `/billing/arrears` | GET | 1–30 / 31–60 / 61–90 / 90+ day overdue balances |
| `/billing/statements` | GET, POST, PATCH | List/generate owner statements and record payouts |

### Common payloads

```json
{"action":"rent_cycle","periodMonth":"2026-11"}
```

```json
{"action":"recurring_charge","leaseId":"lease_1","type":"utilities","amountMinor":250000,"startMonth":"2026-11","endMonth":"2026-12"}
```

```json
{"invoiceId":"inv_17_12","method":"bank_transfer","amountMinor":100000,"referenceNumber":"BANK-UNIQUE-0001"}
```

```json
{"action":"credit","invoiceId":"inv_17_12","creditMinor":10000,"reason":"Approved service adjustment"}
```

```json
{"action":"late_fees"}
```

Statements: POST `{"periodMonth":"2026-10"}`; PDF GET
`/billing/statements?format=pdf&id=<statementId>`; payout PATCH
`{"id":"<statementId>","reference":"BANK-PAYOUT-0001"}`.

## Schedule recurring billing

```bash
npm run billing:cycle             # Pakistan's current month
npm run billing:cycle -- 2026-11  # explicit monthly cycle
```

Run daily using cron or your deployment scheduler (for example 00:15 Pakistan time).
The job processes each active organization, updates lease expiry states, generates
eligible monthly rent/recurring charges, and applies contractual late fees.
It is safe to repeat. A failed run exits nonzero and transactions prevent a partial
invoice batch. It never sends a payment instruction or external notification.
Notification delivery remains Phase 4.

## Verification

```bash
npm run typecheck
npm run test:coverage
npm run build
npx playwright install --with-deps chromium
npm run test:e2e
```

The Playwright config starts the production build with a disposable SQLite database
if no existing local server is available. Stop any server using real records first:
the browser test deliberately creates a tenant, lease, invoice and payment.
CI always starts an isolated database and runs the browser test after the build.
Unit/integration tests use fresh in-memory databases and a fixed clock.

## Explicit boundaries

- No live wallet/card charging, provider webhook settlement or automated bank payouts.
  Mock transactions are labeled; `PAYMENT_PROVIDER_MODE=live` returns 503.
- Contract PDFs are English unsigned templates. Unicode identities are preserved
  in records/JSON; standard PDF fonts replace unsupported characters in the PDF.
- SQLite is the active runtime. PostgreSQL Prisma models document the future
  repository implementation; setting `DATABASE_URL` alone does not migrate services.
- Owner expenses use actual completed work orders, not invented reserves. The
  maintenance UI is Phase 4; expense ledger/report integration is Phase 5.
- Existing seed-paid historical invoices predate the detailed October payment
  fixtures. Statements deliberately use actual payment rows, not invoice paid totals.
- Current dependency audit advisories and broader deployment security hardening
  remain tracked in `DECISIONS.md` for Phase 8. Do not deploy demo credentials.

### Embedded preview sign-in

The dashboard supports preview browsers that block third-party session cookies.
A short-lived access token is retained only in this tab and sent with authenticated
API calls/downloads. A preview refresh can resume that tab session. If all browser
storage is disabled, sign-in still works during client navigation, but a full page
reload requires signing in again. Refresh tokens are never stored by JavaScript;
when refresh cookies are blocked, sign in again after the access token expires.
