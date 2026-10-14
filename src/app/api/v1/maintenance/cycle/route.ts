import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { runMaintenanceCycle } from "@/server/modules/maintenance/maintenance.service";
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(runMaintenanceCycle(requireAuth(req)));
  } catch (e) {
    return handleApiError(e);
  }
}
