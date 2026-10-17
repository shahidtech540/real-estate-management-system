import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { readJson, rateLimit } from "@/server/security/request";
import {
  exportReviewCsv,
  importReviewCsv,
} from "@/server/modules/plot-maps/review.service";
type Context = { params: Promise<{ id: string; mapId: string }> };
export async function GET(req: NextRequest, c: Context) {
  try {
    const { id, mapId } = await c.params,
      ctx = requireAuth(req);
    rateLimit(`plot-map-csv:GET:${ctx.organizationId}:${ctx.sub}`, 60);
    return new NextResponse(exportReviewCsv(ctx, id, mapId), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="plot-map.csv"',
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest, c: Context) {
  try {
    const { id, mapId } = await c.params,
      ctx = requireAuth(req);
    rateLimit(`plot-map-csv:POST:${ctx.organizationId}:${ctx.sub}`, 60);
    return NextResponse.json(
      importReviewCsv(ctx, id, mapId, await readJson(req)),
    );
  } catch (e) {
    return handleApiError(e);
  }
}
