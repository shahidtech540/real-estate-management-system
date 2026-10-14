import { NextRequest, NextResponse } from "next/server";
export function middleware(req: NextRequest) {
  const response = NextResponse.next(),
    production = process.env.REMS_DEPLOYMENT === "production",
    frames = process.env.FRAME_ANCESTORS || (production ? "'self'" : "*");
  response.headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors ${frames}; form-action 'self'`,
  );
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  if (req.nextUrl.pathname.startsWith("/api/"))
    response.headers.set("Cache-Control", "private, no-store");
  if (process.env.REMS_DEPLOYMENT === "production")
    response.headers.set("Strict-Transport-Security", "max-age=31536000");
  return response;
}
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
