import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  valid,
  moneySchema,
  monthSchema,
} from "@/server/modules/shared/domain";
import { canReadProperty } from "@/server/modules/shared/access";
import {
  listInvoices,
  generateMonthlyRentCycle,
  createAdHocInvoice,
  applyLateFees,
  issueCreditNote,
  listCreditNotes,
  createRecurringCharge,
  listRecurringCharges,
} from "@/server/modules/billing/billing.service";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "invoices:read");
    const invoices = listInvoices({
      organizationId: ctx.organizationId,
      status: req.nextUrl.searchParams.get("status") || undefined,
      periodMonth: req.nextUrl.searchParams.get("periodMonth") || undefined,
      tenantId: req.nextUrl.searchParams.get("tenantId") || undefined,
      limit: 100000,
    }).filter((i) => canReadProperty(ctx, i.propertyId, i.tenantId));
    const ids = new Set(invoices.map((i) => i.id));
    const leaseIds = new Set(invoices.map((i) => i.leaseId));
    return NextResponse.json({
      invoices,
      recurringCharges: listRecurringCharges(ctx.organizationId).filter((c) =>
        leaseIds.has(c.leaseId),
      ),
      creditNotes: listCreditNotes(ctx.organizationId).filter((c) =>
        ids.has(String(c.invoiceId)),
      ),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "invoices:write");
    const body = await req.json();
    if (body.action === "recurring_charge")
      return NextResponse.json(
        {
          recurringCharges: createRecurringCharge(
            ctx.organizationId,
            ctx.sub,
            body,
          ),
        },
        { status: 201 },
      );
    if (body.action === "rent_cycle") {
      const input = valid(z.object({ periodMonth: monthSchema }), body);
      return NextResponse.json(
        generateMonthlyRentCycle(
          ctx.organizationId,
          ctx.sub,
          input.periodMonth,
        ),
        { status: 201 },
      );
    }
    return NextResponse.json(
      { invoice: createAdHocInvoice(ctx.organizationId, ctx.sub, body) },
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "invoices:write");
    const body = valid(
      z.discriminatedUnion("action", [
        z.object({
          action: z.literal("late_fees"),
          invoiceId: z.string().min(1).optional(),
        }),
        z.object({
          action: z.literal("credit"),
          invoiceId: z.string().min(1),
          creditMinor: moneySchema.positive(),
          reason: z.string().trim().min(1),
        }),
      ]),
      await req.json(),
    );
    return NextResponse.json(
      body.action === "late_fees"
        ? applyLateFees(ctx.organizationId, ctx.sub, body.invoiceId)
        : {
            invoice: issueCreditNote(
              ctx.organizationId,
              ctx.sub,
              body.invoiceId,
              body.creditMinor,
              body.reason,
            ),
          },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
