import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { buildAuthenticatedUserView } from "@/server/modules/auth/auth.service";
import { getDashboardSummary, listBranches } from "@/server/modules/admin/admin.service";

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    const user = buildAuthenticatedUserView(ctx.sub, ctx.organizationId);
    const branches = listBranches(ctx.organizationId);
    const summary = getDashboardSummary({
      organizationId: ctx.organizationId,
      roleSlug: user.role.slug,
      userId: user.id,
      branchId: user.branch?.id || null,
    });

    return NextResponse.json({
      user,
      branches,
      summary,
    });
  } catch (err) {
    return handleApiError(err);
  }
}
