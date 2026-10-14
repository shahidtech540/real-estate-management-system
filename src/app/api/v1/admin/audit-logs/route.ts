import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { listAuditLogs } from "@/server/modules/audit/audit.service";

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    const { searchParams } = new URL(req.url);
    const action = searchParams.get("action") || undefined;
    const limit = parseInt(searchParams.get("limit") || "25", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    const result = listAuditLogs({
      organizationId: ctx.organizationId,
      actionFilter: action,
      limit,
      offset,
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}
