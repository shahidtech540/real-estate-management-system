# Interactive Plot Map — Phase D: private booking workflow

Phase D is complete. **Stop for user testing before E.** This adds human-admin
booking/click workflows to the published map, not public sales, ownership transfers,
agent tools or an automatic expiry/live-update worker.

## Run and try

Node 22.22.3+ in the 22.x series:

```text
npm ci
npm run test:plot-maps
npm run dev
```

Open `http://localhost:3000`, sign in as the demo administrator
`admin@fahadrealestate.test` / `Password123!`, choose **Plot Map → Published map**.
On phone/tablet use the workspace dropdown. In the preserved Arena synthetic demo,
Fahad Garden's published map has eight plots; plot **101** has a positive saved price.
No test booking is injected into this preserved database. Other projects without a
publication need an explicit review/publish first; see [B](PLOT_MAP_PHASE_B.md).

1. Hover to read catalogue information. Click/tap or press Enter/Space on an available
   plot to open a modal booking form. Plot/project/price/currency are locked. A plot
   with a missing/zero total price cannot be booked: set a positive official total
   in a new review draft and publish it first. No ad hoc discount is accepted.
2. Search an existing client by at least two name/phone characters (literal match,
   up to 30 results), or choose **Create new client**. Enter name/phone; optional
   CNIC/ID, email and address. This records supplied identity, **not verified KYC**.
   Existing clients keep their identity and linked lead; they are not duplicated.
3. Choose an active same-organization agent/admin; current admin defaults. Select
   **Reserve** for a pending hold or **Book** for a confirmed booking.
4. Enter the token **requested** in rupees/displayed major currency units, not paisa.
   Zero is allowed. A token must not exceed the catalogue price. It is an unpaid
   invoice request, **not proof of cash received** or a simulated payment.
5. Booking date is today in **Asia/Karachi**. Reservations require a future expiry
   within 90 days; confirmed bookings have no hold expiry. Expiry inputs use browser
   local time, submitted as ISO instants; API clients must supply an ISO offset.
6. Choose full payment or monthly installments. For installments, set down payment
   **including the token**, 1–120 installments and first due date after booking.
   Down payment must be at least the token and below total price. Preview shows
   token, remaining down payment and installment amounts/dates; minor-unit remainder
   distribution sums exactly, and January 31 → February 28/29 → March 31.
7. Optionally attach one ID copy and one payment-evidence file, PDF/PNG/JPEG only,
   each ≤2 MiB. Evidence is **unverified**, not a payment instruction. Files are saved
   as real private database BLOBs, not fake S3 URLs, and checked for matching magic
   bytes/size/encoding. No malware/antivirus or document-authenticity certification is
   claimed; downloads are attachment-only with restrictive CSP and nosniff.
8. Save. The plot turns amber locally and counts/filter visibility update. See the
   saved booking, client/agent, dates, terms, CRM lead ID, notes, invoice and actual
   confirmation/invoice PDF downloads. Uploaded evidence downloads reproduce the
   original saved bytes. A booking filtered out by its new status keeps confirmation
   open; closing returns focus to the map canvas rather than a hidden plot.
9. **Full plot page & activity** opens `/plots/{plotId}` with the same authenticated
   transport, current details and latest activity. Issued PDFs preserve original
   issuance-time terms; current status/expiry on this page is authoritative. PDF
   text uses the existing English/ASCII font fallback; exact Unicode identities
   remain in JSON/UI, not falsely claimed faithfully typeset in the PDF.
10. For a pending reservation, enter a reason and **Extend hold** (later future time
    within 90 days) or **Confirm booking**. Confirming an elapsed hold is rejected;
    explicitly extend or cancel. **Cancel booking** closes the active booking,
    releases its plot and cancels its unpaid token invoice. Client, lead, history,
    documents and issued PDFs remain. No refund or automatic CRM deletion occurs.
11. Open **Rent & Payments → Plot token invoices** for the separate register (latest
    200), with private plot links. This does not mingle buyer tokens with rent arrears,
    rent revenue, tenant balances, existing lease payments or the general ledger.
