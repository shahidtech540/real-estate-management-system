import { NextRequest, NextResponse } from "next/server";
import { requireAuth, HttpError } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { readJson, rateLimit } from "@/server/security/request";
import {
  portalSummary,
  portalPage,
  requestOwnerReview,
  decideOwnerReview,
  linkPortalProfile,
} from "@/server/modules/portals/portals.service";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req),
      q = Object.fromEntries(req.nextUrl.searchParams);
    return NextResponse.json(
      q.resource ? portalPage(ctx, q) : portalSummary(ctx),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    rateLimit(`portal:${ctx.organizationId}:${ctx.sub}`, 100);
    const { action, ...b } = await readJson(req);
    if (!["request_consent", "decide_consent", "link_profile"].includes(action))
      throw new HttpError(
        400,
        "UNKNOWN_ACTION",
        "Choose a consent request or decision.",
      );
    return NextResponse.json(
      action === "link_profile"
        ? linkPortalProfile(ctx, b)
        : action === "request_consent"
          ? requestOwnerReview(ctx, b)
          : decideOwnerReview(ctx, b),
      { status: 201, headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
