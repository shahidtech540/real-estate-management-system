# Phase 4 — Maintenance, Vendors & Notifications

Current business setup: **Fahad Real Estate, Rahim Yar Khan only**. The
[business-profile correction](BUSINESS_PROFILE.md) supersedes earlier branch,
company and sample project assumptions.

## Run and explore

```bash
npm ci
npm run db:seed
npm run dev
# In a second terminal, with the SAME SQLITE_DB_PATH as the app:
npm run maintenance:worker
```

Use `/dashboard` → **Maintenance & Vendors** or **Notifications**. At narrow
widths these are in the **Workspace** dropdown. All demo passwords are
`Password123!`:

1. `tenant@fahadrealestate.test`: report an issue for the current leased unit; optionally
   attach up to five JPEG/PNG/WebP photos. The tenant demo initially uses Urdu;
   switch to English using the header if preferred.
2. `maintenance@fahadrealestate.test`: select the issue, set category/priority with a triage
   note, choose a matching available vendor, enter the estimate and schedule time.
3. Start the work order, then complete it with notes and the actual cost.
4. Switch back to the tenant; confirm with a 1–5 rating, or reopen with a reason.
5. Open Notifications to view updates and SLA alerts. Administrators can inspect
   the organization delivery log, edit English/Urdu templates, queue one consented
   external message, retry failures, and process the delivery queue.

The existing database is migrated additively. A one-time demo migration adds three
vendors, a leaking-tap ticket for `unit_1`, and a future quarterly HVAC schedule.
It does not reset leases, invoices, payments, users or portfolio records. Deleted
or modified Phase 4 demo records are not recreated on every start.

Docker Compose now includes a `maintenance-worker` service sharing the app's
persistent SQLite volume and starting after the app health check. The runtime
image includes `tsconfig.json` for the CLI path aliases. Docker execution was not
available in this sandbox; the Node app, CLI and worker are verified locally.
PostgreSQL/Redis containers are still scaffolding, not active storage/job engines.

## Workflow and permissions

```
open → triaged → scheduled → in_progress → completed → closed
         ↑          │              │          │
         └── cancellation ─────────┘          │
         └──────── tenant reopens ────────────┘
```

- Ticket creation: `maintenance:create`; reading: `maintenance:read`.
- Staff actions and preventive schedules: `maintenance:triage`; vendor directory,
  rates, availability, history and editing: `vendors:manage`.
- Tenant requests require a current active/expiring/renewed lease on the selected
  unit. The server derives the property and tenant, never trusts submitted IDs for
  those relationships, and validates unit/vendor/work-order organization membership.
- Tenants read only tickets linked to their tenant profile, including past tickets.
  Owners have read-only access to currently owned properties' tickets and costs.
  Soft-deleted ownership allocations do not grant access.
- A matching trade (or `general`) and available vendor is required. Only one active
  work order is allowed per ticket. Cancelled work returns to triage; a replacement
  order preserves previous history. Estimates and actual costs use integer PKR
  paisa in the API; forms display PKR rupees and convert at submission.
- Completion requires actual cost and notes. Completed costs cannot be overwritten,
  including after tenant rejection/reopening. Phase 3 owner statements already
  include these completed actual expenses, not estimates or cancelled work.
- Only the linked tenant may confirm normally; maintenance coordinators cannot
  impersonate tenant confirmation. An administrator may explicitly override closure
  with a reason of at least ten characters. Overrides are identified in the audit
  and activity timeline and do not fabricate a tenant rating.
- Ratings are based on tenant-confirmed work, not editable vendor marketing scores.
- In-app updates notify organization administrators, maintenance coordinators and
  the linked tenant transactionally with each maintenance event. No automatic
  external messages, vendor payments or AI actions are triggered.

## SLA and preventive jobs

| Priority | Deadline from ticket creation |
|---|---:|
| Emergency | 1 hour |
| High | 4 hours |
| Medium | 24 hours |
| Low | 72 hours |

Triage recomputes the deadline from **original creation**, not from triage time.
A deadline is escalated once per ticket/deadline, even across retries. Timers stop
at completed/closed/cancelled status; reopening resumes the original SLA. The UI
shows remaining/overdue minutes and refreshes the displayed timer every 30 seconds.
Emergency tickets immediately notify the in-app recipients; life-threatening
situations must go to local emergency services, not this application.

Preventive schedules specify a unit, trade, interval (1–366 days), next UTC due
instant and active/paused state. A due schedule creates an open ticket. Missed
intervals coalesce into one ticket and advance to the next future occurrence on
the original cadence. `(organization, schedule, due_at)` is unique.

```bash
npm run maintenance:cycle                  # one scan + external outbox batch
npm run maintenance:worker                 # foreground worker, every 60 seconds
npm run maintenance:cycle -- 2026-10-20T12:00:00Z # explicit reference for testing
```

Run **one worker with the same database path as the app**, or schedule the one-shot
command every minute with your process manager/cron (do not run both unnecessarily):

```cron
* * * * * cd /path/to/rems && SQLITE_DB_PATH=/path/to/rems/data/rems.sqlite npm run maintenance:cycle >> /path/to/rems/maintenance.log 2>&1
```

The dashboard scan button generates preventive tickets and SLA alerts immediately;
the administrator delivery button separately processes external notifications.
Per cycle/org caps: 100 due schedules, 500 not-yet-escalated tickets, 100 external
messages. Subsequent cycles continue the backlog. The worker runs serially, logs
structured JSON results/errors, and stops gracefully on SIGINT/SIGTERM. SQLite
uses a five-second busy timeout for app/worker lock contention. This is not a
Redis/BullMQ or horizontally distributed job deployment.

## Notification delivery and safety

