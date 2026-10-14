import { productionDeployment } from "../security/config";
import { NextResponse } from "next/server";
import { HttpError } from "./guards";

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof SyntaxError)
    return NextResponse.json(
      {
        error: {
          code: "INVALID_JSON",
          message: "Request body must be valid JSON.",
        },
      },
      { status: 400 },
    );
  if (err instanceof HttpError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
        },
      },
      {
        status: err.status,
        headers: {
          "Cache-Control": "private, no-store",
          ...(err.status === 429 ? { "Retry-After": "900" } : {}),
        },
      },
    );
  }

  const message = "Internal server error. The request could not be completed.";
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    { status: 500 },
  );
}

export function attachAuthCookies(
  response: NextResponse,
  tokens: {
    accessToken: string;
    refreshToken?: string;
    expiresInSeconds?: number;
  },
): NextResponse {
  response.cookies.set("rems_access_token", tokens.accessToken, {
    secure: productionDeployment(),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.expiresInSeconds || 900,
  });

  if (tokens.refreshToken) {
    response.cookies.set("rems_refresh_token", tokens.refreshToken, {
      secure: productionDeployment(),
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 3600,
    });
  }

  return response;
}

export function clearAuthCookies(response: NextResponse): NextResponse {
  response.cookies.set("rems_access_token", "", {
    secure: productionDeployment(),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("rems_refresh_token", "", {
    secure: productionDeployment(),
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
