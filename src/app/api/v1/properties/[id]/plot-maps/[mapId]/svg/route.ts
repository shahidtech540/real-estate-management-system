import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { sanitizedMap } from "@/server/modules/plot-maps/plot-maps.service";
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ id: string; mapId: string }> },
) {
  try {
    const { id, mapId } = await c.params;
    return new NextResponse(sanitizedMap(requireAuth(req), id, mapId), {
      headers: {
        "Content-Type": "image/svg+xml; charset=utf-8",
        "Content-Disposition": 'attachment; filename="sanitized-map.svg"',
        "Content-Security-Policy":
          "sandbox; default-src 'none'; style-src 'none'",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
