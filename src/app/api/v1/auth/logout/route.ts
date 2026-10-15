import {mutationOrigin} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { clearAuthCookies, handleApiError } from "@/server/auth/http";
import { logoutSession } from "@/server/modules/auth/auth.service";

export async function POST(req: NextRequest) {
  try {
    let ctx;try{ctx=requireAuth(req);}catch(e){if((e as {status?:number}).status!==401)throw e;mutationOrigin(req);}
    const cookieHeader = req.headers.get("cookie") || "";
    const match = cookieHeader.match(/(?:^|;\s*)rems_refresh_token=([^;]+)/);
    let refreshToken: string | undefined;
    try {refreshToken = match && match[1] ? decodeURIComponent(match[1]) : undefined;} catch {refreshToken = undefined;}

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
