import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { valid, moneySchema } from "@/server/modules/shared/domain";
import { getPaymentGateway } from "@/server/modules/billing/adapters/gateway";
import { recordPayment } from "@/server/modules/billing/billing.service";
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "payments:write");
    const b = valid(
      z.object({
        invoiceId: z.string().min(1),
        method: z.enum(["jazzcash", "easypaisa", "stripe"]),
        amountMinor: moneySchema.positive(),
        requestId: z.string().min(8),
      }),
      await req.json(),
    );
    const confirmation = getPaymentGateway(b.method).confirm(b);
    return NextResponse.json(
      {
        ...recordPayment(ctx.organizationId, ctx.sub, {
          ...b,
          referenceNumber: confirmation.referenceNumber,
        }),
        mode: confirmation.mode,
      },
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
