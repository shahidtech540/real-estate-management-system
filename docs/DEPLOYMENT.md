# Deployment and recovery runbook — Phase 8

## Supported local architecture

One Node.js **22.16+** host (online SQLite backup API) / Node 22 container, one local
persistent SQLite volume shared by the app and its three bounded local workers.
Use 22.22+ as tested. PostgreSQL/Redis/S3 are **design-only** Compose profile services,
not a runtime switch; no migration to them or multi-host SQLite deployment is claimed.
Docker configuration is statically validated; Docker execution was unavailable
in the development sandbox. Execute and inspect it in your own deployment environment.

Never expose demo credentials on a real production service. `NODE_ENV=production`
is a Next build mode; **`REMS_DEPLOYMENT=production`** is the security/provisioning
switch. Default/demo builds intentionally work in Arena's embedded preview.

## Fresh production provisioning (no business fixtures)

1. Clone the code, install and test/build it. Set a restrictive umask and choose
   an **absent** database path on encrypted persistent storage. No previous DB is
   overwritten. Set the real HTTPS origin, unique secrets and real administrator
   credentials from the host's secret manager/environment, never chat or source.

```bash
npm ci
npm run typecheck && npm run test:coverage && npm run build
umask 077
export REMS_DEPLOYMENT=production
export SQLITE_DB_PATH="$PWD/data/production.sqlite"
export JWT_ACCESS_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("hex"))')"
export JWT_REFRESH_SECRET="$(node -e 'process.stdout.write(require("node:crypto").randomBytes(48).toString("hex"))')"
# Set TRUSTED_ORIGINS and PUBLIC_SITE_URL to your actual HTTPS origin. No invented domain.
# Set ADMIN_EMAIL and ADMIN_PASSWORD securely; password must be at least 14 characters.
npm run db:provision
unset ADMIN_PASSWORD ADMIN_EMAIL
# Save the printed PUBLIC_ORGANIZATION_ID in the deployment environment.
npm start
```

The provisioner creates Fahad Real Estate, one RYK office, RBAC, one administrator
and six local agents, **zero inventory, tenants, leases, invoices or payments**.
First startup applies additive domain/schema/accounting structures, not demo money.
`db:seed` is for demo mode only, not production provisioning. Exact street address,
phone/domain and legal approvals remain operator-supplied. Create verified records
through the existing workflows; administrators explicitly link personal accounts.

2. Persist the same signing secrets across app/worker restarts. Do not print them
   into logs. `TRUSTED_ORIGINS` is a comma-separated **exact HTTPS origin** allowlist;
   set it when a TLS proxy changes the internal request URL. Strip incoming forwarded
   headers at the trusted proxy, and enforce ingress per-IP/body/time/connection limits.
3. Terminate HTTPS at a trusted reverse proxy. Proxy relative `/api/v1/*` and Next
   assets to the same app; browsers must not call the server's localhost. Bind the
   app to 0.0.0.0; firewall its direct port. HSTS does not replace TLS termination.
4. Production framing defaults to `'self'`. Set `FRAME_ANCESTORS` to explicit HTTPS
   parent origins only if approved embedding is required; never `*`. Demo alone
   permits wildcard embedding. Inline Next script/style CSP allowances remain.
5. Configure local/mock providers: `AGENT_PROVIDER_MODE=local`,
   `NOTIFICATION_PROVIDER_MODE=mock`. A live provider mode fails closed where an
   adapter is not implemented. Do not claim bank/email/SMS delivery from mock states.
6. Use a service manager for `npm start`, `npm run maintenance:worker`,
   `npm run reports:worker` and `npm run agents:worker`, each with the **same DB path**
   and security environment. Gracefully stop all of them before offline restore.
   No horizontal replicas over a network-mounted SQLite file. Keep OS UTC; UI/account
   periods remain explicit PKR/minor-unit domain values rather than inferred dates.

## Container workflow

The runtime image is non-root, prunes development dependencies, includes runtime
`tsx` CLIs and excludes Git, local databases, environment secrets and test output
from the build context. All workers share `sqlite_data:/app/data`.

For demo only: `docker compose up --build` (no real business information).
For real deployment, securely supply the production variables above, then:

