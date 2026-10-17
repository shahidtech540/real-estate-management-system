import type { JwtPayload } from "@/server/auth/crypto";
import { getDb } from "@/server/db";
import { createLead } from "./crm.service";
import { HttpError } from "@/server/auth/guards";
import { nowIso } from "../shared/domain";
/** Existing clients keep their lead identity; no fake rental unit/deal or commission. */
export function linkPlotBookingLead(
  ctx: JwtPayload,
  clientId: string,
  agent: string,
  plotNumber: string,
  price: number,
  currency: string,
) {
  const db = getDb(),
    client = db
      .prepare(
        "SELECT * FROM clients WHERE organization_id=? AND id=? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, clientId)!;
  if (client.lead_id) {
    const lead = db
      .prepare(
        "SELECT id FROM leads WHERE organization_id=? AND id=? AND deleted_at IS NULL",
      )
      .get(ctx.organizationId, client.lead_id);
    if (!lead)
      throw new HttpError(
        409,
        "CLIENT_LEAD_INVALID",
        "Existing client lead is unavailable; resolve it in CRM first.",
      );
    return String(lead.id);
  }
  const branch = db
    .prepare(
      "SELECT id FROM branches WHERE organization_id=? AND deleted_at IS NULL ORDER BY id LIMIT 1",
    )
    .get(ctx.organizationId);
  if (!branch)
    throw new HttpError(
      409,
      "BRANCH_REQUIRED",
      "Configure an organization office before booking.",
    );
  const lead = createLead(ctx.organizationId, ctx.sub, {
    branchId: String(branch.id),
    assignedAgentId: agent,
    fullName: String(client.full_name),
    phone: String(client.phone),
    email: client.email ? String(client.email) : undefined,
    source: "walk_in",
    stage: "negotiation",
    budgetMinor: price,
    requirementsText: `Plot ${plotNumber} booking; catalogue amount ${currency} ${price} minor units. Not a closed sale.`,
  });
  // createLead's legacy default is PKR. Preserve this plot's actual denomination.
  db.prepare(
    "UPDATE leads SET currency=? WHERE id=? AND organization_id=?",
  ).run(currency, lead.id, ctx.organizationId);
  db.prepare(
    "UPDATE clients SET lead_id=?,updated_at=? WHERE organization_id=? AND id=?",
  ).run(lead.id, nowIso(), ctx.organizationId, clientId);
  return lead.id;
}
