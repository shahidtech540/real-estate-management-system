import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  createLead,
  listLeads,
  updateLeadStageOrActivity,
  VALID_LEAD_SOURCES,
  VALID_LEAD_STAGES,
} from "@/server/modules/crm/crm.service";

const createLeadSchema = z.object({
  listingId: z.string().optional(),
  branchId: z.string().optional(),
  assignedAgentId: z.string().optional(),
  fullName: z.string().min(2),
  phone: z.string().min(6),
  email: z.string().email().optional().or(z.literal("")),
  source: z.enum(VALID_LEAD_SOURCES),
  stage: z.enum(VALID_LEAD_STAGES).optional(),
  budgetMinor: z.number().min(0).optional(),
  requirementsText: z.string().optional(),
});

const updateLeadSchema = z.object({
  leadId: z.string().min(1),
  stage: z.enum(VALID_LEAD_STAGES).optional(),
  assignedAgentId: z.string().optional(),
  noteText: z.string().optional(),
  taskText: z.string().optional(),
  taskDueDate: z.string().optional(),
  toggleTaskId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leads:read");

    const { searchParams } = new URL(req.url);
    const leads = listLeads({
      organizationId: ctx.organizationId,
      stage: searchParams.get("stage") || undefined,
      source: searchParams.get("source") || undefined,
      assignedAgentId: searchParams.get("assignedAgentId") || undefined,
      search: searchParams.get("search") || undefined,
    });

    return NextResponse.json({ leads });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leads:write");

    const body = await req.json();
    const parsed = createLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid lead creation payload.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const lead = createLead(ctx.organizationId, ctx.sub, {
      ...parsed.data,
      email: parsed.data.email || undefined,
    });
    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leads:write");

    const body = await req.json();
    const parsed = updateLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid lead update payload." } },
        { status: 400 }
      );
    }

    const lead = updateLeadStageOrActivity(
      ctx.organizationId,
      ctx.sub,
      parsed.data.leadId,
      {
        stage: parsed.data.stage,
        assignedAgentId: parsed.data.assignedAgentId,
        noteText: parsed.data.noteText,
        taskText: parsed.data.taskText,
        taskDueDate: parsed.data.taskDueDate,
        toggleTaskId: parsed.data.toggleTaskId,
      }
    );

    return NextResponse.json({ lead });
  } catch (err) {
    return handleApiError(err);
  }
}
