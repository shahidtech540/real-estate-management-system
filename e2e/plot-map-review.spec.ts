import { test, expect } from "@playwright/test";
import path from "node:path";
test("administrator uploads, fixes, calibrates, exchanges CSV and publishes a map", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  const login = await page.request.post("/api/v1/auth/login", {
    data: { email: "admin@fahadrealestate.test", password: "Password123!" },
  });
  expect(login.ok()).toBeTruthy();
  await page.goto("/dashboard");
  await page.getByTestId("tab-plot-map").click();
  await expect(
    page.getByRole("heading", { name: "Plot Map · Review & publish" }),
  ).toBeVisible();
  await page
    .getByLabel("Upload SVG (max 10 MiB)")
    .setInputFiles(path.resolve("samples/plots-explicit.svg"));
  await expect(page.getByText("8 active plots", { exact: true })).toBeVisible();
  await page.getByLabel("Real units per SVG unit").fill("2");
  await page
    .getByRole("button", { name: "Apply calibration", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Scale calibrated" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review plot 1", exact: true })
    .click();
  await page.getByLabel("Assign plot number", { exact: true }).fill("101");
  await page
    .getByRole("button", { name: "Assign / fix number", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review plot 101", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Review plot 101", exact: true })
    .click();
  await page.getByLabel("block", { exact: true }).fill("North");
  await page.getByLabel("area official", { exact: true }).fill("5");
  await page
    .getByRole("button", { name: "Apply to selected", exact: true })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "Draft official data updated",
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page
      .getByRole("button", { name: "Export CSV for Excel", exact: true })
      .click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
  await page
    .getByLabel("Import UTF-8 CSV (match by plot_number)")
    .setInputFiles({
      name: "official.csv",
      mimeType: "text/csv",
      buffer: Buffer.from(
        "plot_number,block,total_price_minor\r\n101,Approved,12500000\r\n",
      ),
    });
  await expect(page.getByRole("status")).toContainText(
    "CSV imported atomically",
  );
  // Check mobile layout without enabling any Phase C visitor interactions.
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  const accept = page.getByRole("checkbox", {
    name: "I reviewed and accept the listed warnings",
  });
  if (await accept.count()) {
    await accept.check();
    await page
      .getByLabel("Warning acceptance reason (audited)")
      .fill("Checked sample layout");
  }
  const removed = page.getByRole("checkbox", {
    name: /I reviewed removed plots/,
  });
  if (await removed.count()) await removed.check();
  page.once("dialog", (d) => d.accept());
  await page.getByRole("button", { name: "Publish map", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Map published");
  await expect(
    page.getByText("Read-only. Upload a new version to change it."),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("non-admin cannot see Plot Map workspace or review API", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/v1/auth/login", {
    data: { email: "agent@fahadrealestate.test", password: "Password123!" },
  });
  await page.goto("/dashboard");
  await expect(page.getByTestId("active-role-badge")).toContainText("agent");
  await expect(page.getByTestId("tab-plot-map")).toHaveCount(0);
  expect(
    (await page.request.get("/api/v1/properties/prop_1/plot-maps")).status(),
  ).toBe(403);
});

test("two-point calibration, split/merge and project switching work in the review screen", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.request.post("/api/v1/auth/login", {
    data: { email: "admin@fahadrealestate.test", password: "Password123!" },
  });
  await page.goto("/dashboard");
  await page.getByTestId("tab-plot-map").click();
  await page
    .getByLabel("Upload SVG (max 10 MiB)")
    .setInputFiles(path.resolve("samples/plots-text-only.svg"));
  await expect(page.getByText("8 active plots", { exact: true })).toBeVisible();
  await page.getByLabel("Calibration method").selectOption("points");
  await page
    .getByRole("button", { name: "Pick two points on preview", exact: true })
    .click();
  const overlay = page.getByLabel("Detected plot review overlay");
  await overlay.scrollIntoViewIfNeeded();
  const coords = await overlay.evaluate((el) => {
    const svg = el as SVGSVGElement,
      m = svg.getScreenCTM()!;
    return [
      [20, 30],
      [70, 30],
    ].map(([x, y]) => {
      const p = new DOMPoint(x, y).matrixTransform(m);
      return { x: p.x, y: p.y };
    });
  });
  for (const p of coords) await page.mouse.click(p.x, p.y);
  await page.getByLabel("Real distance between points").fill("200");
  await page
    .getByRole("button", { name: "Apply calibration", exact: true })
    .click();
  await expect(
    page.getByRole("status").filter({ hasText: "Scale calibrated" }),
  ).toBeVisible();
  const id = await page.getByLabel("Map version", { exact: true }).inputValue(),
    r = await (
      await page.request.get(`/api/v1/properties/prop_1/plot-maps/${id}/review`)
    ).json();
  // Browser pointer events quantize to device pixels; the exact stored picked points determine the ratio.
  expect(r.scale.ratio).toBeCloseTo(4, 1);
  expect(r.scale.ratio).toBeCloseTo(
    200 /
      Math.hypot(
        r.scale.points[0][0] - r.scale.points[1][0],
        r.scale.points[0][1] - r.scale.points[1][1],
      ),
    8,
  );
  await page
    .getByRole("button", { name: "Review plot 1", exact: true })
    .click();
  await page.getByLabel("SVG split coordinate", { exact: true }).fill("30");
  await page.getByLabel("First new plot number").fill("1A");
  await page.getByLabel("Second new plot number").fill("1B");
  await page
    .getByRole("button", { name: "Split one selected plot", exact: true })
    .click();
  await expect(page.getByText("9 active plots", { exact: true })).toBeVisible();
  await page
    .getByRole("checkbox", { name: "Select plot 1A", exact: true })
    .check();
  await page
    .getByRole("checkbox", { name: "Select plot 1B", exact: true })
    .check();
  await page.getByLabel("Merged plot number").fill("1");
  await page
    .getByRole("button", { name: "Merge selected (2)", exact: true })
    .click();
  await expect(page.getByText("8 active plots", { exact: true })).toBeVisible();
  await page.getByLabel("Project", { exact: true }).selectOption({ index: 1 });
  await expect(page.getByLabel("Map version", { exact: true })).toHaveValue("");
  await page.getByLabel("Project", { exact: true }).selectOption("prop_1");
  await expect(page.getByText("8 active plots", { exact: true })).toBeVisible();
  await expect(
    page.locator('[aria-label="Plot Map administration"]').getByRole("alert"),
  ).toHaveCount(0);
});
