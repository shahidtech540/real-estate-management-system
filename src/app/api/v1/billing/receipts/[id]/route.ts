import { NextRequest } from "next/server";
import {
  requireAuth,
  requirePermission,
  HttpError,
} from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { assertReadable } from "@/server/modules/shared/access";
import { pdfResponse } from "@/server/modules/shared/pdf";
import {
  listInvoices,
  listPaymentsAndReceipts,
} from "@/server/modules/billing/billing.service";
import { recordAuditLog } from "@/server/modules/audit/audit.service";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "payments:read");
    const { id } = await params;
    const receipt = listPaymentsAndReceipts(ctx.organizationId).find(
      (r) => r.receiptId === id,
    );
    if (!receipt) throw new HttpError(404, "NOT_FOUND", "Receipt not found.");
    const invoice = listInvoices({
      organizationId: ctx.organizationId,
      limit: 100000,
    }).find((i) => i.id === receipt.invoiceId)!;
    assertReadable(ctx, invoice.propertyId, invoice.tenantId);
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "receipt.downloaded",
      entityType: "receipt",
      entityId: id,
    });
    return pdfResponse(
      `Payment receipt - ${receipt.receiptNumber}`,
      [
        receipt.propertyName,
        `Unit: ${receipt.unitNumber}`,
        `Received from: ${receipt.tenantName}`,
        `Invoice: ${receipt.invoiceNumber} (${receipt.periodMonth})`,
        `Amount received: PKR ${(receipt.amountMinor / 100).toFixed(2)}`,
        `Method: ${receipt.method}`,
        `Transaction reference: ${receipt.referenceNumber}`,
        `Paid at: ${receipt.paidAt}`,
        `Receipt ID: ${id}`,
        "This receipt acknowledges a recorded payment. External bank or wallet confirmation must be independently verified.",
      ],
      `${receipt.receiptNumber}.pdf`,
    );
  } catch (e) {
    return handleApiError(e);
  }
}
