import { beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ACCESS_TOKEN_HEADER } from "@/lib/auth-transport";
import { resetDbForTesting } from "@/server/db";
import { loginWithPassword } from "@/server/modules/auth/auth.service";
import { DEMO_PASSWORD } from "@/server/db/seed";
import { GET as me } from "@/app/api/v1/auth/me/route";
import { GET as leads } from "@/app/api/v1/crm/leads/route";
import { POST as invoices } from "@/app/api/v1/billing/invoices/route";
import { extractAuthContext } from "@/server/auth/guards";

beforeEach(() => resetDbForTesting());
const token = (email = "admin@pakland.pk") =>
  loginWithPassword({ email, password: DEMO_PASSWORD }).accessToken!;
function req(headers: Record<string, string>, method = "GET", body?: unknown) {
  return new NextRequest("http://localhost:3000/api/v1/auth/me", {
    method,
    headers,
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
describe("proxy-safe session header", () => {
  it("accepts the signed JWT when Authorization and cookies are absent or replaced by a proxy", async () => {
    const accessToken = token();
    for (const headers of [
      { [ACCESS_TOKEN_HEADER]: accessToken },
      {
        authorization: "Bearer unrelated-proxy-credential",
        [ACCESS_TOKEN_HEADER]: accessToken,
      },
    ] as Record<string, string>[]) {
      const response = await me(req(headers));
      expect(response.status).toBe(200);
      expect((await response.json()).user.email).toBe("admin@pakland.pk");
    }
  });
  it("rejects missing, forged, malformed and expired application credentials", async () => {
    const accessToken = token();
    const [header, body] = accessToken.split(".");
    for (const candidate of [
      "",
      "admin",
      `${header}.${body}.forged-signature`,
    ]) {
      expect((await me(req({ [ACCESS_TOKEN_HEADER]: candidate }))).status).toBe(
        401,
      );
    }
    // A correctly signed but expired access token is rejected on this transport too.
    const { signAccessToken } = await import("@/server/auth/crypto");
    const identity = extractAuthContext(
      req({ authorization: `Bearer ${accessToken}` }),
    )!;
    expect(
      (await me(req({ [ACCESS_TOKEN_HEADER]: signAccessToken(identity, -60) })))
        .status,
    ).toBe(401);
  });
  it("retains permission enforcement and organization isolation", async () => {
    const agent = { [ACCESS_TOKEN_HEADER]: token("agent@pakland.pk") };
    expect(
      (
        await invoices(
          req(agent, "POST", { action: "rent_cycle", periodMonth: "2026-11" }),
        )
      ).status,
    ).toBe(403);
    const other = await leads(
      req({ [ACCESS_TOKEN_HEADER]: token("admin@indusvalley.pk") }),
    );
    expect(other.status).toBe(200);
    expect((await other.json()).leads).toHaveLength(0);
  });
});
