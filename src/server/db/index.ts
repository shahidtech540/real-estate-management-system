import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { SCHEMA_DDL } from "./schema";
import { seedDatabase } from "./seed";

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
  dbInstance.exec(SCHEMA_DDL);
  seedDatabase(dbInstance);

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
