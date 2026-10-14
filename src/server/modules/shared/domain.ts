import { randomUUID } from "node:crypto";
import { z } from "zod";
import { getDb } from "@/server/db";
import { HttpError } from "@/server/auth/guards";
export const newId = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`;
export const nowIso = () => new Date().toISOString();
export const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
/** Calendar date of an ISO timestamp in the office timezone (UTC dates can differ). */
export const sourceDate = (value: string) =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Karachi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(value));
export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (s) =>
      !isNaN(Date.parse(s)) && new Date(s).toISOString().slice(0, 10) === s,
    "Invalid date",
  );
export const monthSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/);
export const moneySchema = z
  .number()
  .int()
  .nonnegative()
  .max(1_000_000_000_000);
export function valid<S extends z.ZodTypeAny>(
  schema: S,
  value: unknown,
): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new HttpError(
      400,
      "VALIDATION_ERROR",
      result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    );
  return result.data;
}
let transactionDepth = 0;
export function atomic<T>(fn: () => T): T {
  if (transactionDepth > 0) return savepoint(fn);
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  transactionDepth++;
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  } finally {
    transactionDepth--;
  }
}

/** Synchronous nested unit of work; outer transaction retains BEGIN IMMEDIATE. */
export function savepoint<T>(fn: () => T): T {
  const db = getDb(),
    name = `sp_${randomUUID().replaceAll("-", "")}`;
  db.exec(`SAVEPOINT ${name}`);
  transactionDepth++;
  try {
    const value = fn();
    db.exec(`RELEASE SAVEPOINT ${name}`);
    return value;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
    db.exec(`RELEASE SAVEPOINT ${name}`);
    throw error;
  } finally {
    transactionDepth--;
  }
}
