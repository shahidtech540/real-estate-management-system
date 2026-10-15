import {mutationOrigin,readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { refreshSession } from "@/server/modules/auth/auth.service";
import { attachAuthCookies, handleApiError } from "@/server/auth/http";

export async function POST(req: NextRequest) {
  try {
    mutationOrigin(req);
    let refreshToken = "";
    if (req.body) {
      const body = await readJson(req);
      if (body && typeof body.refreshToken === "string") {
        refreshToken = body.refreshToken;
      }
    }

    if (!refreshToken) {
      const cookieHeader = req.headers.get("cookie") || "";
      const match = cookieHeader.match(/(?:^|;\s*)rems_refresh_token=([^;]+)/);
      if (match && match[1]) {
        try { refreshToken = decodeURIComponent(match[1]); } catch { refreshToken = ""; }
      }
    }

    if (!refreshToken) {
      return NextResponse.json(
        { error: { code: "MISSING_REFRESH_TOKEN", message: "Refresh token is required." } },
        { status: 401 }
      );
    }

    const ipAddress =
      req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "REMS-Browser";

    const refreshed = refreshSession({
      refreshToken,
      ipAddress,
      userAgent,
    });

    const res = NextResponse.json(refreshed);
    attachAuthCookies(res, {
      accessToken: refreshed.accessToken,
      refreshToken: refreshed.refreshToken,
      expiresInSeconds: refreshed.expiresInSeconds,
    });
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
