import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { getMap } from "@/server/modules/plot-maps/plot-maps.service";
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ id: string; mapId: string }> },
) {
  try {
    const { id, mapId } = await c.params;
    return NextResponse.json(
      getMap(
        requireAuth(req),
        id,
        mapId,
        Object.fromEntries(req.nextUrl.searchParams),
      ),
    );
  } catch (e) {
    return handleApiError(e);
  }
}
