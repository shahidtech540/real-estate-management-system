import { getDb } from "@/server/db";
import { HttpError } from "@/server/auth/guards";
/** Public domain belongs to a configured business, not an arbitrary submitted org. */
export function publicOrganizationId() {
  const db = getDb(),
    configured = process.env.PUBLIC_ORGANIZATION_ID;
  const row = configured
    ? db
        .prepare(
          "SELECT id FROM organizations WHERE id=? AND status='active' AND deleted_at IS NULL",
        )
        .get(configured)
    : db
        .prepare(
          "SELECT id FROM organizations WHERE name='Fahad Real Estate' AND status='active' AND deleted_at IS NULL ORDER BY id LIMIT 1",
        )
        .get() ||
      db
        .prepare(
          "SELECT id FROM organizations WHERE id='org_pakland' AND status='active' AND deleted_at IS NULL",
        )
        .get();
  if (!row)
    throw new HttpError(
      503,
      "PUBLIC_ORGANIZATION",
      "Configure the public business organization.",
    );
  return String(row.id);
}
