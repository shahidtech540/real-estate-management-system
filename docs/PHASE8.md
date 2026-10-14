# Phase 8 — personal portals, security and operations

## Scope and identity

Fahad Real Estate, one Rahim Yar Khan office. The local app uses Node 22 SQLite,
not the PostgreSQL design schema. Agents are source-backed local rules/retrieval;
notifications/payment adapters remain simulated, and vault entries are metadata.
No verified title/approval, live banking, OCR, external LLM or signed contracts.

`/portal` selects the current account's view. `/portal/tenant` and `/portal/owner`
require the corresponding role. A direct URL or caller-supplied identity does not
change authorization. All collection queries derive scope from active database
profiles linked by `tenants.user_id` or `owners.user_id`, fresh role permissions
and the organization. Removing a link yields empty records, not organization-wide
access. A co-owner can see whole-property invoices; the balance is clearly **not
the owner's pro-rata payout**. Statement amounts retain their recorded allocation.

## Tenant guide

1. Sign in, open **Personal portal / owner consent**, or visit `/portal/tenant`.
2. Read leases, recorded invoices/payments, tickets, in-app notifications and
   authorized document metadata. Lists show 20 records; use Previous/Next.
3. Under leases, download an **unsigned template PDF**, not an executed agreement.
4. Select your active linked unit and submit maintenance with trade/urgency/details.
   On a completed ticket, confirm resolution/rating, or reopen with feedback.
5. Use Urdu for RTL headings/navigation, and Sign out to revoke the account's
   current access/refresh sessions. Minor record labels retain source identifiers.
6. For gas, fire, exposed wires or flooding, contact local emergency services now;
   the portal does not dispatch emergency services or justify waiting for approval.

A recorded payment is not proof of bank settlement. No live charge is made here.

## Owner guide

1. Open `/portal/owner` for linked properties/units, leases, invoices/payments,
   tickets, your statements, consent requests and in-app messages.
2. Download your recorded statement PDF or the unsigned lease template.
3. Review the source/proposal, estimated PKR cost and status under **reviews**.
   Record approve/reject with an explanatory note. This decision is final.
4. If the underlying lease/ticket changed, the decision returns `409`; staff must
   issue a new source-bound request. Stored intent and final decisions are immutable.

**Owner consent is only a nonbinding acknowledgement.** It does not change rent,
lease dates, deposits, invoices, payments, contracts, or independent agent approval.
It does not claim legal sufficiency. Staff still uses the domain's approval workflow.

## Administrator / staff guide

- Create an owner/tenant account in Users & Branches with the proper role. Production
  requires a real non-`.test` email and an explicit 14+ character initial password;
  deliver credentials securely offline. No invitation email/reset provider is implied.
- Create the business tenant/owner profile with the existing domain forms. Verify
  identity/authorization offline. In `/portal`, use **Administrator: link a personal
  account**, choose profile and matching-role user, then save. Blank explicitly
  unlinks. Replacement/unlinking changes visibility immediately and is audited.
  Email similarity alone never grants access. Options are bounded to 200 profiles/
  accounts; larger onboarding can use the documented API with known source IDs.
- Lease-write/maintenance-triage staff can request consent for an existing source
  and its different, active linked property owner. Review scope is freshly checked.
- Do not remove secondary permissions or independent reviewer controls to make an
  agent proposal succeed. The Phase 7 safeguards remain unchanged.

## Security controls implemented

- Fresh active user/org/role/permissions and token version per protected request;
  revoked roles, unlinked accounts and cross-organization IDs fail closed.
- 15-minute HS256 JWTs; exact expiry; random hashed 7-day refresh tokens, atomic
  rotation, and account-wide access + refresh revocation on authenticated logout.
- New random-salt PBKDF2-SHA256 passwords use 600,000 iterations. Existing legacy
  deterministic demo hashes remain compatible; old data is not rewritten silently.
