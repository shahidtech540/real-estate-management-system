import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { valid, moneySchema } from "@/server/modules/shared/domain";
import { canReadProperty } from "@/server/modules/shared/access";
import {
  listInvoices,
  listPaymentsAndReceipts,
  recordPayment,
} from "@/server/modules/billing/billing.service";
const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  method: z.enum(["bank_transfer", "cash", "jazzcash", "easypaisa", "stripe"]),
  amountMinor: moneySchema.positive(),
  referenceNumber: z.string().trim().min(1),
});
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "payments:read");
    const visible = new Set(
      listInvoices({ organizationId: ctx.organizationId, limit: 100000 })
        .filter((i) => canReadProperty(ctx, i.propertyId, i.tenantId))
        .map((i) => i.id),
    );
    return NextResponse.json({
      payments: listPaymentsAndReceipts(ctx.organizationId).filter((p) =>
        visible.has(p.invoiceId),
      ),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "payments:write");
    const body = valid(paymentSchema, await req.json());
    return NextResponse.json(recordPayment(ctx.organizationId, ctx.sub, body), {
      status: 201,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
