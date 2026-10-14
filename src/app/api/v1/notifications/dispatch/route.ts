import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { dispatchNotifications } from "@/server/modules/notifications/notifications.service";
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "admin:manage");
    return NextResponse.json(await dispatchNotifications(ctx.organizationId));
  } catch (e) {
    return handleApiError(e);
  }
}
