import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { readJson, rateLimit } from "@/server/security/request";
import {
  reviewMap,
  editReview,
} from "@/server/modules/plot-maps/review.service";
type Context = { params: Promise<{ id: string; mapId: string }> };
export async function GET(req: NextRequest, c: Context) {
  try {
    const { id, mapId } = await c.params,
      ctx = requireAuth(req);
    rateLimit(`plot-map-review:GET:${ctx.organizationId}:${ctx.sub}`, 60);
    return NextResponse.json(reviewMap(ctx, id, mapId));
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest, c: Context) {
  try {
    const { id, mapId } = await c.params,
      ctx = requireAuth(req);
    rateLimit(`plot-map-review:PATCH:${ctx.organizationId}:${ctx.sub}`, 60);
    return NextResponse.json(editReview(ctx, id, mapId, await readJson(req)));
  } catch (e) {
    return handleApiError(e);
  }
}
