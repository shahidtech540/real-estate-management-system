import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { z } from "zod";
import { valid } from "@/server/modules/shared/domain";
import { saveSchedule } from "@/server/modules/maintenance/maintenance.service";
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(saveSchedule(requireAuth(req), await req.json()), {
      status: 201,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const b = valid(
      z.object({ id: z.string().min(1), data: z.unknown() }),
      await req.json(),
    );
    return NextResponse.json(saveSchedule(requireAuth(req), b.data, b.id));
  } catch (e) {
    return handleApiError(e);
  }
}