```bash
docker compose build
# Set ADMIN_EMAIL / ADMIN_PASSWORD in the secure host environment for this one command.
docker compose run --rm -e ADMIN_EMAIL -e ADMIN_PASSWORD app npm run db:provision
# Persist printed PUBLIC_ORGANIZATION_ID; remove bootstrap credentials.
docker compose up -d
```

App/worker production secrets come from the environment; demo defaults cause explicit
production validation to fail. New named volume inherits `/app/data` ownership.
For an existing/bind-mounted directory, ensure the container `node` UID (1000) can
write it and no unrelated users can read it. Do not solve permissions by running
as root or using world-writable directories. Design-only Postgres/Redis/MinIO
services require `--profile design` and use development credentials: do not expose
those services or ports as production infrastructure. Default app healthcheck polls
`/api/v1/health` and workers wait for a healthy app.

## Upgrading an existing database

Do not replace, re-seed or provision over a live DB. Preserve its exact path/volume.
Create and verify an online backup first; then stop app/workers, deploy the tested
code and start the app before workers. Migrations are additive/idempotent, but
rehearse against a **copy** first. Production refuses active `@fahadrealestate.test`
accounts; suspend/remove their access and set real credentials in a controlled
administrator migration **before** enabling production. No auto-conversion of demo
money into real records. Previously signed legacy token versions default to zero;
authenticated logout increments the version and revokes all sessions for that user.

## Online backup, verification and restore

```bash
# SQLITE_DB_PATH must already point to the desired database; destination must not exist.
npm run db:backup -- ./data/backups/rems-$(date -u +%Y%m%dT%H%M%SZ).sqlite
# Container equivalent (same mounted volume):
docker compose exec app npm run db:backup -- /app/data/backups/new-unique-name.sqlite
```

Uses Node's SQLite online backup, so committed WAL state is included while the app
runs. The backup is checked with `PRAGMA integrity_check` and `foreign_key_check`.
The CLI refuses overwrite/source-equals-destination and creates files with restrictive
umask. Never copy only a live `.sqlite` file and ignore its WAL. Encrypt backups,
copy them off-host, and verify checksums and recovery regularly. Suggested initial
policy: daily backups retained 30 days, plus a verified pre-upgrade backup; determine
RPO/RTO from actual business needs, not this benchmark.

Restore steps:

1. Stop app **and all workers**. Preserve the current DB and any WAL/SHM files as an
   incident snapshot in a separate restricted directory; do not delete history.
2. Verify the candidate backup on a separate path using Node `DatabaseSync` or
   SQLite CLI (`PRAGMA integrity_check; PRAGMA foreign_key_check;`). Check source
   identity/counts/financial totals against your recorded backup manifest.
3. Point `SQLITE_DB_PATH` at a **new restored copy** of that verified backup. For
   Compose's fixed path, use a separate restored volume/deployment; never leave old
   WAL/SHM files next to a replacement main file. Keep the incident snapshot intact.
4. Start the app, inspect health/login/personal scopes and reconcile ledger/invoice/
   receipt/statement totals. Only then restart workers and reopen ingress.
5. For compromise, rotate both JWT secrets and re-enroll affected credentials/2FA;
   secret rotation alone does not erase already-stored refresh hashes or accounting
   evidence. Assess audit/source integrity before accepting restored data.

Rollback: stop writers, restore the **pre-upgrade** verified copy into a separate
volume/path, deploy matching earlier code, check integrity and totals, then reopen.
Do not run old code against an unreviewed newer schema or rewrite immutable journals.

## Monitoring and launch checklist

- Poll health, monitor 5xx/429 rates, rejected origins/session revocation, worker
  failures, queue backlog, SQLite busy locks, disk capacity and backup age.
- Record deployed commit/environment (without secrets) and a backup manifest.
- Check personal account links with two independent identities before launch;
  run the negative tests and verify independent financial/agent approvers.
- Confirm backups restore, TLS/framing/cookies/limits work at the actual origin.
- `npm run audit:production` is the runtime gate. Full build audit has a documented
  unresolved Tailwind/braces advisory chain: do not build from untrusted globs.
- Obtain an independent security/operational/legal review before real adoption.
  No certification, distributed HA, live payments/outbound providers or recovered
  historical database is implied by the fresh Arena demo.
