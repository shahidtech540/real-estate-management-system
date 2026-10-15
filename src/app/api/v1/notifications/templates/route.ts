import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  templates,
  saveTemplate,
} from "@/server/modules/notifications/notifications.service";
export async function GET(req: NextRequest) {
  try {
    return NextResponse.json({ templates: templates(requireAuth(req)) });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PUT(req: NextRequest) {
  try {
    return NextResponse.json({
      templates: saveTemplate(requireAuth(req), await readJson(req)),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
