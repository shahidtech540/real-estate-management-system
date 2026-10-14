import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { createBranch, listBranches } from "@/server/modules/admin/admin.service";

const createBranchSchema = z.object({
  code: z.string().min(2),
  name: z.string().min(2),
  city: z.string().min(2),
  address: z.string().min(4),
  phone: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    const branches = listBranches(ctx.organizationId);
    return NextResponse.json({ branches });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "admin:manage");

    const body = await req.json();
    const parsed = createBranchSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid branch creation payload." } },
        { status: 400 }
      );
    }

    const branch = createBranch(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ branch }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
