# Phase 7 — Six source-backed domain agents

Completed **local rules / lexical-retrieval scope**, on the Phase 6 durable engine.
These are functioning assessments and guarded actions, not empty agent labels.
There is **no configured live LLM, neural embedding model, OCR, bank/payment provider,
SMS/WhatsApp/calendar integration or verified legal/market certification**. Nonlocal
planner modes remain fail-closed. Local calls record **zero tokens and provider cost**.

## Use the guided workspace

1. Start the app and sign in. Select **Agent orchestration → Six domain agents**.
2. Select an agent and an existing record. Optional times are explicitly supplied
   in the browser's local time; the server receives UTC. Financial insights use
   explicit date/project filters; without a project filter they cover the portfolio.
3. **Queue assessment**. Click **Advance one step**, or run `npm run agents:worker`
   against the **same `SQLITE_DB_PATH`** and then **Refresh queue**.
4. Read the English/Urdu summary, structured findings/drafts, warnings and citations.
   Assessments do not change business records. An unsupported question abstains.
5. The original assessor can **Request independent approval** for a persisted
   proposal. This queues a separate write run; advance it to stage the approval.
6. Another active, authorized user reviews the exact input and source snapshot in
   **Approval queue**. Self-approval is forbidden, including for administrators.
7. Advance the approved run or let the worker execute it. Fresh permissions, source
   fingerprints, version, budget, allowlist, autonomy and kill switches are checked
   again. Changed source means **rerun the assessment**, never silently recompute
   the proposal under an old approval.

No proposal arguments are accepted from the browser. It submits only the persisted
assessment run ID and proposal ID. The server owns the immutable proposed arguments.
Read/write tools also remain available in the manual structured-plan workspace.

### Demo actors and independent reviewers

| Workflow | Suitable initiator | Reviewer |
|---|---|---|
| Lead / listing | Sales agent | Administrator |
| Rent reminder | Accountant | Administrator |
| Maintenance | Maintenance staff | Administrator |
| Lease offer | Administrator with `leases:write` | **Different** authorized administrator |
| Insights | Any authorized staff role, subject to input-sensitive read permissions | Read only |

The six demo roles include **one** administrator. Do not weaken self-approval or
silently elevate another demo role. For administrator-initiated lease offers,
create a second appropriately authorized staff user in **Users & Office** (or use
an existing real reviewer). No additional privileged account was seeded in Phase 7.

## Implemented assessments and actions

| Agent | Grounded assessment | Independently approved action |
|---|---|---|
| Lead | Existing recorded-field CRM score; missing budget/timeline; up to five available matches by explicit buy/rent intent, budget, type and bedrooms; bilingual response draft | `crm.qualify`: save contacted stage/qualification note, preserving the existing CRM stage vocabulary; `crm.viewing`: supplied future time and assigned active sales agent, reject unit/agent conflicts within 30 minutes |
| Listing | English/Urdu copy from recorded unit/project facts; photos/stale-listing checks; comparable asking-price sample, median/quartiles or insufficient-evidence abstention | `listings.draft`: private draft at the recorded asking price, **never publish/syndicate**; existing draft or unavailable unit blocks creation |
| Rent | Exact invoice balance/age/grace-period ladder; completed recorded receipts versus invoice settlement; explicit legacy evidence gap/mismatch; exact-paisa nonbinding installment illustration and bilingual courtesy draft | `rent.reminder`: one idempotent **in-app** reminder per invoice/balance/business day to its active linked tenant; no new payment, late fee, legal threat or external message |
| Maintenance | English/Urdu conservative hazard/category rules, recorded SLA breach, available trade/rating/SLA/cost candidates (credentials unverified), immediate emergency advice | `maintenance.triage`: cannot downgrade the safety-rule minimum; existing `maintenance.assign` for an explicitly supplied slot and compatible recorded vendor estimate |
| Lease | Recorded 90/60/30-day windows, exact escalation arithmetic, optional anchored **stored-text** extraction and comparison, deposit-event/inspection/arrears review | `leases.offer`: immutable private **unsigned, nonbinding** offer artifact inside the current 0–90-day window; no renewal, refund, deduction, invoice or lease amendment |
| Insights | Typed current occupancy/vacancy/arrears/SLA metrics, accrual ledger income/expense/profit/cash-movement/legacy-clearing, or cited latest authorized document excerpts | None; insights stays suggest-only |

### Deliberate limitations and safety rules

- Lead scoring is the existing deterministic CRM rubric, **not** a calibrated
  probability, learned qualification model or promise of affordability. Missing
  budget is explicitly unknown. Requirements/free text never become tool commands.
- Listings use same stored city/type and area ±25% asking comparables (max 200).
  At least three are needed for median/quartiles; confidence remains low. These
  are **asking records, not completed sales or an appraisal**. The approved draft
  preserves the recorded asking price rather than automatically applying a median.
  Ownership, inventory, amenities, approvals and returns are not certified.
