import { DatabaseSync, backup } from "node:sqlite";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
process.umask(0o077);
async function main() {
  const source = process.env.SQLITE_DB_PATH;
  if (!source || !existsSync(source))
    throw new Error(
      "Set SQLITE_DB_PATH to an existing database; no implicit seed.",
    );
  const dest = process.argv[2];
  if (!dest || existsSync(dest) || resolve(source) === resolve(dest))
    throw new Error("Provide a new distinct destination path.");
  mkdirSync(dirname(dest), { recursive: true });
  const db = new DatabaseSync(source, { readOnly: true });
  try {
    await backup(db, dest);
    const copy = new DatabaseSync(dest, { readOnly: true });
    try {
      if (
        copy.prepare("PRAGMA integrity_check").get()!.integrity_check !==
          "ok" ||
        copy.prepare("PRAGMA foreign_key_check").all().length
      )
        throw new Error("Backup verification failed.");
      console.log("Verified SQLite online backup created:", dest);
    } finally {
      copy.close();
    }
  } finally {
    db.close();
  }
}
main().catch((e) => {
  console.error(e.message);
  process.exitCode = 1;
});