12. Administrator and assigned staff receive delivered **in-app** inbox notifications.
    No unsolicited client email/SMS/WhatsApp or live external payment is claimed.

## Status clicks and phase boundary

- Available: form above, if priced and authorized.
- Reserved/booked: lazy-loaded private booking records and guarded confirm/extend/
  cancel actions. Only the active source-linked booking can change the plot.
- Blocked: booking prohibited; current B model has no separate reason field, so the
  panel explicitly says no reason recorded rather than fabricating one.
- Sold/resale: catalogue status and existing authorized booking history only.
  Sale records, owner/seller contacts, resale edits/inquiries, sale conversion and
  ownership history are **E**, not dummy D buttons or empty “completed” screens.
- Full plot page includes latest 50 booking records and latest 100 plot/booking
  activity events with actor/reason where recorded. Ownership timeline is E.

All these reads/writes remain **admin-only** until E's explicit per-role privacy
policy is implemented. An assigned agent gets a notification but is not thereby
silently granted map/booking access in D. Existing generic CRM permissions remain
unchanged. Sensitive booking identity/file metadata is never added to C's map DTO.
Documents are catalogued under `plot_booking` and visible only to properly scoped
admins; actual bytes download through the specific booking-file API.

Only the submitting view and a losing conflicting submission update automatically
as part of their requests. Other open map views still use **Refresh published map**.
Cross-user polling/SSE/toasts and the scheduled hold-expiry job are E. An elapsed
hold remains reserved until explicitly handled in D; it cannot be double-booked.

## Consistency, billing and safeguards

The rental schema requires real `lease_id`, `unit_id` and `tenant_id` on invoices;
CRM deals require a unit. Plot bookings must not impersonate these. D adds
`plot_token_invoices` **inside the billing module** and links existing CRM leads,
never fake tenants/leases/units/deals/commissions. The plan is stored contractual
terms, not a schedule of automatically issued/paid rental invoices. Token invoices
are pending, zero-token `not_due`, or cancelled. No payment, receipt, revenue,
accounting journal or verified-money movement is fabricated. Actual cash/payment/
refund processes require their own authorization and reconciliation, not a bypass
of existing independent approvals or agent guardrails.

Creation prepares the two PDF buffers before taking a SQLite lock, then rechecks
fresh role/capabilities, active publication/plot, exact map/price/currency, client,
agent and expiry inside **BEGIN IMMEDIATE**. It creates client if requested, links a
CRM lead, inserts booking/invoice/files, conditionally changes available status,
audits and enqueues notifications within one transaction. Failure anywhere rolls
all business effects back. Unique active-booking index and conditional update are
independent final protections. Another writer gets HTTP 409 `PLOT_JUST_BOOKED` with
an actionable message; it never silently overwrites the winner.

A UUID `requestKey`, scoped to organization + submitting user, binds a SHA-256 of
validated terms. Exact retries return the same booking and stored PDFs without
repeating side effects; changed terms with an already-used key get 409. The UI keeps
its key through ambiguous errors, disables duplicate submissions and refreshes private
state on conflict. A stale map publication is explicitly blocked in its modal until
the user closes and refreshes. The server also rejects stale prices/publications.

Confirm/extend/cancel require a fresh booking **revision** and reason, lock/recheck
active identity, status and encumbrances, and audit the real actor. Stale/closed
bookings, inconsistent plot state and active ownership/sale/resale encumbrances
cannot release someone else's plot. New state changes also have DB audit triggers.
Legacy A/B booking rows are readable but **read-only** until their terms/billing
are reconciled; no inferred cash or new invoices are attached to historical rows.

This is an additive migration: client address and booking request/revision/price/
publication fields, private file and token invoice tables/indexes. Existing units,
leases, invoices, receipts, ledger, ownership and plot identities are preserved.
Back up the same database before updating an installation:

```text
# Set SQLITE_DB_PATH to the existing app DB in your shell first.
npm run db:backup -- data/backups/before-plot-d.sqlite
```

Use a new destination; never overwrite a DB with downloaded code or run browser
fixtures against a business database. The preview uses its preserved, explicitly
synthetic `data/plot-map-phase-a-demo.sqlite`; standard local demo uses `data/rems.sqlite`.

