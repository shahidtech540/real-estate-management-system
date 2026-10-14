import { createHash } from "node:crypto";
import { getDb } from "@/server/db";
import { HttpError } from "@/server/auth/guards";
export async function readJson(req: Request) {
  const reader = req.body?.getReader();
  if (!reader) throw new HttpError(400, "BODY_REQUIRED", "JSON body required.");
  let size = 0;
  const chunks: Uint8Array[] = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 1048576) {
      await reader.cancel();
      throw new HttpError(
        413,
        "BODY_TOO_LARGE",
        "JSON bodies are limited to 1 MiB.",
      );
    }
    chunks.push(value);
  }
  let value;
  try {
    value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "INVALID_JSON", "Invalid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new HttpError(400, "INVALID_BODY", "Expected a JSON object.");
  return value;
}
export function mutationOrigin(req: Request, credentialHeader = false) {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method) || credentialHeader)
    return;
  const target = new URL(req.url),
    host = req.headers.get("host");
  // Next's bound-server URL may use 0.0.0.0; the incoming Host is the browser's
  // actual target authority, not an Origin or spoofable forwarded-host allowlist.
  const requestOrigin = host
    ? new URL(`${target.protocol}//${host}`).origin
    : target.origin;
  const origin = req.headers.get("origin"),
    allowed = new Set([
      target.origin,
      requestOrigin,
      ...(process.env.TRUSTED_ORIGINS || "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean),
    ]);
  if (
    (origin && !allowed.has(origin)) ||
    (!origin && req.headers.get("sec-fetch-site") === "cross-site")
  )
    throw new HttpError(
      403,
      "ORIGIN_DENIED",
      "Cross-origin cookie mutations are forbidden.",
    );
}
/** Persistent fixed-window limits; no reliance on untrusted proxy IP headers. */
export function rateLimit(key: string, limit = 60, seconds = 900) {
  const db = getDb(),
    hash = createHash("sha256").update(key).digest("hex"),
    now = Math.floor(Date.now() / 1000);
  db.prepare("DELETE FROM auth_rate_limits WHERE reset_at<=?").run(now);
  if (
    !db.prepare("SELECT key FROM auth_rate_limits WHERE key=?").get(hash) &&
    Number(db.prepare("SELECT COUNT(*) n FROM auth_rate_limits").get()!.n) >=
      10000
  )
    throw new HttpError(
      429,
      "RATE_LIMIT",
      "Rate limiter capacity reached; retry later.",
    );
  const row = db
    .prepare(
      "INSERT INTO auth_rate_limits(key,count,reset_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
    )
    .get(hash, now + seconds)!;
  if (Number(row.count) > limit)
    throw new HttpError(
      429,
      "RATE_LIMIT",
      "Request quota reached; retry after the current 15-minute window.",
    );
}
