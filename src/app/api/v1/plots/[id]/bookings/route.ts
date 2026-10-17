import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { rateLimit, readJson } from "@/server/security/request";
import {
  createBooking,
  changeBooking,
} from "@/server/modules/plot-maps/bookings.service";
type Context = { params: Promise<{ id: string }> };
export async function POST(req: NextRequest, c: Context) {
  try {
    const ctx = requireAuth(req);
    rateLimit(`plot-booking:POST:${ctx.organizationId}:${ctx.sub}`, 30);
    const result = await createBooking(
      ctx,
      (await c.params).id,
      await readJson(req, 6 * 1024 * 1024),
    );
    return NextResponse.json(result, {
      status: result.replayed ? 200 : 201,
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest, c: Context) {
  try {
    const ctx = requireAuth(req);
    rateLimit(`plot-booking:PATCH:${ctx.organizationId}:${ctx.sub}`, 60);
    return NextResponse.json(
      changeBooking(ctx, (await c.params).id, await readJson(req)),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
