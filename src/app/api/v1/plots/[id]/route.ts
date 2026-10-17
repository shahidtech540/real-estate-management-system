import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { rateLimit } from "@/server/security/request";
import { plotDetails } from "@/server/modules/plot-maps/bookings.service";
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = requireAuth(req);
    rateLimit(`plot-details:${ctx.organizationId}:${ctx.sub}`, 120);
    return NextResponse.json(plotDetails(ctx, (await c.params).id), {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
