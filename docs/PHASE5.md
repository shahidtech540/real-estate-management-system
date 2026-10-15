# Phase 5 — property operations accounting and reporting

Use **Accounting & reports** as administrator/accountant. Owner/tenant portals do
not expose the organization ledger; their existing scoped statements remain available.

## Run

```bash
npm ci
npm run db:seed
npm run accounting:sync  # explicit, idempotent import of existing source history
npm run dev             # or: npm run build && npm start
npm run reports:worker  # separate terminal, SAME SQLITE_DB_PATH
# cron alternative: npm run reports:cycle
```

Back up the SQLite file first. Never reset a preserved DB. New invoice creation,
credits, late fees, rent receipts, deposits/refunds, completed work-order costs and
owner payout records post within their source transaction. Synchronization imports
older records and is all-or-nothing. Repeating it creates no duplicate journals.

## Accounting defaults and boundaries

- **Property operations accrual ledger, not Fahad corporate statutory accounts**.
  Rental charges include late fees; credits reverse the same income category.
  Corporate commission tracking stays in CRM, not assumed paid income here.
- Money is integer paisa; paired journals always have one equal debit and credit.
  BigInt largest-remainder allocation preserves every paisa and records ownership
  **at posting time**. Unknown/unallocated shares stay unallocated. Reversals copy
  original integer allocations even if ownership subsequently changes.
- Posted journals, lines and allocations are immutable. Correct manual journals
  with reasoned reversals; void expenses through their own reversal workflow.
  AR/AP/security-deposit control accounts cannot be used by manual journals.
- Initial invoice accrual uses the first day of its billing month. Historical fee
  application timestamps were not recorded, so initial billed charges include fees
  in that month; this is not an independently reconstructed statutory history.
  Subsequent fee adjustments post on the current Karachi date. Credit/payment
  records use their source date. Date filters include end dates.
- Historical seed invoices have paid balances without matching receipts. Their
  difference posts **Dr 1190 legacy settlements clearing / Cr 1100 AR**, not cash.
  Only actual payment records debit 1000. No bank receipt is fabricated. A changed
  legacy gap fails reconciliation; investigate instead of silently rewriting it.
  Cash/bank is a combined recorded control balance, **not a bank reconciliation**.
  Supported opening/clearing adjustments need evidence and a unique reference.
- Completed maintenance accrues **Dr 5000 / Cr 2000**. Record a verified full vendor
  settlement **Dr 2000 / Cr 1000**; no money is transferred. Paid standalone expenses
  debit their expense category and credit recorded cash. Do not duplicate work-order
  expenses here. Partial vendor settlements are deliberately not supported.
- Security receipts/refunds use deposit liability 2100, not income. Owner payouts
  use distributions 3100, not expense/income. Consolidated owner payouts are scoped
  to the owner/organization, not falsely assigned to a single project. Generated
  owner statements do not themselves book company revenue. Newly generated unpaid
  statements include direct ledger expenses; paid snapshots remain untouched.
- Monthly budgets snapshot ownership at save time. Reports use **full monthly
  budgets for months touched**, versus actual entries in the exact selected dates.
  Owner filters use financial allocation snapshots; physical operational units are
  whole properties, not prorated counts. Occupancy excludes sold units from the pool.
- Arrears/occupancy/vacancy are **current as of today**, not historical reconstructions.
  Historical vacancy start dates remain unknown until a real status transition.
  Rent billed/settled totals use billing months touched; receipts use payment dates.
  Lead conversion is won/created-date cohort; agent commissions are recorded splits,
  not assumed commission receipts. Maintenance cost per unit uses physical inventory.

## Reports, uploads and digests

Trial balance (opening/activity/closing), income/expense, balance sheet, cash
movement, AR/AP controls, budget/actual, occupancy, arrears, vacancy, lead conversion
and agent performance support date/project/owner scopes. Organization-wide posting
and subledger reconciliation are shown independently of report filters.

Exports: authenticated **CSV, real XLSX and multipage English PDF**. CSV strings are
formula-escaped; XLSX uses inline strings, never formulas/external links. Unicode is
preserved in CSV/XLSX; the English PDF template substitutes unsupported characters.
Ledger exports fail rather than truncate beyond 10,000 rows; narrow the scope.
Financial scope ranges are bounded to ten years. Exports are private/no-store and audited.

Expense receipts are private PDF/PNG/JPEG/WebP downloads, max 3 MiB, with strict
base64 and signature checks, bounded request bodies, attachment/nosniff/sandbox
headers. Content is not an authenticity certification or malware scan.

Daily/weekly/monthly schedules create **personal in-app saved financial snapshots**.
No email is sent. First delivery is due immediately; recurring delivery is at 09:00
Karachi (daily next day, weekly seven days later, monthly first of next month).
Snapshots cover yesterday, trailing seven days, or month-to-yesterday respectively.
Missed intervals coalesce into one current digest. The worker rechecks current
recipient permissions and pauses revoked/inactive recipients. Pause/resume is scoped
to the creator. Phase 6 orchestration does not replace this deterministic report job.

## API

- `GET /api/v1/accounting`: accounts, projects, owners, latest 100 expenses/payables,
  personal schedules and latest 20 snapshot deliveries. Receipt bodies excluded.
- `POST /api/v1/accounting`: `action` = `sync`, `account`, `journal`, `reverse`,
  `expense`, `voidExpense`, `payVendor`, `budget`, `schedule`, `pauseSchedule`.
- `GET /api/v1/accounting?action=receipt&id=…`: protected attachment.
- `GET /api/v1/reports?from=2026-10-01&to=2026-10-15&propertyId=prop_1&ownerId=own_1`
- Add `format=csv|xlsx|pdf&report=summary|ledger` for downloads; `page` for ledger JSON.

Writes require `accounting:write`, reads `accounting:read`, exports additionally
`reports:export`. Every lookup and join is organization-scoped. No new real project,
address, ownership assertion, tax rate, legal approval or bank balance is invented.

Verification at Phase 5 checkpoint: **112 unit/integration tests, 21 browser tests**;
typecheck/build passed; **95.07% statements/lines, 82.99% branches, 100% functions**.
SQLite is the tested runtime. PostgreSQL deployment and production hardening remain
later work; this is not a financial compliance certification.
