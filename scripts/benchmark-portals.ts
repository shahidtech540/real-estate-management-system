/** Isolated synthetic test data; never touches configured/business databases. */
import { performance } from "node:perf_hooks";
import { getDb } from "../src/server/db";
import { loginWithPassword } from "../src/server/modules/auth/auth.service";
import { verifyAccessToken } from "../src/server/auth/crypto";
import { portalPage } from "../src/server/modules/portals/portals.service";
if (process.env.NODE_ENV !== "test" || process.env.SQLITE_DB_PATH)
  throw new Error(
    "Benchmark requires NODE_ENV=test and no SQLITE_DB_PATH (in-memory only).",
  );
const db = getDb(),
  ctx = verifyAccessToken(
    loginWithPassword({
      email: "tenant@fahadrealestate.test",
      password: "Password123!",
    }).accessToken!,
  )!;
const row = db
    .prepare(
      "SELECT i.* FROM invoices i JOIN tenants t ON t.id=i.tenant_id AND t.organization_id=i.organization_id WHERE t.user_id=? LIMIT 1",
    )
    .get(ctx.sub)!,
  keys = Object.keys(row),
  insert = db.prepare(
    `INSERT INTO invoices(${keys.join(",")}) VALUES(${keys.map(() => "?").join(",")})`,
  );
db.exec("BEGIN");
for (let i = 0; i < 10000; i++)
  insert.run(
    ...keys.map((k) =>
      k === "id"
        ? `bench_${i}`
        : k === "invoice_number"
          ? `BENCH-${i}`
          : k === "type"
            ? "utilities"
            : row[k],
    ),
  );
db.exec("COMMIT");
const samples = [];
for (let i = 0; i < 50; i++) {
  const start = performance.now(),
    result = portalPage(ctx, { resource: "invoices", limit: 20, page: 1 });
  if (result.items.length !== 20 || !result.hasMore)
    throw new Error("Pagination failed.");
  samples.push(performance.now() - start);
}
samples.sort((a, b) => a - b);
const p95 = samples[47];
console.log(
  JSON.stringify({
    dataset: "synthetic in-memory only",
    additionalInvoices: 10000,
    samples: 50,
    pageSize: 20,
    medianMs: samples[25],
    p95Ms: p95,
    budgetMs: 1000,
  }),
);
if (p95 > 1000) process.exitCode = 1;
