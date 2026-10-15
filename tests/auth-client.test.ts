import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => values.set(k, v),
    removeItem: (k: string) => values.delete(k),
  };
}
beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal("window", {
    sessionStorage: storage(),
    localStorage: storage(),
  });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("browser session transport", () => {
  it("uses a tab-scoped access token, drops the legacy local copy and clears on logout", async () => {
    const auth = await import("@/lib/auth-client");
    window.localStorage.setItem("rems_access_token", "legacy");
    auth.setAccessToken("short-lived-token");
    expect(auth.getAccessToken()).toBe("short-lived-token");
    expect(window.localStorage.getItem("rems_access_token")).toBeNull();
    expect(window.sessionStorage.getItem("rems_access_token")).toBe(
      "short-lived-token",
    );
    auth.clearAccessToken();
    expect(auth.getAccessToken()).toBeNull();
  });
  it("falls back to memory when Web Storage throws", async () => {
    const auth = await import("@/lib/auth-client");
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, name, {
        get() {
          throw new Error("Storage disabled");
        },
      });
    expect(() => auth.setAccessToken("in-memory")).not.toThrow();
    expect(auth.getAccessToken()).toBe("in-memory");
    auth.clearAccessToken();
    expect(auth.getAccessToken()).toBeNull();
  });
  it("does not access window on the server", async () => {
    vi.stubGlobal("window", undefined);
    const auth = await import("@/lib/auth-client");
    expect(auth.getAccessToken()).toBeNull();
    expect(() => auth.setAccessToken("ignored-on-server")).not.toThrow();
    expect(() => auth.clearAccessToken()).not.toThrow();
  });
  it("attaches bearer auth to same-origin API requests while preserving caller headers", async () => {
    const auth = await import("@/lib/auth-client");
    auth.setAccessToken("access");
    const fetcher = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetcher);
    await auth.authFetch("/api/v1/leases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const options = fetcher.mock.calls[0][1];
    expect(options.headers.get("Authorization")).toBe("Bearer access");
    expect(options.headers.get("X-REMS-Access-Token")).toBe("access");
    expect(options.headers.get("Content-Type")).toBe("application/json");
    expect(options.credentials).toBe("same-origin");
    await auth.authFetch("/api/v1/leases", {
      headers: { Authorization: "Bearer explicit" },
    });
    expect(fetcher.mock.calls[1][1].headers.get("Authorization")).toBe(
      "Bearer explicit",
    );
    expect(fetcher.mock.calls[1][1].headers.get("X-REMS-Access-Token")).toBe(
      "explicit",
    );
  });
  it("never adds the access token to external URLs", async () => {
    const auth = await import("@/lib/auth-client");
    auth.setAccessToken("access");
    const fetcher = vi.fn().mockResolvedValue(new Response("ok"));
    vi.stubGlobal("fetch", fetcher);
    await auth.authFetch("https://example.com/file");
    expect(fetcher).toHaveBeenCalledWith("https://example.com/file", {});
  });
  it.each(["login", "context", "refresh"])(
    "captures tokens returned by %s without consuming the caller's response",
    async (endpoint) => {
      const auth = await import("@/lib/auth-client");
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(
          Response.json({
            accessToken: "new-context-token",
            refreshToken: "never-persist",
          }),
        ),
      );
      const res = await auth.authFetch(`/api/v1/auth/${endpoint}`, {
        method: "POST",
      });
      expect((await res.json()).accessToken).toBe("new-context-token");
      expect(auth.getAccessToken()).toBe("new-context-token");
      expect(window.sessionStorage.getItem("rems_refresh_token")).toBeNull();
    },
  );
  it("does not replace sessions on failed login or a two-factor challenge", async () => {
    const auth = await import("@/lib/auth-client");
    auth.setAccessToken("existing");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(Response.json({ error: {} }, { status: 401 }))
        .mockResolvedValueOnce(Response.json({ requiresTwoFactor: true })),
    );
    await auth.authFetch("/api/v1/auth/login");
    await auth.authFetch("/api/v1/auth/login");
    expect(auth.getAccessToken()).toBe("existing");
  });
  it("clears unauthorized sessions and successful logout", async () => {
    const auth = await import("@/lib/auth-client");
    auth.setAccessToken("expired");
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response("{}", { status: 401 }))
        .mockResolvedValueOnce(Response.json({ loggedOut: true })),
    );
    await auth.authFetch("/api/v1/auth/me");
    expect(auth.getAccessToken()).toBeNull();
    auth.setAccessToken("logout");
    await auth.authFetch("/api/v1/auth/logout");
    expect(auth.getAccessToken()).toBeNull();
  });
  it("does not clear a newly switched session on an old request's late 401", async () => {
    const auth = await import("@/lib/auth-client");
    auth.setAccessToken("old");
    let finish!: (r: Response) => void;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      ),
    );
    const pending = auth.authFetch("/api/v1/leases");
    auth.setAccessToken("new");
    finish(new Response("{}", { status: 401 }));
    await pending;
    expect(auth.getAccessToken()).toBe("new");
  });
});
