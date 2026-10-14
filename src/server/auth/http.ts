import { NextResponse } from "next/server";
import { HttpError } from "./guards";

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof HttpError) {
    return NextResponse.json(
      {
        error: {
          code: err.code,
          message: err.message,
        },
      },
      { status: err.status }
    );
  }

  const message = err instanceof Error ? err.message : "Internal server error";
  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message,
      },
    },
    { status: 500 }
  );
}

export function attachAuthCookies(
  response: NextResponse,
  tokens: { accessToken: string; refreshToken?: string; expiresInSeconds?: number }
): NextResponse {
  response.cookies.set("rems_access_token", tokens.accessToken, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: tokens.expiresInSeconds || 900,
  });

  if (tokens.refreshToken) {
    response.cookies.set("rems_refresh_token", tokens.refreshToken, {
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
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("rems_refresh_token", "", {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
