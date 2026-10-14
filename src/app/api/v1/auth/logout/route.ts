import { NextRequest, NextResponse } from "next/server";
import { extractAuthContext } from "@/server/auth/guards";
import { clearAuthCookies, handleApiError } from "@/server/auth/http";
import { logoutSession } from "@/server/modules/auth/auth.service";

export async function POST(req: NextRequest) {
  try {
    const ctx = extractAuthContext(req);
    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(/(?:^|;\s*)rems_refresh_token=([^;]+)/);
    const refreshToken = match && match[1] ? decodeURIComponent(match[1]) : undefined;

    logoutSession({
      refreshToken,
      userId: ctx?.sub,
      organizationId: ctx?.organizationId,
    });

    const res = NextResponse.json({ loggedOut: true });
    clearAuthCookies(res);
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
