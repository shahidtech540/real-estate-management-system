import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { rateLimit } from "@/server/security/request";
import { bookingFile } from "@/server/modules/plot-maps/bookings.service";
export async function GET(
  req: NextRequest,
  c: { params: Promise<{ id: string; fileId: string }> },
) {
  try {
    const ctx = requireAuth(req);
    rateLimit(`plot-file:${ctx.organizationId}:${ctx.sub}`, 120);
    const { id, fileId } = await c.params,
      f = bookingFile(ctx, id, fileId);
    return new NextResponse(f.bytes, {
      headers: {
        "Content-Type": f.mimeType,
        "Content-Disposition": `attachment; filename="${f.name.replace(/[^a-zA-Z0-9_.-]/g, "_")}"`,
        "Content-Security-Policy": "sandbox; default-src 'none'",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return handleApiError(e);
  }
}
