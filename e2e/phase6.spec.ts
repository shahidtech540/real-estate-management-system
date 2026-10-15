import { test, expect, type Page } from "@playwright/test";
async function login(page: Page) {
  await page.setViewportSize({ width: 1100, height: 900 });
  expect(
    (
      await page.request.post("/api/v1/auth/login", {
        data: { email: "admin@fahadrealestate.test", password: "Password123!" },
      })
    ).ok(),
  ).toBeTruthy();
  await page.request.post("/api/v1/auth/context", { data: { locale: "en" } });
  await page.goto("/dashboard");
  await page.getByTestId("workspace-select").selectOption("orchestration");
  await expect(page.getByTestId("orchestration-workspace")).toBeVisible();
}
async function queue(
  page: Page,
  goal: string,
  steps: unknown[],
  agentId = "agt_insights",
) {
  const form = page.getByRole("form", { name: "Agent plan" });
  await form.getByLabel("Agent", { exact: true }).selectOption(agentId);
  await form.getByLabel("Goal / human context").fill(goal);
  await form.getByLabel("Unique request key").fill(goal);
  await form.getByLabel(/Ordered steps/).fill(JSON.stringify(steps));
  await form.getByRole("button", { name: "Queue plan", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved · queued" }),
  ).toBeVisible();
  const data = await (await page.request.get("/api/v1/agents")).json();
  return data.runs.find((r: { goal: string }) => r.goal === goal).id as string;
}
async function switchRole(page: Page, email: string) {
  await page.getByTestId("role-switcher-select").selectOption(email);
  await expect(page.getByTestId("role-switcher-select")).toHaveValue(email);

  await page.getByTestId("workspace-select").selectOption("orchestration");
}
test("structured plan executes ordered reads and displays durable traces", async ({
  page,
}, info) => {
  await login(page);
  await queue(page, `E2E-read-${Date.now()}`, [
    { tool: "portfolio.units", input: { limit: 2 } },
    {
      tool: "reports.financial",
      input: { from: "2026-10-01", to: "2026-10-15" },
    },
  ]);
  await page
    .getByRole("button", { name: "Advance one step", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Selected run trace" }),
  ).toContainText("1/2 steps completed");
  await page
    .getByRole("button", { name: "Advance one step", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Selected run trace" }),
  ).toContainText("completed · Executed reports.financial; 2/2");
  await expect(
    page.getByRole("button", { name: "Advance one step", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: info.outputPath("agent-run-trace.png") });
});
test("credit waits for another finance reviewer, then executes once with balanced ledger", async ({
  page,
}) => {
  await login(page);
  const response = await page.request.post("/api/v1/billing/invoices", {
    data: {
      leaseId: "lease_1",
      type: "utilities",
      periodMonth: "2026-10",
      dueDate: "2026-10-15",
      amountMinor: 10000,
    },
  });
  expect(response.ok()).toBeTruthy();
  const inv = (await response.json()).invoice,
    goal = `E2E-credit-${Date.now()}`;
  const runId = await queue(
    page,
    goal,
    [
      {
        tool: "billing.credit",
        input: {
          invoiceId: inv.id,
          amountMinor: 100,
          reason: "Verified meter allowance",
        },
      },
    ],
    "agt_rent",
  );
  await page
    .getByRole("button", { name: "Advance one step", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Selected run trace" }),
  ).toContainText("waiting_approval");
  const state = await (await page.request.get("/api/v1/agents")).json(),
    approval = state.approvals.find(
      (a: { runId: string }) => a.runId === runId,
    );
  expect(
    (
      await page.request.post("/api/v1/agents", {
        data: {
          action: "review",
          id: approval.id,
          decision: "approve",
          reason: "Self approval attempt",
        },
      })
    ).status(),
  ).toBe(403);
  await switchRole(page, "accountant@fahadrealestate.test");
  const review = page.getByRole("form", { name: `Review ${approval.id}` });
  await review
    .getByLabel("Review reason / evidence")
    .fill("Independently checked invoice evidence");
  await review.getByRole("button", { name: "Submit review" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Saved · approved" }),
  ).toBeVisible();
  await switchRole(page, "admin@fahadrealestate.test");
  await page
    .getByRole("button")
    .filter({ has: page.getByText(goal, { exact: true }) })
    .click();
  await page
    .getByRole("button", { name: "Advance one step", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Selected run trace" }),
  ).toContainText("completed");
  expect(
    (
      await page.request.post("/api/v1/agents", {
        data: { action: "advance", id: runId },
      })
    ).ok(),
  ).toBeTruthy();
  const data = await (
    await page.request.get(`/api/v1/agents?id=${runId}`)
  ).json();
  expect(data.calls).toHaveLength(1);
  expect(data.calls[0].output.totalMinor).toBe(9900);
});
test("kill switch stops queued work; mobile Urdu controls do not overflow", async ({
  page,
}, info) => {
  await login(page);
  const run = await queue(page, `E2E-kill-${Date.now()}`, [
    { tool: "portfolio.units", input: { limit: 2 } },
  ]);
  const controls = page.getByRole("form", { name: "Engine controls" });
  await controls.getByLabel("Engine state").selectOption("false");
  await controls.getByRole("button", { name: "Save engine controls" }).click();
  await expect(
    page.getByText("Organization kill switch ACTIVE", { exact: true }),
  ).toBeVisible();
  expect(
    (await (await page.request.get(`/api/v1/agents?id=${run}`)).json()).status,
  ).toBe("killed");
  await controls.getByLabel("Engine state").selectOption("true");
  await controls.getByRole("button", { name: "Save engine controls" }).click();
  await expect(page.getByText("Engine enabled", { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 375, height: 812 });
  await page.route("**/api/v1/auth/context", (route) =>
    route.fulfill({ json: {} }),
  );
  await page.getByTestId("locale-toggle-btn").click();
  await expect(page.locator(".rems-dashboard")).toHaveAttribute("dir", "rtl");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  await page.screenshot({
    path: info.outputPath("orchestration-mobile-rtl.png"),
  });
});
