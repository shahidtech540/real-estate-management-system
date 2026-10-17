import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  HttpError,
} from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { rateLimit } from "@/server/security/request";
import { plotTokenInvoices } from "@/server/modules/billing/plot-invoices";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    if (ctx.roleSlug !== "admin")
      throw new HttpError(
        403,
        "PLOT_MAP_ADMIN",
        "Plot billing is administrator-only until Phase E.",
      );
    for (const p of ["admin:manage", "properties:write", "invoices:read"])
      requirePermission(ctx, p);
    rateLimit(`plot-invoices:${ctx.organizationId}:${ctx.sub}`, 120);
    return NextResponse.json(
      { invoices: plotTokenInvoices(ctx.organizationId) },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
