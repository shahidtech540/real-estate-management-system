import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "wait" });
});

test("normal sign-in, wrong-password feedback, reload and sign-out", async ({
  page,
}) => {
  await page.goto("/login");
  await page.getByTestId("password-input").fill("incorrect-password");
  await page.getByTestId("login-submit").click();
  await expect(
    page.getByRole("alert").filter({ hasText: "Invalid email or password." }),
  ).toBeVisible();
  await expect(page.getByTestId("login-submit")).toBeEnabled();
  await page.getByTestId("password-input").fill("Password123!");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("active-org-badge")).toContainText("PakLand");
  await page.reload();
  await expect(page.getByTestId("active-org-badge")).toBeVisible();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect(
    await page.evaluate(() => sessionStorage.getItem("rems_access_token")),
  ).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("rems_access_token")),
  ).toBeNull();
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("embedded preview signs in without cookies, survives reload, downloads a protected PDF and switches roles", async ({
  page,
  context,
  baseURL,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  // This is a synthetic parent, not an external network request. The iframe is
  // cross-site, so SameSite=Lax session cookies are blocked just as in preview.
  await page.route("http://arena.test/**", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<iframe title="REMS preview" src="${baseURL}/login" width="1440" height="1000"></iframe>`,
    }),
  );
  await page.goto("http://arena.test/");
  const app = page.frameLocator("iframe");
  await app.getByTestId("login-submit").click();
  await expect(app.getByTestId("active-org-badge")).toContainText("PakLand");
  expect(
    (await context.cookies(baseURL!)).filter((c) => c.name.startsWith("rems_")),
  ).toHaveLength(0);
  await page.reload();
  await expect(app.getByTestId("active-org-badge")).toBeVisible();
  await app.getByTestId("tab-tenancy").click();
  await expect(
    app.getByRole("heading", { name: "Lease register", exact: true }),
  ).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    app
      .getByRole("link", { name: "Agreement PDF ↗", exact: true })
      .first()
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
  const pdf = await readFile((await download.path())!);
  expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  // Switching contexts must replace the bearer token, not leave the old admin
  // token active while the browser ignores the new cookie.
  await app
    .locator('select[data-testid="role-switcher-select"]')
    .selectOption("agent@pakland.pk");
  await expect(app.getByTestId("active-role-badge")).toContainText("agent");
  await app.getByTestId("tab-crm").click();
  await expect(app.getByText("FORBIDDEN_PERMISSION")).toHaveCount(0);
  await app.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(app.getByTestId("login-submit")).toBeVisible();
  await app.getByTestId("quick-login-admin-org_pakland").click();
  await expect(app.getByTestId("active-role-badge")).toContainText("admin");
  expect(errors).toEqual([]);
});

test("disabled browser storage does not turn successful sign-in into a network error", async ({
  page,
}) => {
  // Reject cookies as well as Web Storage; in-memory SPA auth must still work.
  await page.route("**/api/v1/**", async (route) => {
    const headers = { ...route.request().headers() };
    headers.cookie = "";
    const response = await route.fetch({ headers });
    const responseHeaders = { ...response.headers() };
    delete responseHeaders["set-cookie"];
    await route.fulfill({ response, headers: responseHeaders });
  });
  await page.addInitScript(() => {
    for (const name of ["localStorage", "sessionStorage"])
      Object.defineProperty(window, name, {
        configurable: true,
        get() {
          throw new DOMException("Storage blocked", "SecurityError");
        },
      });
  });
  await page.goto("/login");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("active-org-badge")).toContainText("PakLand");
  await expect(page.getByText("Network error while signing in.")).toHaveCount(
    0,
  );
});

test("sign-in and protected APIs survive a preview proxy that strips Authorization and cookies", async ({
  page,
}) => {
  // Reproduce an additional proxy layer: the standard Authorization header is
  // reserved/removed by the proxy, and the embedded browser has no cookies.
  await page.route("**/api/v1/**", async (route) => {
    const headers = { ...route.request().headers() };
    headers.cookie = "";
    headers.authorization = "";
    const response = await route.fetch({ headers });
    const responseHeaders = { ...response.headers() };
    delete responseHeaders["set-cookie"];
    await route.fulfill({
      status: response.status(),
      body: await response.body(),
      headers: responseHeaders,
    });
  });
  await page.goto("/login");
  await page.getByTestId("login-submit").click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByTestId("active-org-badge")).toContainText("PakLand");
  await page.getByTestId("tab-tenancy").click();
  await expect(
    page.getByRole("heading", { name: "Lease register", exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByTestId("active-org-badge")).toBeVisible();
  await page.getByRole("button", { name: "Sign Out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
});
