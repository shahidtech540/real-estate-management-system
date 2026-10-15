import { test, expect } from "@playwright/test";
test("production boots without demo credentials or financial fixtures and uses secure session policy", async ({
  page,
}) => {
  const health = await page.request.get("/api/v1/health");
  expect(health.ok()).toBeTruthy();
  expect((await health.json()).metrics).toBeUndefined();
  expect(health.headers()["content-security-policy"]).toContain(
    "frame-ancestors 'self'",
  );
  expect(health.headers()["strict-transport-security"]).toBe(
    "max-age=31536000",
  );
  const accounts = await (await page.request.get("/api/v1/auth/login")).json();
  expect(accounts).toEqual({ accounts: [], demoEnabled: false });
  const html = await (await page.request.get("/login")).text();
  expect(html).not.toContain("admin@fahadrealestate.test");
  expect(html).not.toContain("Default demo password");
  await page.goto("/login");
  await expect(page.getByTestId("login-submit")).toBeEnabled();
  await expect(page.getByTestId("email-input")).toHaveValue("");
  await expect(page.getByTestId("password-input")).toHaveValue("");
  await expect(
    page.getByText("Instant Role Switcher (Demo Accounts)"),
  ).toHaveCount(0);
  await page.getByTestId("email-input").fill("operator@company.pk");
  await page
    .getByTestId("password-input")
    .fill("synthetic-production-browser-fixture-password");
  const [login] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/auth/login") &&
        r.request().method() === "POST",
    ),
    page.getByTestId("login-submit").click(),
  ]);
  expect(login.ok()).toBeTruthy();
  expect((await login.allHeaders())["set-cookie"]).toContain("Secure");
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("role-switcher-select")).toBeDisabled();
  const data = await login.json(),
    headers = { Authorization: `Bearer ${data.accessToken}` };
  const me = await (
    await page.request.get("/api/v1/auth/me", { headers })
  ).json();
  expect(me.demoEnabled).toBe(false);
  expect(me.summary.kpis.totalProperties).toBe(0);
  expect(me.summary.kpis.totalInvoices).toBe(0);
  expect(me.summary.kpis.totalCollectedMinor).toBe(0);
  const portal = await (
    await page.request.get("/api/v1/portal", { headers })
  ).json();
  expect(portal.options.owners).toEqual([]);
  const weak = await page.request.post("/api/v1/admin/users", {
    headers,
    data: {
      email: "staff@company.pk",
      fullName: "Synthetic staff fixture",
      password: "Password123!",
      roleSlug: "agent",
    },
  });
  expect(weak.status()).toBe(400);
  expect((await weak.json()).error.code).toBe("PRODUCTION_CREDENTIALS");
});