- Installments conserve every paisa, are not an agreed payment plan, and have no
  invented agreed due dates. Legacy gaps never become fabricated cash receipts.
  Receipt/source mismatches must be reconciled before a reminder.
- Gas/fire/exposed wiring/flood hazards get immediate keep-away/contact-emergency
  guidance. Do **not** wait for approval or attempt repairs. The app does not
  contact emergency services or certify a gas specialist/diagnosis. A displayed
  triage result is advisory until a human-approved write updates the ticket.
- Lease extraction handles exact stored template labels (`Monthly Rent`, `Security
  Deposit`, `Lease Term`) only. Missing, malformed, duplicate or invalid date fields
  are withheld; document comparisons need human verification. Scanned/binary-only
  PDF content is not OCR'd. No fake S3 PDF/download is created for offer artifacts.
  Escalation uses decimal percentage rational arithmetic with BigInt, rounding half
  up to a paisa, without binary floating-point money calculations.
- Insights selects one supported intent using documented English/Urdu keyword rules.
  Dates affect financial reports; occupancy/arrears/SLA are explicitly **current**.
  It does not infer project filters from arbitrary prose, perform valuation,
  predictive forecasting or certify approvals. Unknown historical vacancy dates
  remain unknown. Sold units are excluded from the rental occupancy denominator.
- Document retrieval is Unicode lexical overlap, **not neural semantic search**.
  It scans up to 200 latest vault records/32,000 characters per text and returns up
  to five authorized cited excerpts, max 300 characters each. Property-filtered
  retrieval covers that property's/unit documents; it is not an exhaustive legal
  search. Retrieved text is untrusted quoted data, never executable instructions.
- Financial insights require `accounting:read`; rent requires invoice/payment/lease
  reads; document insights require document/lease reads. Input-sensitive permissions
  are rechecked on plan submission, execution, cached-result access and review.
  Organization/property visibility is preserved. Role downgrades cannot expose
  cached financial/document output via `properties:read` alone.
- Sources are demo/unverified records; recorded ledger cash is not an independently
  confirmed bank balance. **Legacy clearing is not cash**. Posting gaps are disclosed.
- Plain-text rendering, bounded strict inputs, no arbitrary SQL/shell/network tools,
  instruction-like text warnings and simple credential-label redaction are defense
  in depth, **not a general DLP or production-security certification**.

## Storage and migrations

`src/server/db/phase7.ts` adds `agents.domain_initialized` and private immutable
`agent_artifacts`. Business financial rows are not reseeded/reset. Only untouched
Phase 6 default allowlists gain each agent's domain capabilities, once. Customized
allowlists, autonomy, enabled state and budgets remain unchanged. Administrators
can intentionally add missing tools through existing agent controls.

Assessments/proposals are durable `tool_calls.output_json`, not transient browser
state. Write plans add optional immutable first-level `expectedSourceHash` to close
both assessment→submission and submission→approval staleness gaps. The independently
approved source hash is still verified before execution. Existing worker cursor,
rollback, multi-process credit concurrency and idempotency regressions stay passing.

## API

Authenticated, private/no-store endpoint: `/api/v1/agents/domain`.

- `GET`: permitted agent metadata and scoped, bounded record options (max 100).
- `POST action: "assess"`: `kind`, `requestKey`, strict kind-specific `input`.
- `POST action: "propose"`: completed `runId`, persisted `proposalId`, `requestKey`.
- Existing `/api/v1/agents` handles advance/cancel/review/controls and durable traces.

Kinds/inputs:

```text
lead:        leadId, intent (sale|rent), unitType?, minBedrooms?, viewingAt?
listing:     unitId, purpose (sale|rent)
rent:        invoiceId, installments (1..12, default 3)
maintenance: ticketId, scheduledAt?
lease:       leaseId, documentId?, newEndDate?
insights:    question, propertyId?, from?, to?
```

Both structured-plan and domain POST endpoints reject oversized requests. No live
provider credentials are required, requested, displayed or stored by this workflow.

## Verification and checkpoint

```bash
npm run test:agents       # 125 scenario/adversarial evals + 20 integration tests
npm run typecheck
npm run test:coverage     # complete regression suite: 287 tests
npm run validate:design   # matching Prisma/WASM + static Compose validation
npm run build
npm run test:e2e          # complete production-browser suite: 30 workflows
```

The evaluation suite tests all six domains, budget/type/language/window boundaries,
source staleness at each transition, ambiguous/empty documents, prompt-injection
and credential text, foreign IDs, role changes, independent approvals, actual
writes, read-only source preservation and a real-file restart. It is a deterministic
local behavior benchmark, **not a live-LLM quality/accuracy benchmark**.

**Stop after Phase 7. Phase 8 needs the user's next approval. PR #2 stays open/unmerged.**
