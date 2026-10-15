import {productionDeployment} from "@/server/security/config";
import {mutationOrigin,rateLimit,readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { listDemoAccounts, loginWithPassword } from "@/server/modules/auth/auth.service";
import { attachAuthCookies, handleApiError } from "@/server/auth/http";

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1).max(256),
  organizationSlug: z.string().optional(),
  twoFactorCode: z.string().optional(),
});

export async function GET() {
  try {
    const accounts = listDemoAccounts();
    return NextResponse.json({accounts,demoEnabled:!productionDeployment()});
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    mutationOrigin(req);
    rateLimit("login:global",300);
    const body = await readJson(req);
    rateLimit("login:"+String(body?.email||"unknown").trim().toLowerCase().replace(/@pakland\.pk$/,"@fahadrealestate.test"));
    const parsed = loginSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Please provide a valid email and password.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const ipAddress =
      req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "REMS-Browser";

    const result = loginWithPassword({
      ...parsed.data,
      ipAddress,
      userAgent,
    });

    if (result.requiresTwoFactor) {
      return NextResponse.json({
        requiresTwoFactor: true,
        message: "Two-factor authentication code required.",
      });
    }

    const res = NextResponse.json({
      requiresTwoFactor: false,
      accessToken: result.accessToken,
      refreshToken: result.refreshToken,
      expiresInSeconds: result.expiresInSeconds,
      user: result.user,
    });

    if (result.accessToken) {
      attachAuthCookies(res, {
        accessToken: result.accessToken,
        refreshToken: result.refreshToken,
        expiresInSeconds: result.expiresInSeconds,
      });
    }

    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
