/** Creates an EMPTY real-business database; never seeds inventory or money. */
import { DatabaseSync } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
process.umask(0o077);
import { randomUUID } from "node:crypto";
import { SCHEMA_DDL } from "../src/server/db/schema";
import {
  ROLE_DEFINITIONS,
  PERMISSION_CATALOG,
} from "../src/server/auth/rbac-catalog";
import { hashPassword } from "../src/server/auth/crypto";
import {
  validateDeployment,
  productionDeployment,
} from "../src/server/security/config";
validateDeployment();
if (!productionDeployment()) throw new Error("Use REMS_DEPLOYMENT=production.");
const path = process.env.SQLITE_DB_PATH!,
  email = process.env.ADMIN_EMAIL || "",
  password = process.env.ADMIN_PASSWORD || "";
if (existsSync(path))
  throw new Error("Refusing to overwrite any existing database.");
if (
  !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
  /\.test$/i.test(email) ||
  password.length < 14 ||
  password === "Password123!"
)
  throw new Error(
    "Provide a real ADMIN_EMAIL and a 14+ character ADMIN_PASSWORD via the environment, never chat.",
  );
mkdirSync(dirname(path), { recursive: true });
const db = new DatabaseSync(path),
  now = new Date().toISOString(),
  org = "org_" + randomUUID(),
  admin = "usr_" + randomUUID(),
  branch = "br_" + randomUUID();
db.exec(SCHEMA_DDL);
db.exec("BEGIN IMMEDIATE");
try {
  db.prepare(
    "INSERT INTO organizations(id,slug,name,legal_name,created_at,updated_at) VALUES(?,?,?,?,?,?)",
  ).run(
    org,
    "fahad-real-estate",
    "Fahad Real Estate",
    "Fahad Real Estate",
    now,
    now,
  );
  db.prepare(
    "INSERT INTO branches(id,organization_id,code,name,city,address,is_headquarters,created_at,updated_at) VALUES(?,?,?,?,?,?,1,?,?)",
  ).run(
    branch,
    org,
    "RYK",
    "Fahad Real Estate — Rahim Yar Khan Office",
    "Rahim Yar Khan",
    "Exact street address not supplied",
    now,
    now,
  );
  for (const p of PERMISSION_CATALOG)
    db.prepare(
      "INSERT INTO permissions(id,organization_id,code,module,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(`${org}_${p.code}`, org, p.code, p.module, p.description, now, now);
  for (const r of ROLE_DEFINITIONS) {
    const rid = `${org}_${r.slug}`;
    db.prepare(
      "INSERT INTO roles(id,organization_id,slug,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
    ).run(rid, org, r.slug, r.name, r.description, now, now);
    for (const code of r.permissions)
      db.prepare(
        "INSERT INTO role_permissions(id,organization_id,role_id,permission_id,created_at,updated_at) VALUES(?,?,?,?,?,?)",
      ).run(randomUUID(), org, rid, `${org}_${code}`, now, now);
  }
  db.prepare(
    "INSERT INTO users(id,organization_id,branch_id,role_id,email,password_hash,full_name,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)",
  ).run(
    admin,
    org,
    branch,
    `${org}_admin`,
    email.toLowerCase(),
    hashPassword(password),
    "Administrator",
    now,
    now,
  );
  for (const [kind, slug] of [
    ["lead", "lead-agent"],
    ["listing", "listing-agent"],
    ["rent", "rent-collection-agent"],
    ["maintenance", "maintenance-triage-agent"],
    ["lease", "lease-lifecycle-agent"],
    ["insights", "insights-knowledge-agent"],
  ])
    db.prepare(
      "INSERT INTO agents(id,organization_id,slug,name,description,goal,autonomy_level,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?)",
    ).run(
      randomUUID(),
      org,
      slug,
      `${kind} agent`,
      "Source-backed local rules; no configured live model",
      "Use only authorized cited records",
      kind === "insights" ? "suggest_only" : "act_with_approval",
      now,
      now,
      admin,
    );
  db.exec("COMMIT");
  console.log("PUBLIC_ORGANIZATION_ID=" + org);
  console.log(
    "Empty Fahad Real Estate database provisioned. One office, one administrator; zero properties, leases, invoices or payments. Start the app once to apply additive migrations.",
  );
} catch (e) {
  db.exec("ROLLBACK");
  throw e;
} finally {
  db.close();
}