## API

Every route authenticates current membership and refreshes role/permission scope.
Read endpoints require A/B admin/manage/property-write plus `leads:read`,
`invoices:read`, `documents:read`; booking writes additionally require the matching
three write permissions. Cookie mutations enforce Origin; signed header transport
supports embedded previews without token URLs. All responses are private/no-store.

| Method / URL | Contract / quota per user+org per 15 minutes |
|---|---|
| GET `/api/v1/plots/{id}` | Current private detail; 120 |
| GET `/api/v1/plots/{id}/booking-options?q=...` | Literal minimal client lookup + active assignees; 240 |
| POST `/api/v1/plots/{id}/bookings` | Strict creation body; 30; 201 new / 200 exact replay |
| PATCH `/api/v1/plots/{id}/bookings` | `{bookingId,revision,action,reason,expiryDate?}`; 60 |
| GET `/api/v1/plots/{id}/files/{fileId}` | Scoped real attachment bytes, audited; 120 |
| GET `/api/v1/billing/plot-invoices` | Minimal same-org register; admin/manage/property-write + invoices:read; 120 |

Creation example (replace IDs, current date/expiry, map version and minor-unit price
with values from the private detail/options responses):

```json
{
  "requestKey": "a1fb9001-518c-4a24-a995-0f5a79f569c4",
  "expectedMapId": "map_FROM_CURRENT_DETAIL",
  "expectedPriceMinor": 100003,
  "currency": "PKR",
  "newClient": {"fullName":"Synthetic Buyer","phone":"+923001234567","cnic":"demo-id","email":"buyer@example.test","address":"Synthetic test address"},
  "agentId": "usr_agent",
  "bookingType": "reserve",
  "tokenAmountMinor": 10000,
  "bookingDate": "2026-10-17",
  "expiryDate": "2026-10-18T12:00:00Z",
  "paymentPlan": {"kind":"installment","downPaymentMinor":20000,"installments":3,"firstDueDate":"2026-11-17"},
  "notes": "Synthetic example only",
  "files": []
}
```

Use `clientId` **instead of** `newClient` for existing clients. Full plan requires
`downPaymentMinor=expectedPriceMinor`, `installments=0`, `firstDueDate=""`.
Confirmed `bookingType="book"` requires `expiryDate=null`. Attachment shape:
`{name,category:"id_copy"|"payment_receipt",mimeType,base64}`. Body is streamed and
capped at **6 MiB only for booking POST**; other JSON routes retain 1 MiB. Client and
server share structural, date and payment validators; server is authoritative on
permissions, canonical state, attachments, tenant scope, transaction and retries.
400 invalid terms; 401 no session; 403 role/capability/Origin; 404 unknown/out-of-org
resource; 409 stale/nonavailable/encumbered/key conflict; 413 body limit; 429 quota.

## Tests

```text
npm run test:plot-maps
npm run typecheck
npm run test:coverage
npm run validate:api
npm run validate:design
npm run audit:production
npm run build
npx playwright install chromium
npx playwright test e2e/plot-bookings.spec.ts
```

Browser tests must run an isolated seeded server, not reuse a business instance.
Set `CI=1` and `E2E_PORT=3001` in your shell to require a new server on a free port
(PowerShell: `$env:CI="1"; $env:E2E_PORT="3001"`). Full regression:
`npm run test:e2e`; separate production policy: `npm run test:e2e:production`.

42 new D unit/service/route tests cover actual transaction side effects, rollback
on downstream failure, exact retry behavior, same-process and **independent Node
process** races on one file-backed SQLite DB, upgraded legacy schema, preserved
rental financial rows, invalid terms/attachments/roles/orgs, private file binding,
revision conflicts, legacy protection and body/quota/Origin rules. Five new browser
flows cover desktop full lifecycle + PDFs/uploads, two concurrent actual browser
submissions, phone booking/focus, blocked/unpriced plots/register and stale/filtered
publication behavior. These supplement, not replace, all A/B/C and business regressions.

**Stop after D.** No scheduled expiry, cross-user automatic updates, public/agent
role expansion, sale/resale/ownership workflows or F agent tools implemented here.
