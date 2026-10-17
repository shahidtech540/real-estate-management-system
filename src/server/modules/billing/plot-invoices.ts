import { getDb } from "@/server/db";
import { newId, nowIso } from "../shared/domain";
import { recordAuditLog } from "../audit/audit.service";
export const plotInvoiceNumber = (bookingId: string) =>
  `PT-${bookingId.replace(/^pbk_/, "").toUpperCase()}`;
/** Called only inside the booking transaction. A requested token is NOT money received. */
export function createPlotTokenInvoice(
  org: string,
  actor: string,
  bookingId: string,
  amount: number,
  currency: string,
  date: string,
) {
  const id = newId("pinv"),
    number = plotInvoiceNumber(bookingId),
    now = nowIso();
  getDb()
    .prepare(
      "INSERT INTO plot_token_invoices(id,organization_id,booking_id,invoice_number,amount_minor,currency,due_date,status,created_at,updated_at,created_by) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      id,
      org,
      bookingId,
      number,
      amount,
      currency,
      date,
      amount ? "pending" : "not_due",
      now,
      now,
      actor,
    );
  recordAuditLog({
    organizationId: org,
    actorUserId: actor,
    action: "billing.plot_token.invoiced",
    entityType: "plot_booking",
    entityId: bookingId,
    metadata: {
      invoiceId: id,
      amountMinor: amount,
      currency,
      paymentRecorded: false,
    },
  });
  return { id, invoiceNumber: number };
}
export function cancelPlotTokenInvoice(
  org: string,
  actor: string,
  booking: string,
) {
  getDb()
    .prepare(
      "UPDATE plot_token_invoices SET status='cancelled',updated_at=? WHERE organization_id=? AND booking_id=?",
    )
    .run(nowIso(), org, booking);
  recordAuditLog({
    organizationId: org,
    actorUserId: actor,
    action: "billing.plot_token.cancelled",
    entityType: "plot_booking",
    entityId: booking,
  });
}

/** Minimal separate register: never mixes buyer obligations into rental tenant balances. */
export function plotTokenInvoices(org: string) {
  return getDb()
    .prepare(
      `SELECT i.id,i.booking_id,i.invoice_number,i.amount_minor,i.currency,i.due_date,i.status,p.id plot_id,p.plot_number,r.name project_name FROM plot_token_invoices i JOIN plot_bookings b ON b.id=i.booking_id AND b.organization_id=i.organization_id JOIN plots p ON p.id=b.plot_id AND p.organization_id=b.organization_id JOIN properties r ON r.id=p.project_id AND r.organization_id=p.organization_id WHERE i.organization_id=? ORDER BY i.created_at DESC,i.id DESC LIMIT 200`,
    )
    .all(org);
}
