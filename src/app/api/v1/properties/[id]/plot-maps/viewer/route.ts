import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { rateLimit } from "@/server/security/request";
import { publishedMap } from "@/server/modules/plot-maps/viewer.service";
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await c.params,
      ctx = requireAuth(req);
    rateLimit(`plot-map-viewer:${ctx.organizationId}:${ctx.sub}`, 60);
    return NextResponse.json(publishedMap(ctx, id), {
      headers: {
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