- Cookie `HttpOnly`, `SameSite=Lax`, and `Secure` in explicit production deployment.
  Same-origin/allowlisted Origin required for cookie mutations, including login,
  refresh and logout with an expired access token. The signed preview header and
  bearer transport are authenticated credentials, not permission overrides.
- Streamed object-only JSON <=1 MiB (agent endpoints retain their stricter 64 KB
  limit); refresh does not swallow oversized/malformed payloads. SQL is parameterized
  and React escapes source text; no raw HTML rendering in personal record cards.
- Persistent hashed-key 15-minute quotas: login global 300 and normalized account
  60; 2FA 30/account; portal writes 100/account; public leads 100/public-business.
  Expired keys are removed; 10,000 concurrent keys is a hard capacity guard. Quotas
  return 429 with Retry-After 900. Forwarded IP is audit metadata, not trusted identity.
- Runtime CSP, no object embedding, self-only connections/form actions, nosniff,
  referrer/permissions policies, private/no-store APIs; production HSTS and
  self-only framing by default. Production rejects bare wildcard framing even in
  a larger directive. CSP still permits inline Next scripts/styles: no claim of a
  nonce-only policy or complete XSS prevention. Demo deliberately allows embedding.
- Explicit production requires distinct 32+ character JWT secrets/persistent path,
  rejects active demo accounts, never demo-seeds an empty DB, hides demo credentials/
  role cards from initial server-rendered HTML, and omits anonymous health counts.
- Anonymous leads can target only published listings in the selected public business;
  private drafts/foreign records cannot be targeted through guessed IDs.

This is OWASP-oriented engineering, **not a penetration-test/security certification**.
Use TLS, disk/backup encryption, controlled filesystem permissions, an ingress
per-IP limiter, monitoring and an independent deployment review. Fixed global
quotas can themselves be exhausted; no distributed edge DDoS defense is claimed.
2FA remains optional; no passkeys, recovery service or organization-wide mandatory
2FA/step-up policy is implemented. Sensitive TOTP material is stored locally, so
protect the database as a credential store.

## Performance and validation

`npm run perf:portals` creates **10,000 synthetic invoices in an in-memory test DB**,
reads 50 20-record pages, and enforces a conservative p95 <=1,000 ms budget. It
refuses a configured SQLite file. This is a local query smoke benchmark, not a
concurrent production/load/SLA measurement. New partial indexes support personal
profile/invoice/lease/ticket/statement queries. Legacy owner unit totals now apply
ownership in SQL before pagination. Runtime SQLite uses WAL, FULL synchronous and
5-second busy timeout; operate app/workers against one same-host volume.

Verification commands:

```bash
npm ci
npm run typecheck
npm run validate:design
npm run validate:api
npm run test:coverage
npm run perf:portals
npm run audit:production
npm run build
npx playwright install --with-deps chromium
CI=true npm run test:e2e
npm run test:e2e:production
```

The production browser harness provisions a separate empty **synthetic** database
and generated ephemeral signing secrets. The provision/backup test uses temporary
files. Neither touches a business DB. Final checkpoint: 334/334 tests, 33/33 demo browser workflows plus a separate
1/1 production smoke, 92.54% statement coverage, production build/typecheck and
static API/design checks passing. Last synthetic query p95 6.59 ms.

Existing multi-org unit fixtures remain only
for regression isolation tests. The Arena preview uses a **fresh demo** file,
`data/phase8-demo.sqlite`; prior runtime history was not recovered in this workspace.
Do not represent this preview as restored financial history.

The runtime dependency audit reports zero known vulnerabilities at this checkpoint.
The full development graph still has five high reports in the Tailwind 3 / braces
build chain (zero critical). These are build-tool exposure, not a clean full audit;
avoid untrusted glob/build inputs and reevaluate when upstream fixes are available.

See [deployment/recovery runbook](DEPLOYMENT.md), [API contracts](openapi.json),
and [API usage](API.md). PR #2 remains open/unmerged. Stop after Phase 8.
