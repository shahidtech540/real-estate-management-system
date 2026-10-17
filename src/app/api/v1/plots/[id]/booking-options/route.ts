import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { rateLimit } from "@/server/security/request";
import { bookingOptions } from "@/server/modules/plot-maps/bookings.service";
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = requireAuth(req);
    rateLimit(`plot-options:${ctx.organizationId}:${ctx.sub}`, 240);
    return NextResponse.json(
      bookingOptions(
        ctx,
        (await c.params).id,
        req.nextUrl.searchParams.get("q") || "",
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
