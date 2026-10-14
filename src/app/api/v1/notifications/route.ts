import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { z } from "zod";
import { valid } from "@/server/modules/shared/domain";
import {
  listNotifications,
  composeNotification,
  markRead,
  retryNotification,
} from "@/server/modules/notifications/notifications.service";
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json(
      listNotifications(requireAuth(req), {
        ...Object.fromEntries(req.nextUrl.searchParams),
        outbox: req.nextUrl.searchParams.get("outbox") === "true",
      }),
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    return NextResponse.json(
      composeNotification(requireAuth(req), await readJson(req)),
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    const b = valid(
      z.object({ id: z.string().min(1), action: z.enum(["read", "retry"]) }),
      await readJson(req),
    );
    return NextResponse.json(
      b.action === "read" ? markRead(ctx, b.id) : retryNotification(ctx, b.id),
    );
  } catch (e) {
    return handleApiError(e);
  }
}
