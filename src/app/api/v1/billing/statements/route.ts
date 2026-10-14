import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import {
  requireAuth,
  requirePermission,
  HttpError,
} from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { valid, monthSchema } from "@/server/modules/shared/domain";
import { canReadOwner } from "@/server/modules/shared/access";
import { pdfResponse } from "@/server/modules/shared/pdf";
import {
  listOwnerStatements,
  generateOwnerStatements,
  recordOwnerPayout,
} from "@/server/modules/billing/billing.service";
const cash = (n: number) => `PKR ${(n / 100).toFixed(2)}`;
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "statements:read");
    const statements = listOwnerStatements(
      ctx.organizationId,
      req.nextUrl.searchParams.get("periodMonth") || undefined,
    ).filter((s) => canReadOwner(ctx, s.ownerId));
    if (req.nextUrl.searchParams.get("format") === "pdf") {
      const s = statements.find(
        (s) => s.id === req.nextUrl.searchParams.get("id"),
      );
      if (!s) throw new HttpError(404, "NOT_FOUND", "Statement not found.");
      return pdfResponse(
        `Owner statement - ${s.periodMonth}`,
        [
          s.ownerName,
          `Status: ${s.status}`,
          ...s.lineItems.map(
            (l) =>
              `${l.propertyName} (${l.ownershipPct}%): collected share ${cash(l.ownerShareGrossRentMinor)}, expense share ${cash(l.ownerShareExpensesMinor)}`,
          ),
          `Gross collected rent: ${cash(s.grossRentMinor)}`,
          `Actual expenses: ${cash(s.expensesMinor)}`,
          `Management fee (${s.managementFeePct}%): ${cash(s.managementFeeMinor)}`,
          `Net payout: ${cash(s.netPayoutMinor)}`,
        ],
        `statement-${s.id}.pdf`,
      );
    }
    return NextResponse.json({ statements });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "accounting:write");
    const body = valid(
      z.object({ periodMonth: monthSchema }),
      await req.json(),
    );
    return NextResponse.json(
      {
        statements: generateOwnerStatements(
          ctx.organizationId,
          ctx.sub,
          body.periodMonth,
        ),
      },
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "payments:write");
    const body = valid(
      z.object({ id: z.string().min(1), reference: z.string().trim().min(1) }),
      await req.json(),
    );
    return NextResponse.json({
      statement: recordOwnerPayout(
        ctx.organizationId,
        ctx.sub,
        body.id,
        body.reference,
      ),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
