import { test, expect } from "@playwright/test";
// Run against a disposable seeded database. This test deliberately writes tenant, lease and payment records.
test("tenant to lease, rent invoice, payment receipt and owner statement", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = await page.request.post("/api/v1/auth/login", {
    data: { email: "admin@fahadrealestate.test", password: "Password123!" },
  });
  expect(login.ok()).toBeTruthy();
  const unique = String(Date.now()).slice(-7);
  const name = `Browser Tenant ${unique}`;
  await page.goto("/dashboard");
  await page
    .getByRole("button", { name: "Tenants & Leases", exact: true })
    .click();
  const onboarding = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Onboard tenant", exact: true }),
    });
  await onboarding.locator('[name="fullName"]').fill(name);
  await onboarding.locator('[name="cnic"]').fill(`35202-${unique}-1`);
  await onboarding.locator('[name="phone"]').fill("+923001112233");
  await onboarding
    .locator('[name="email"]')
    .fill(`browser${unique}@example.pk`);
  await onboarding
    .getByRole("button", { name: "Register (pending KYC)" })
    .click();
  const row = page.getByRole("row").filter({ hasText: name });
  await row.getByRole("combobox").selectOption("verified");
  await expect(row.getByRole("combobox")).toHaveValue("verified");
  const drafting = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Draft a lease", exact: true }),
    });
  await drafting
    .locator('[name="tenantId"]')
    .selectOption({ label: `${name} (verified)` });
  const unit = await drafting
    .locator('[name="unitId"] option')
    .nth(1)
    .getAttribute("value");
  expect(unit).toBeTruthy();
  await drafting.locator('[name="unitId"]').selectOption(unit!);
  const now = new Date(),
    start = `${now.getFullYear() + 1}-01-01`,
    end = `${now.getFullYear() + 1}-12-31`,
    month = start.slice(0, 7);
  await drafting.locator('[name="startDate"]').fill(start);
  await drafting.locator('[name="endDate"]').fill(end);
  await drafting.locator('[name="rent"]').fill("50000");
  await drafting.locator('[name="deposit"]').fill("100000");
  await drafting
    .getByRole("button", { name: "Create draft", exact: true })
    .click();
  const leaseRow = page
    .getByRole("row")
    .filter({ hasText: name })
    .filter({ has: page.getByRole("link", { name: "Agreement PDF ↗" }) });
  await leaseRow.getByRole("button").click();
  const operations = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /Lease operations/ }) });
  await operations.locator('[name="status"]').selectOption("pending_signature");
  await operations
    .getByRole("button", { name: "Update lifecycle", exact: true })
    .click();
  await expect(leaseRow).toContainText("pending_signature");
  await operations.locator('[name="status"]').selectOption("active");
  await operations
    .getByRole("button", { name: "Update lifecycle", exact: true })
    .click();
  await expect(leaseRow).toContainText("active");
  await page
    .getByRole("button", { name: "Rent & Payments", exact: true })
    .click();
  await page.locator('input[type="month"]').first().fill(month);
  await page
    .getByRole("button", { name: "Generate rent cycle", exact: true })
    .click();
  await expect(page.getByRole("row").filter({ hasText: name })).toBeVisible();
  const payment = page
    .locator("section")
    .filter({
      has: page.getByRole("heading", { name: "Record a payment", exact: true }),
    });
  const value = await payment
    .locator('[name="invoiceId"] option')
    .filter({ hasText: name })
    .getAttribute("value");
  await payment.locator('[name="invoiceId"]').selectOption(value!);
  await payment.locator('[name="amount"]').fill("25000");
  await payment.locator('[name="method"]').selectOption("cash");
  await payment.locator('[name="reference"]').fill(`BROWSER-${unique}`);
  await payment
    .getByRole("button", { name: "Record & issue receipt", exact: true })
    .click();
  const receiptRow = page
    .getByRole("row")
    .filter({ hasText: `BROWSER-${unique}` });
  await expect(receiptRow).toContainText("25,000.00");
  const href = await receiptRow
    .getByRole("link", { name: "PDF ↗", exact: true })
    .getAttribute("href");
  const pdf = await page.request.get(href!);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
  await page
    .getByRole("button", { name: "Generate owner statements", exact: true })
    .click();
  await expect(
    page.getByText("No statements issued for this month yet."),
  ).toHaveCount(0);
  expect(errors).toEqual([]);
});
