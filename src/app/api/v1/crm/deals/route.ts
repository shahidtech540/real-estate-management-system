import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { createDealFromLead, listDeals } from "@/server/modules/crm/crm.service";

const createDealSchema = z.object({
  leadId: z.string().min(1),
  unitId: z.string().min(1),
  dealType: z.enum(["sale", "lease"]),
  dealValueMinor: z.number().positive(),
  commissionPct: z.number().min(0).max(25),
  clientCnic: z.string().optional(),
  agentSplits: z
    .array(
      z.object({
        agentId: z.string().min(1),
        agentName: z.string().optional(),
        splitPct: z.number().positive().max(100),
      })
    )
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "deals:read");

    const deals = listDeals(ctx.organizationId);
    return NextResponse.json({ deals });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "deals:write");

    const body = await readJson(req);
    const parsed = createDealSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid deal payload.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const deal = createDealFromLead(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ deal }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
