# Phase 6 — durable guarded agent orchestration

The **Agent orchestration** workspace is a working engine for **human-authored,
structured plans**. It is not a claim that the six natural-language/domain reasoning
agents are implemented. Those remain Phase 7. The local provider makes no model,
network, shell, SQL-from-user, messaging or external payment calls.

## Run and walkthrough

```bash
npm ci
npm run db:seed
npm run accounting:sync  # imports existing operational history, no repeated journals
npm run dev             # or npm run build && npm start
# separate terminals, SAME SQLITE_DB_PATH as the application:
npm run agents:worker   # serial 5-second sweeps, up to 50 queued runs, one step each
npm run reports:worker  # Phase 5 personal financial digests
npm run maintenance:worker
# cron/manual alternatives: npm run agents:cycle ; npm run reports:cycle
```

1. Sign in as admin. Open **Agent orchestration**. The default Insights agent is
   read-only (`suggest_only`). Enter a unique request key and human goal/context.
2. Submit this two-step plan, replacing report dates as needed:

```json
[
  {"tool":"portfolio.units","input":{"limit":10}},
  {"tool":"reports.financial","input":{"from":"2026-10-01","to":"2026-10-15"}}
]
```

3. Use **Advance one step** or let the worker run. Expand trace rows to inspect exact
   inputs, outputs, timing and intent hash. The saved cursor resumes after restart.
4. For a write: select the Rent agent and use a real invoice ID in `billing.credit`.
   Submission queues a plan; advancing creates an approval and **does not issue credit**.
5. Switch to the accountant (different user) and inspect **Independent approval
   queue**, exact arguments, source snapshot and hash. Enter evidence/reason, approve
   or reject. Approval itself makes no source change.
6. Switch back to the initiator or wait for the worker. Execution rechecks the exact
   approved intent, source state, both users' current permissions, budgets and switches.
7. Admin can disable one agent or the organization. This terminally kills queued and
   waiting runs, cancels their unexecuted approvals and retains executed history.
   Re-enabling permits **new** plans, not resurrection of killed runs.

Demo identities/password are in README. Never represent a demo receipt as a real
bank transfer. Direct staff billing workflows retain their existing manual RBAC;
mandatory independent approval here applies to **orchestrated tool writes**.

## Registry and permissions

Versioned registered tools have strict Zod input schemas, server-defined permission
requirements, an approval flag, examples and synchronous domain-service handlers:

| Tool | Permission | Independent approval |
|---|---|---|
| `portfolio.units` | properties:read | No |
| `crm.leads` | leads:read | No |
| `billing.invoices` | invoices:read | No |
| `billing.credit` | invoices:write | **Always** |
| `billing.payment` | payments:write | **Always** |
| `maintenance.board` | maintenance:read | No |
| `maintenance.assign` | maintenance:triage | **Always** |
| `leases.list` | leases:read | No |
| `reports.financial` | accounting:read | No |
| `accounting.expense` | accounting:write | **Always** |

Admin configures each agent's allowlist, enable/kill state, daily provider-cost budget
and `suggest_only` or `act_with_approval` autonomy. Suggest-only permits reads only.
No configuration can remove a registered write's approval requirement. Unknown tools,
arbitrary queries/URLs/shell commands, external messaging, deletions and unsupported
lease changes cannot execute. Add a reviewed registry handler before offering any
new capability; do not route user/model-generated code into execution.

`agents:read` is required for the workspace; `agents:run` for submission/advancement;
`agents:approve` **plus the tool's own domain permission** for independent review;
`admin:manage` for engine/agent controls. Owners' existing approval permission does
not grant organization-wide engine access. Dedicated owner approval UX remains Phase 8.

## Transaction and approval guarantees

- Immutable plan, tool intent and approval payload, enforced by additive SQLite
  triggers. Request key is unique per org/creator, conflicts reject different intent.
- SHA-256 binds org, run, ordinal, tool name/version, canonical validated input and
  a source-state hash. Review includes source snapshots. Changed invoice balances,
  vendor/ticket state, ownership/account state or tool versions fail closed; submit
  a new plan rather than reusing stale approval.
- Creator **cannot self-review**, including an administrator. Reviewer needs current
  domain permission. Both initiator and reviewer are resolved fresh from the database
  at execution; revoked/suspended users and organizations cannot execute approved work.
