import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, role: string) {
  const response = await page.request.post("/api/v1/auth/login", {
    data: { email: `${role}@fahadrealestate.test`, password: "Password123!" },
  });
  expect(response.ok()).toBeTruthy();
}
test("tenant portal: scoped finances, maintenance, vault, Urdu/mobile and logout", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 375, height: 812 });
  await login(page, "tenant");
  await page.goto("/portal/tenant");
  await expect(
    page.getByRole("heading", { name: "Tenant portal", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Your recorded outstanding invoices"),
  ).toBeVisible();
  await page.getByRole("button", { name: "invoices", exact: true }).click();
  await expect(
    page.getByText("invoice number", { exact: true }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "documents", exact: true }).click();
  await expect(
    page.getByText("Your authorized document metadata"),
  ).toBeVisible();
  await expect(
    page.getByTestId("personal-portal").getByRole("alert"),
  ).toHaveCount(0);
  const form = page.getByRole("form", { name: "Portal maintenance" });
  await form.locator('select[name="unit"]').selectOption({ index: 1 });
  await form.locator('[name="title"]').fill("Portal kitchen tap inspection");
  await form
    .locator('[name="description"]')
    .fill("Slow dripping tap, non-emergency inspection requested");
  await form.getByRole("button", { name: "Submit ticket" }).click();
  await expect(page.getByRole("status")).toContainText("Saved");
  await page.getByRole("button", { name: "tickets", exact: true }).click();
  await expect(
    page.getByText("Portal kitchen tap inspection", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "اردو", exact: true }).click();
  await expect(page.getByTestId("personal-portal")).toHaveAttribute(
    "dir",
    "rtl",
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "English", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);
  expect((await page.request.get("/api/v1/portal")).status()).toBe(401);
  expect(errors).toEqual([]);
});
test("owner consent browser workflow stays nonbinding and rejects a second final decision", async ({
  page,
}) => {
  await login(page, "admin");
  await page.goto("/portal");
  await expect(
    page.getByRole("heading", { name: "Owner consent requests", exact: true }),
  ).toBeVisible();
  const form = page.getByRole("form", { name: "Owner consent request" });
  await form.locator('select[name="owner"]').selectOption("own_1");
  await form.locator('select[name="source"]').selectOption("lease:lease_1");
  await form
    .locator('[name="summary"]')
    .fill("Browser source-bound unsigned renewal acknowledgement");
  await form.locator('[name="cost"]').fill("100.01");
  await form.getByRole("button", { name: "Request owner consent" }).click();
  await expect(page.getByRole("status")).toContainText("Request saved");
  await login(page, "owner");
  await page.goto("/portal/owner");
  await expect(
    page.getByRole("heading", { name: "Owner portal", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "reviews", exact: true }).click();
  const article = page
    .locator("article")
    .filter({
      hasText: "Browser source-bound unsigned renewal acknowledgement",
    });
  await expect(article).toBeVisible();
  await article
    .getByRole("textbox", { name: "Decision note" })
    .fill("Reviewed as acknowledgement, not contract approval");
  const [response] = await Promise.all([
    page.waitForResponse(
      (r) =>
        r.url().endsWith("/api/v1/portal") && r.request().method() === "POST",
    ),
    article.getByRole("button", { name: "Record decision" }).click(),
  ]);
  const saved = await response.json();
  expect(saved.binding).toBe(false);
  expect(saved.executesBusinessWrite).toBe(false);
  await expect(
    article.getByRole("button", { name: "Record decision" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "leases", exact: true }).click();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("link", { name: "Download unsigned template PDF" })
      .first()
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.pdf$/);
});
test("personal portal API rejects staff data reads, role-only collections and identity overrides", async ({
  page,
}) => {
  await login(page, "admin");
  expect(
    (await page.request.get("/api/v1/portal?resource=invoices")).status(),
  ).toBe(403);
  await login(page, "tenant");
  expect(
    (await page.request.get("/api/v1/portal?resource=statements")).status(),
  ).toBe(403);
  expect(
    (
      await page.request.get("/api/v1/portal?resource=invoices&tenantId=ten_2")
    ).status(),
  ).toBe(400);
  expect(
    (
      await page.request.get("/api/v1/portal?resource=invoices&limit=51")
    ).status(),
  ).toBe(400);
  await page.goto("/portal/owner");
  await expect(
    page.getByTestId("personal-portal").getByRole("alert"),
  ).toContainText("different role");
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  expect(me.summary.agents).toEqual([]);
  expect(me.summary.properties).toEqual([]);
});
