import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { readJson, rateLimit } from "@/server/security/request";
import { publishMap } from "@/server/modules/plot-maps/review.service";
type Context = { params: Promise<{ id: string; mapId: string }> };
export async function POST(req: NextRequest, c: Context) {
  try {
    const { id, mapId } = await c.params,
      ctx = requireAuth(req);
    rateLimit(`plot-map-publish:POST:${ctx.organizationId}:${ctx.sub}`, 60);
    return NextResponse.json(publishMap(ctx, id, mapId, await readJson(req)));
  } catch (e) {
    return handleApiError(e);
  }
}
