import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, email = "accountant@fahadrealestate.test") {
  await page.setViewportSize({ width: 1100, height: 900 });
  expect(
    (
      await page.request.post("/api/v1/auth/login", {
        data: { email, password: "Password123!" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.request.post("/api/v1/auth/context", { data: { locale: "en" } });
  await page.goto("/dashboard");
  await page.getByTestId("workspace-select").selectOption("accounting");
  await expect(page.getByTestId("accounting-workspace")).toBeVisible();
}
test("accountant synchronizes, records expense with receipt, budgets, exports and reverses", async ({
  page,
}, info) => {
  await login(page);
  await page
    .getByRole("button", { name: "Synchronize source history", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Sources synchronized" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Expenses & payables", exact: true })
    .click();
  const form = page.getByRole("form", { name: "New expense" }),
    reference = `E2E-EXP-${Date.now()}`;
  await form.getByLabel("Project", { exact: true }).selectOption("prop_1");
  await form.getByLabel("Amount (PKR)").fill("123.45");
  await form
    .getByLabel("Description", { exact: true })
    .fill("Verified gardener payment");
  await form.getByLabel("Unique reference").fill(reference);
  await form
    .getByLabel(/Private receipt/)
    .setInputFiles({
      name: "proof.pdf",
      mimeType: "application/pdf",
      buffer: Buffer.from("%PDF-1.7\nproof"),
    });
  await form.getByRole("button", { name: "Save record" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved successfully" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", {
      name: `Verified gardener payment · ${reference}`,
    }),
  ).toBeVisible();
  const receipt = page.waitForEvent("download");
  await page.getByRole("link", { name: "proof.pdf", exact: true }).click();
  expect((await receipt).suggestedFilename()).toBe("proof.pdf");
  await page.getByRole("button", { name: "Budgets", exact: true }).click();
  const budget = page.getByRole("form", { name: "Monthly budget" });
  await budget.getByLabel("Project", { exact: true }).selectOption("prop_1");
  await budget.getByLabel("Budget (PKR)").fill("1000");
  await budget.getByRole("button", { name: "Save record" }).click();
  await expect(
    page.getByRole("cell", { name: "PKR 1,000.00", exact: true }),
  ).toBeVisible();
  for (const format of ["CSV", "XLSX", "PDF"]) {
    const download = page.waitForEvent("download");
    await page
      .getByRole("link", { name: `Summary ${format}`, exact: true })
      .click();
    expect((await download).suggestedFilename()).toMatch(
      new RegExp(`\\.${format.toLowerCase()}$`),
    );
  }
  await page
    .getByRole("button", { name: "Expenses & payables", exact: true })
    .click();
  const voidForm = page.getByRole("form", { name: "Void expense" });
  await voidForm
    .getByLabel("Expense", { exact: true })
    .selectOption({ label: reference });
  await voidForm.getByLabel("Reason").fill("Duplicate vendor invoice");
  await voidForm.getByRole("button", { name: "Save record" }).click();
  await expect(
    page.getByRole("row").filter({ hasText: reference }),
  ).toContainText("void");
  await page.screenshot({ path: info.outputPath("accounting-expense.png") });
});
test("mobile Urdu accounting views have bounded layout; tenant has no accounting access", async ({
  page,
}) => {
  await login(page);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/auth/context", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.getByTestId("locale-toggle-btn").click();
  await expect(page.locator(".rems-dashboard")).toHaveAttribute("dir", "rtl");
  for (const name of [
    "خلاصہ",
    "لیجر اور اندراجات",
    "اخراجات اور واجبات",
    "بجٹ",
    "کھاتے اور خلاصے",
  ]) {
    await page
      .getByRole("navigation", { name: "Accounting views" })
      .getByRole("button", { name, exact: true })
      .click();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  await page.unroute("**/api/v1/auth/context");
  await page.request.post("/api/v1/auth/login", {
    data: { email: "tenant@fahadrealestate.test", password: "Password123!" },
  });
  expect((await page.request.get("/api/v1/accounting")).status()).toBe(403);
});
