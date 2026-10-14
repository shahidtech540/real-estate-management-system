import { test, expect, type Page } from "@playwright/test";

async function signIn(page: Page) {
  const response = await page.request.post("/api/v1/auth/login", {
    data: { email: "admin@pakland.pk", password: "Password123!" },
  });
  expect(response.ok()).toBeTruthy();
  await page.goto("/dashboard");
  await expect(page.getByTestId("role-switcher-select")).toHaveValue(
    "admin@pakland.pk",
  );
  await page.waitForLoadState("networkidle");
}
async function noPageOverflow(page: Page) {
  const size = await page.evaluate(() => ({
    width: window.innerWidth,
    document: document.documentElement.scrollWidth,
    body: document.body.scrollWidth,
  }));
  expect(
    size.document,
    "Document should not scroll sideways",
  ).toBeLessThanOrEqual(size.width + 1);
  expect(size.body, "Body should not scroll sideways").toBeLessThanOrEqual(
    size.width + 1,
  );
}
async function headerIsContained(page: Page) {
  const header = await page.getByTestId("dashboard-header").boundingBox();
  const context = await page.getByTestId("dashboard-context").boundingBox();
  expect(
    context!.y,
    "Workspace navigation must start below the header",
  ).toBeGreaterThanOrEqual(header!.y + header!.height - 1);
  for (const id of [
    "role-switcher-select",
    "branch-switcher-select",
    "locale-toggle-btn",
    "logout-btn",
  ]) {
    const box = await page.getByTestId(id).boundingBox();
    expect(box, `${id} should be visible`).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(header!.y);
    expect(
      box!.y + box!.height,
      `${id} must stay inside the dark header`,
    ).toBeLessThanOrEqual(header!.y + header!.height + 1);
  }
  const locale = await page.getByTestId("locale-toggle-btn").boundingBox();
  const logout = await page.getByTestId("logout-btn").boundingBox();
  const overlaps =
    locale!.x < logout!.x + logout!.width &&
    logout!.x < locale!.x + locale!.width &&
    locale!.y < logout!.y + logout!.height &&
    logout!.y < locale!.y + locale!.height;
  expect(overlaps, "Language and sign-out controls must not overlap").toBe(
    false,
  );
}

for (const viewport of [
  { width: 375, height: 812 },
  { width: 768, height: 1024 },
  { width: 940, height: 260 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  test(`dashboard fits ${viewport.width} × ${viewport.height}`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    await signIn(page);
    await headerIsContained(page);
    await noPageOverflow(page);
    if (viewport.width < 1280) {
      await expect(page.getByTestId("workspace-select")).toBeVisible();
      await expect(page.getByTestId("desktop-workspaces")).toBeHidden();
      await page.getByTestId("workspace-select").selectOption("billing");
      await expect(
        page.getByRole("heading", {
          name: "Rent, payments & owner statements",
          exact: true,
        }),
      ).toBeVisible();
      await page.waitForLoadState("networkidle");
      await noPageOverflow(page);
    } else {
      await expect(page.getByTestId("workspace-select")).toBeHidden();
      await expect(page.getByTestId("tab-audit")).toBeVisible();
      await expect(page.getByTestId("tab-overview")).toHaveAttribute(
        "aria-current",
        "page",
      );
    }
    await page.screenshot({
      path: info.outputPath("dashboard.png"),
      fullPage: false,
    });
    if (viewport.height < 500) {
      const header = await page.getByTestId("dashboard-header").boundingBox();
      const context = await page.getByTestId("dashboard-context").boundingBox();
      expect(
        header!.height + context!.height,
        "Compact preview chrome should leave space for content",
      ).toBeLessThan(viewport.height * 0.6);
      await page.getByTestId("dashboard-main").scrollIntoViewIfNeeded();
      await expect
        .poll(
          async () =>
            (await page.getByTestId("dashboard-header").boundingBox())!.y,
        )
        .toBeLessThan(0);
    }
  });
}

test("every workspace stays within a mobile viewport, including Urdu RTL", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  for (const id of [
    "overview",
    "listings",
    "crm",
    "tenancy",
    "billing",
    "owners",
    "documents",
    "csv",
    "rbac",
    "users",
    "security",
    "audit",
  ]) {
    await page.getByTestId("workspace-select").selectOption(id);
    await page.waitForLoadState("networkidle");
    await noPageOverflow(page);
  }
  // Layout-only locale toggle: keep the shared seeded user's default unchanged.
  await page.route("**/api/v1/auth/context", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.getByTestId("locale-toggle-btn").click();
  await expect(page.locator(".rems-dashboard")).toHaveAttribute("dir", "rtl");
  for (const id of [
    "overview",
    "listings",
    "crm",
    "tenancy",
    "billing",
    "owners",
    "documents",
    "csv",
    "rbac",
    "users",
    "security",
    "audit",
  ]) {
    await page.getByTestId("workspace-select").selectOption(id);
    await page.waitForLoadState("networkidle");
    await noPageOverflow(page);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await headerIsContained(page);
});

test("short preview header also fits Urdu RTL", async ({ page }, info) => {
  await page.setViewportSize({ width: 940, height: 260 });
  await signIn(page);
  await page.route("**/api/v1/auth/context", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.getByTestId("locale-toggle-btn").click();
  await expect(page.locator(".rems-dashboard")).toHaveAttribute("dir", "rtl");
  await headerIsContained(page);
  await noPageOverflow(page);
  await page.screenshot({ path: info.outputPath("preview-rtl.png") });
});
