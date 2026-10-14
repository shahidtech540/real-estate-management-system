import { test, expect, type Page } from "@playwright/test";
async function login(page: Page, email = "tenant@pakland.pk") {
  await page.setViewportSize({ width: 1100, height: 900 });
  expect(
    (
      await page.request.post("/api/v1/auth/login", {
        data: { email, password: "Password123!" },
      })
    ).ok(),
  ).toBeTruthy();
  expect(
    (
      await page.request.post("/api/v1/auth/context", {
        data: { locale: "en" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.goto("/dashboard");
  await expect(page.getByTestId("role-switcher-select")).toHaveValue(email);
}
async function workspace(page: Page, id: string) {
  await page.getByTestId("workspace-select").selectOption(id);
}
async function switchRole(page: Page, email: string) {
  await page.getByTestId("role-switcher-select").selectOption(email);
  await expect(page.getByTestId("role-switcher-select")).toHaveValue(email);
  await page.waitForLoadState("networkidle");
}
test("tenant photo ticket flows through coordinator work order and tenant-rated closure", async ({
  page,
}, info) => {
  const title = `E2E leaking sink ${Date.now()}`;
  await login(page);
  await workspace(page, "maintenance");
  await page.getByText("Report an issue", { exact: true }).click();
  const form = page.getByRole("form", { name: "New maintenance ticket" });
  await form.getByLabel("Unit", { exact: true }).selectOption("unit_1");
  await form.getByLabel("Issue title").fill(title);
  await form
    .getByLabel("Describe the issue")
    .fill("Pipe joint leaking beneath the sink.");
  await form.getByLabel("Priority", { exact: true }).selectOption("high");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 20;
    canvas.height = 20;
    const c = canvas.getContext("2d")!;
    c.fillStyle = "blue";
    c.fillRect(0, 0, 20, 20);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await form.getByLabel("Photos (up to 5)").setInputFiles({
    name: "leak.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  await form.getByRole("button", { name: "Submit ticket" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("open");
  await expect(page.getByTestId("ticket-detail").locator("img")).toHaveCount(1);
  await switchRole(page, "maintenance@pakland.pk");
  await page.getByRole("button").filter({ hasText: title }).click();
  const triage = page.getByRole("form", { name: "Triage ticket", exact: true });
  await triage.getByLabel("Triage note").fill("Replace the pipe seal.");
  await triage.getByRole("button", { name: "Save triage" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("triaged");
  const assign = page.getByRole("form", {
    name: "Schedule work order",
    exact: true,
  });
  await assign
    .getByLabel("Vendor", { exact: true })
    .selectOption("ven_plumber");
  await assign.getByLabel("Estimate (PKR)").fill("3000");
  await assign.getByRole("button", { name: "Assign & schedule" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("scheduled");
  let work = page.getByRole("form", { name: "Update work order", exact: true });
  await work
    .getByLabel("Work notes")
    .fill("Vendor arrived and started repair.");
  await work.getByRole("button", { name: "Start work", exact: true }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("in progress");
  work = page.getByRole("form", { name: "Update work order", exact: true });
  await work.getByLabel("Work notes").fill("New seal installed; flow tested.");
  await work.getByLabel("Actual cost (PKR)").fill("2750.50");
  await work.getByRole("button", { name: "Mark work completed" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("completed");
  await expect(
    page.getByRole("button", { name: "Confirm & close" }),
  ).toHaveCount(0);
  await switchRole(page, "tenant@pakland.pk");
  await page.getByRole("button").filter({ hasText: title }).click();
  const confirm = page.getByRole("form", {
    name: "Confirm completion",
    exact: true,
  });
  await confirm.getByLabel("Rating", { exact: true }).selectOption("4");
  await confirm
    .getByLabel("Confirmation / reopen reason")
    .fill("The leak has stopped. Thank you.");
  await confirm.getByRole("button", { name: "Confirm & close" }).click();
  await expect(page.getByTestId("ticket-status")).toHaveText("closed");
  await expect(page.getByTestId("ticket-detail")).toContainText("2,750.50");
  await page
    .getByTestId("ticket-detail")
    .screenshot({ path: info.outputPath("maintenance-closed.png") });
  await page.setViewportSize({ width: 375, height: 812 });
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    )
    .toBeTruthy();
});
test("coordinator creates and pauses a preventive schedule and runs the scan idempotently", async ({
  page,
}) => {
  await login(page, "maintenance@pakland.pk");
  await workspace(page, "maintenance");
  await page
    .getByText("Preventive maintenance schedules", { exact: true })
    .click();
  const title = `E2E HVAC service ${Date.now()}`,
    form = page.getByRole("form", {
      name: "New preventive schedule",
      exact: true,
    });
  await form.getByLabel("Unit", { exact: true }).selectOption("unit_1");
  await form.getByLabel("Schedule title").fill(title);
  await form.getByLabel("Category", { exact: true }).selectOption("hvac");
  await form.getByLabel("Next due time").fill("2026-10-01T09:00");
  await form.getByRole("button", { name: "Create schedule" }).click();
  await expect(
    page.getByRole("paragraph").filter({ hasText: title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run SLA & preventive scan" }).click();
  await expect(
    page.getByRole("button").filter({ hasText: title }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Run SLA & preventive scan" }).click();
  await expect(page.getByRole("button").filter({ hasText: title })).toHaveCount(
    1,
  );
  const schedule = page
    .locator("div.border.rounded-lg")
    .filter({ has: page.getByText(title, { exact: true }) });
  await schedule.getByRole("button", { name: "Pause schedule" }).click();
  await expect(
    schedule.getByRole("button", { name: "Resume schedule" }),
  ).toBeVisible();
});
test("admin queues a consented mock email and tenant reads the inbox notification", async ({
  page,
}) => {
  await login(page, "admin@pakland.pk");
  await workspace(page, "notifications");
  await page.getByText("Send a single notification", { exact: true }).click();
  const form = page.getByRole("form", {
      name: "Compose notification",
      exact: true,
    }),
    subject = `E2E repair update ${Date.now()}`;
  await form
    .getByLabel("Recipient", { exact: true })
    .selectOption("usr_tenant");
  await form.getByLabel("Channel", { exact: true }).selectOption("email");
  await form.getByLabel("Subject", { exact: true }).fill(subject);
  await form
    .getByLabel("Message", { exact: true })
    .fill("Your repair appointment is confirmed.");
  await form.getByRole("checkbox").check();
  await form.getByRole("button", { name: "Queue notification" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved successfully" }),
  ).toBeVisible();
  await page.getByLabel("Notification view").selectOption("outbox");
  let article = page.getByRole("article").filter({ hasText: subject });
  await expect(article).toContainText("queued");
  await page.getByRole("button", { name: "Process delivery queue" }).click();
  await expect(article).toContainText("mock sent");
  await switchRole(page, "tenant@pakland.pk");
  article = page.getByRole("article").filter({ hasText: subject });
  await expect(article).toBeVisible();
  await article.getByRole("button", { name: "Mark read" }).click();
  await expect(article.getByRole("button", { name: "Mark read" })).toHaveCount(
    0,
  );
  await expect(page.getByLabel("Notification view")).toHaveCount(0);
});
test("expanded Phase 4 forms fit mobile English and Urdu RTL", async ({
  page,
}, info) => {
  await login(page, "admin@pakland.pk");
  await page.setViewportSize({ width: 375, height: 812 });
  await workspace(page, "maintenance");
  for (const title of [
    "Report an issue",
    "Vendor directory & rates",
    "Preventive maintenance schedules",
  ])
    await page.getByText(title, { exact: true }).click();
  await page.waitForLoadState("networkidle");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(376);
  await page.route("**/api/v1/auth/context", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.getByTestId("locale-toggle-btn").click();
  await expect(page.locator(".rems-dashboard")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(376);
  await page.screenshot({
    path: info.outputPath("maintenance-mobile-rtl.png"),
  });
  await workspace(page, "notifications");
  for (const title of ["ایک اطلاع بھیجیں", "مرمت کی اطلاعات کے سانچے"])
    await page.getByText(title, { exact: true }).click();
  await page.waitForLoadState("networkidle");
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(376);
  await page.screenshot({
    path: info.outputPath("notifications-mobile-rtl.png"),
  });
});
