import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  listViewings,
  scheduleViewing,
  updateViewingStatus,
} from "@/server/modules/crm/crm.service";

const scheduleSchema = z.object({
  leadId: z.string().min(1),
  unitId: z.string().min(1),
  agentId: z.string().optional(),
  scheduledAt: z.string().min(4),
  feedback: z.string().optional(),
});

const updateViewingSchema = z.object({
  viewingId: z.string().min(1),
  status: z.enum(["scheduled", "completed", "cancelled", "no_show"]),
  feedback: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leads:read");

    const { searchParams } = new URL(req.url);
    const leadId = searchParams.get("leadId") || undefined;
    const viewings = listViewings(ctx.organizationId, leadId);
    return NextResponse.json({ viewings });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "viewings:manage");

    const body = await readJson(req);
    const parsed = scheduleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid viewing payload." } },
        { status: 400 }
      );
    }

    const viewing = scheduleViewing(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ viewing }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "viewings:manage");

    const body = await readJson(req);
    const parsed = updateViewingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid viewing update payload." } },
        { status: 400 }
      );
    }

    const viewing = updateViewingStatus(
      ctx.organizationId,
      ctx.sub,
      parsed.data.viewingId,
      {
        status: parsed.data.status,
        feedback: parsed.data.feedback,
      }
    );

    return NextResponse.json({ viewing });
  } catch (err) {
    return handleApiError(err);
  }
}