- Tool effects, accounting/audit writes, tool output and run cursor commit in **one
  transaction** using nested savepoints under outer `BEGIN IMMEDIATE`. Two concurrent
  workers cannot duplicate an approved credit. Pending intent is committed separately
  before execution, so a crash before effects resumes that same intent safely.
- No async/network provider operation occurs inside a DB transaction. Tool failures
  roll back source effects and record terminal failure; no blind automatic retries.
  Rejected/cancelled/killed/budget-exceeded runs never advance further.
- Kill is checked at each step boundary. It does not reverse already committed work
  or promise interruption of a synchronous transaction already in flight. Explicit
  source corrections/reversals are required to undo completed financial actions.
- Runs visible to their creator or admin only; cached output additionally requires
  current permissions for all plan tools. Reviewers see only approval payloads they
  have domain permission to review, not unrelated users' complete traces.
- Audits store deterministic decision summaries, explicit arguments/results, actor,
  reviewer and hashes—not private model chain-of-thought. Untrusted goals, lead text
  and tool outputs are data; no interpolation, eval, executable instruction parsing
  or automatic next-step generation occurs.

## Budgets and limits

Local provider usage is truthfully **zero tokens / zero PKR**. Recorded provider costs
are checked against per-run, agent daily and org daily budgets; zero-cost local tools
can run with a zero monetary budget. Separate daily tool quotas and step limits apply
regardless of cost. There is no claim of real model billing or live token reservations.
A future asynchronous paid provider needs reservation/idempotent billing before enablement.

Defaults: max **20** steps/run, **200** executed/failed tool attempts per org/day,
**100** submissions per user/day, **50** queued runs per sweep. Limits use Karachi
calendar days. Read tools return bounded results, request bodies are streamed and
bounded to 64,000 bytes, and tool output over 256 KiB fails and rolls effects back.
Per-run provider maximum defaults to zero. Engine/agent controls are rechecked while
advancing, not only on submission. Budget reductions or allowlist changes can stop
already queued work. `AGENT_PROVIDER_MODE` defaults to `local`; every other mode fails
planning closed without contacting an external provider.

## API

`GET /api/v1/agents` returns permitted registry metadata, agents, settings, latest 100
visible runs and latest 100 domain-authorized approval records.
`GET /api/v1/agents?id=…` returns scoped persisted plan/trace.

`POST /api/v1/agents` actions:
- `start`: `agentId`, `requestKey`, `goal`, `maxCostMinor` (optional), `steps`.
- `advance`: `id` — advance one step; terminal/waiting runs are safe no-ops.
- `cancel`: `id`, `reason`.
- `review`: approval `id`, `decision` (`approve`/`reject`), `reason`.
- `engine`: `enabled`, `dailyCostBudgetMinor`, `dailyToolLimit`, `maxSteps`.
- `agent`: `id`, `enabled`, `autonomy`, `costBudgetMinor`, `allowedTools`.

JSON is private/no-store. Requests use existing signed-token/session transport,
never credentials in URLs. SQLite is the working runtime; Prisma is the deployment
model, not an implemented PostgreSQL switch. `npm run validate:design` checks Prisma
with matching WASM and Compose YAML/shared runtime volumes without any DB connection.
Docker container execution is not available in this sandbox and remains unverified.

## Checkpoint and next

Phase 6 tests cover ordering, independent approval/no self-review, reject/cancel/kill,
stale source snapshots, immutable intent, digest tampering, fresh RBAC on both actors,
provider fail-closed, quotas/cost controls, rollback after effects, actual SQLite
restart and **two separate worker processes racing one approved credit**. Browser
workflows cover trace UI, accountant review through role switches, kill controls and
mobile Urdu RTL. All existing tenancy, maintenance, accounting and sign-in regressions
remain part of CI. Preserved preview data is verified against the pre-Phase-5 backup.

**Final verification:** 142/142 unit/integration and 24/24 browser tests passed;
typecheck, production build and static design validation passed. Coverage: 95.43%
statements/lines, 83.56% branches, 100% functions.

**Stop after Phase 6. Phase 7 requires the user's next authorization. PR #2 stays open.**
Dependency/security hardening and real provider compliance are not certified by this
local checkpoint; existing advisory work remains Phase 8.
