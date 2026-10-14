import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { valid } from "@/server/modules/shared/domain";
import { z } from "zod";
import {
  financialReport,
  operationalReport,
  ledgerReport,
  defaultFilter,
} from "@/server/modules/accounting/reports.service";
import { exportReport } from "@/server/modules/accounting/exports";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req),
      p = req.nextUrl.searchParams,
      defaults = defaultFilter(),
      q = {
        from: p.get("from") || defaults.from,
        to: p.get("to") || defaults.to,
        ...(p.get("propertyId") ? { propertyId: p.get("propertyId")! } : {}),
        ...(p.get("ownerId") ? { ownerId: p.get("ownerId")! } : {}),
      };
    if (p.has("format"))
      return await exportReport(
        ctx,
        q,
        p.get("format")!,
        p.get("report") || "summary",
      );
    const page = valid(
      z.coerce.number().int().min(1).max(1000000),
      p.get("page") || 1,
    );
    return NextResponse.json(
      {
        financial: financialReport(ctx, q),
        operations: operationalReport(ctx, q),
        ledger: ledgerReport(ctx, q, page),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
