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
export function valid<S extends z.ZodTypeAny>(schema: S, value: unknown): z.output<S> {
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
export function atomic<T>(fn: () => T): T {
  const db = getDb();
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (e) {
    db.exec("ROLLBACK");
    throw e;
  }
}

/** Nestable unit of work for ad-hoc billing, also called by the monthly cycle. */
export function savepoint<T>(fn: () => T): T {
 const db=getDb(),name=`sp_${randomUUID().replaceAll('-','')}`;
 db.exec(`SAVEPOINT ${name}`);
 try {const value=fn();db.exec(`RELEASE SAVEPOINT ${name}`);return value;}
 catch(error){db.exec(`ROLLBACK TO SAVEPOINT ${name}`);db.exec(`RELEASE SAVEPOINT ${name}`);throw error;}
}
