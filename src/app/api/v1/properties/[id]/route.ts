import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { getPropertyHierarchy } from "@/server/modules/portfolio/portfolio.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:read");

    const { id } = await context.params;
    const hierarchy = getPropertyHierarchy(ctx.organizationId, id);
    return NextResponse.json(hierarchy);
  } catch (err) {
    return handleApiError(err);
  }
}
