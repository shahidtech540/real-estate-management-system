import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  maintenanceBoard,
  createTicket,
} from "@/server/modules/maintenance/maintenance.service";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    return NextResponse.json(
      maintenanceBoard(ctx, Object.fromEntries(req.nextUrl.searchParams)),
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(
      { ticket: createTicket(requireAuth(req), await readJson(req)) },
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
