import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_DDL } from "./schema";
import { seedDatabase } from "./seed";
import { migratePhase7 } from "./phase7";
import { migratePhase6 } from "./phase6";
import { migratePhase5, seedPhase5 } from "./phase5";
import { applyBusinessProfile } from "./business-profile";
import { migratePhase4, seedPhase4 } from "./phase4";

const requireSqlite = createRequire(import.meta.url);
const { DatabaseSync } = requireSqlite("node:sqlite") as {
  DatabaseSync: new (location: string) => DatabaseSyncType;
};

let dbInstance: DatabaseSyncType | null = null;

export function getDb(): DatabaseSyncType {
  if (dbInstance) {
    return dbInstance;
  }

  const isTest = process.env.NODE_ENV === "test";
  const configuredPath = process.env.SQLITE_DB_PATH;
  const dbPath = configuredPath
    ? configuredPath
    : isTest
      ? ":memory:"
      : path.resolve(process.cwd(), "data", "rems.sqlite");

  if (dbPath !== ":memory:") {
    const dir = path.dirname(dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  dbInstance = new DatabaseSync(dbPath);
  dbInstance.exec("PRAGMA busy_timeout = 5000;");
  dbInstance.exec(SCHEMA_DDL);
  // Additive Phase 3 migration: preserve previously created tenant records.
  if (
    !dbInstance
      .prepare("PRAGMA table_info(tenants)")
      .all()
      .some((c) => c.name === "references_json")
  ) {
    dbInstance.exec(
      "ALTER TABLE tenants ADD COLUMN references_json TEXT NOT NULL DEFAULT '[]'",
    );
  }
  migratePhase4(dbInstance);
  seedDatabase(dbInstance);
  seedPhase4(dbInstance);
  // Regression suites intentionally retain the original multi-org fixture world.
  // Production, preview and browser tests always use the real business profile.
  if (process.env.NODE_ENV !== "test") applyBusinessProfile(dbInstance);
  migratePhase5(dbInstance);
  seedPhase5(dbInstance);
  migratePhase6(dbInstance);
  migratePhase7(dbInstance);

  return dbInstance;
}

/**
 * Reset database in test environments so test suites can run with a fresh state when desired.
 */
export function resetDbForTesting(): DatabaseSyncType {
  if (dbInstance) {
    try {
      dbInstance.close();
    } catch {
      // ignore close errors
    }
    dbInstance = null;
  }
  return getDb();
}