- Every authenticated account has its own paginated inbox; only `admin:manage`
  can inspect the organization-wide delivery log, compose messages, dispatch,
  retry or edit templates. Read acknowledgement is restricted to the recipient.
- `in_app` is delivered immediately. Email/SMS/WhatsApp enter a durable DB outbox.
  Manual external messages require an explicit consent assertion and an existing,
  active same-organization recipient with the appropriate contact details.
- Manual composition requires a request key. Retries with the same key and same
  content return the original ID; changed content returns `IDEMPOTENCY_CONFLICT`.
- The default mock adapter returns stable provider receipts and `mock_sent`.
  **This is simulated delivery, not a real email/text/WhatsApp message.**
- `NOTIFICATION_PROVIDER_MODE=live` fails closed with an explanatory error. Merely
  supplying credentials does **not** enable delivery. A real provider adapter,
  delivery callbacks and operational/security validation are still required.
- Failed attempts use 60s exponential backoff, capped at one hour; after five
  attempts the message becomes `dead_letter`. Explicit admin retry is audited.
  A five-minute processing lease permits recovery after worker interruption;
  adapter calls use the notification ID as their provider idempotency key.
- Templates permit only `{{number}}`, `{{status}}`, `{{title}}`, `{{note}}`.
  Substitution is one pass: tenant/staff text is not evaluated as template code.
  Messages render as plain React text, never injected HTML.
- Real email will need an approved SMTP/API account and sender/domain setup;
  SMS needs an approved provider account/sender; WhatsApp needs a WhatsApp Business
  account, token/phone number ID and approved templates where applicable. Do not
  put credentials in source control or chat. Bulk/legal/arrears automation remains
  subject to the later approval/agent phases and is not enabled here.

## API reference

All paths below are under `/api/v1`, require signed session authentication, and
retain organization/RBAC checks on the server. Money is **integer paisa** and
instants are validated ISO UTC timestamps. List pagination uses `page` (default 1)
and `limit` (default 25, maximum 100).

| Method | Path | Payload / behavior |
|---|---|---|
| GET | `/maintenance/tickets` | `page`, `limit`, optional `status`, `search`; scoped board, unit choices, authorized vendors/schedules |
| POST | `/maintenance/tickets` | `{unitId,title,description,category,priority,photos?}`; 201 |
| GET | `/maintenance/tickets/:id` | Scoped ticket with private photos, ordered events and work orders |
| PATCH | `/maintenance/tickets/:id` | `{action,data}`; actions below |
| GET | `/maintenance/vendors` | Directory, rates, availability, calculated rating/completed-job count |
| GET | `/maintenance/vendors?id=:id` | Paginated vendor work-order history |
| POST | `/maintenance/vendors` | `{name,tradeCategory,phone,email?,baseRateMinor,slaHours?,available?}` |
| PATCH | `/maintenance/vendors` | `{id,data}` with same vendor fields |
| POST | `/maintenance/schedules` | `{unitId,title,category,intervalDays,nextDueAt,active?}` |
| PATCH | `/maintenance/schedules` | `{id,data}` with same schedule fields |
| POST | `/maintenance/cycle` | Human-triggered current-time preventive/SLA scan |
| GET | `/notifications` | Own communications; `outbox=true` requires admin |
| POST | `/notifications` | `{userId,channel,subject,body,consent?,requestKey}` |
| PATCH | `/notifications` | `{id,action:"read"}` or admin `action:"retry"` |
| POST | `/notifications/dispatch` | Admin sends one due batch through configured adapter |
| GET / PUT | `/notifications/templates` | Read defaults/overrides; save `{locale,subject,body}` for maintenance |

Ticket action data:

```json
{"action":"triage","data":{"category":"plumbing","priority":"high","note":"Inspect the leaking joint."}}
{"action":"assign","data":{"vendorId":"ven_plumber","scheduledAt":"2026-10-21T09:00:00Z","estimatedCostMinor":300000}}
{"action":"work_order","data":{"workOrderId":"WO_ID","status":"in_progress","note":"Vendor is on site."}}
{"action":"work_order","data":{"workOrderId":"WO_ID","status":"completed","actualCostMinor":275050,"note":"Seal replaced and flow tested."}}
{"action":"confirm","data":{"accepted":true,"rating":4,"note":"The leak has stopped."}}
```

Use a future schedule time when trying the example. Work-order cancellation uses
`status:"cancelled"` and a note. Tenant reopening uses `accepted:false` and a note.
Categories: `plumbing`, `electrical`, `hvac`, `structural`, `cleaning`, `general`.
Channels: `in_app`, `email`, `sms`, `whatsapp`. Unit/vendor/schedule choices are
bounded to 500 per board/directory; ticket, history and inbox lists are paginated.

## Verification and boundaries

```bash
npm run typecheck
npm run test:coverage
npm run build
npx playwright install --with-deps chromium
CI=true npm run test:e2e
```

Tests cover the ticket-to-closure flow, photos, tenant/owner/organization isolation,
RBAC, invalid transitions, immutable costs, actual-expense owner statements,
idempotent old-schema migration, preventive generation, SLA deduplication,
consent, delivery backoff/dead letters/recovery, templates, and HTTP contracts.
Browser tests exercise the actual forms, role switches, photo upload, mock email,
preventive schedules and expanded mobile/RTL layouts.

SQLite remains the active runtime. PostgreSQL/Prisma files are design artifacts,
not a working engine switch. Photo data is bounded and private in SQLite; moving
large photo volumes to object storage, provider delivery receipts, dedicated tenant/owner portals belong to later hardening
and portal work. Phase 4 does not implement Phase 5 accounting or Phase 6/7 agents.
