import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";
async function login(page: Page) {
  expect(
    (
      await page.request.post("/api/v1/auth/login", {
        data: { email: "admin@fahadrealestate.test", password: "Password123!" },
      })
    ).ok(),
  ).toBeTruthy();
}
async function publish(
  request: APIRequestContext,
  project = "prop_3",
  source = readFileSync("samples/plots-explicit.svg", "utf8"),
) {
  const base = `/api/v1/properties/${project}/plot-maps`;
  const upload = await request.post(base, {
    headers: { "Content-Type": "image/svg+xml" },
    data: source,
  });
  expect(upload.status()).toBe(201);
  const m = await upload.json();
  expect(
    (
      await request.patch(`${base}/${m.id}/review`, {
        data: {
          action: "calibrate",
          revision: 0,
          calibration: { unit: "ft", ratio: 1, areaUnit: "sqft" },
        },
      })
    ).ok(),
  ).toBeTruthy();
  let r = await (await request.get(`${base}/${m.id}/review`)).json();
  if (project === "prop_3") {
    const one = r.plots.find(
        (p: { plotNumber: string }) => p.plotNumber === "1",
      ),
      two = r.plots.find((p: { plotNumber: string }) => p.plotNumber === "2");
    expect(
      (
        await request.patch(`${base}/${m.id}/review`, {
          data: {
            action: "bulk",
            revision: r.revision,
            elementIds: [one.elementId],
            data: {
              block: "North",
              area_official: 5,
              area_unit: "marla",
              dimensions_official: "30 × 45 ft",
              facing: "North",
              is_corner: 1,
              total_price_minor: 12345600,
            },
          },
        })
      ).ok(),
    ).toBeTruthy();
    r = await (await request.get(`${base}/${m.id}/review`)).json();
    expect(
      (
        await request.patch(`${base}/${m.id}/review`, {
          data: {
            action: "bulk",
            revision: r.revision,
            elementIds: [two.elementId],
            data: {
              block: "South",
              status: "blocked",
              is_corner: 0,
              total_price_minor: 5500000,
            },
          },
        })
      ).ok(),
    ).toBeTruthy();
    r = await (await request.get(`${base}/${m.id}/review`)).json();
  }
  const response = await request.post(`${base}/${m.id}/publish`, {
    data: {
      revision: r.revision,
      baselineMapId: r.diff.baselineMapId,
      keepExistingData: true,
      acceptWarnings: true,
      warningReason: "Checked synthetic map fixture",
      acknowledgeRemoved: true,
    },
  });
  expect(response.ok()).toBeTruthy();
  return m.id;
}
async function open(page: Page, project = "prop_3") {
  await page.goto("/dashboard");
  await expect(page.getByTestId("active-role-badge")).toContainText("admin");
  if (await page.getByTestId("tab-plot-map").isVisible())
    await page.getByTestId("tab-plot-map").click();
  else await page.getByTestId("workspace-select").selectOption("plot-map");
  await page
    .getByRole("button", { name: "Published map", exact: true })
    .click();
  await page.getByLabel("Published map project").selectOption(project);
  await expect(page.getByTestId("interactive-published-map")).toBeVisible();
}
test("published viewer: immediate hover details, non-color statuses, filters and snapshot refresh", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await publish(page.request);
  await open(page);
  // Locators use canonical accessible plot numbers, not designer IDs.
  const plot = page.getByRole("button", { name: /^Plot 1, / });
  await plot.hover();
  const tip = page.getByRole("tooltip");
  await expect(tip).toBeVisible();
  await expect(tip).toContainText("5 marla (official)");
  await expect(tip).toContainText("30 × 45 ft (official)");
  await expect(tip).toContainText("PKR 123,456.00");
  await expect(tip).toContainText("North");
  await expect(page.getByTestId("count-available")).toHaveText("7");
  await expect(page.getByTestId("count-blocked")).toHaveText("1");
  expect(await page.locator("pattern").count()).toBe(6);
  await page.getByLabel("Filter status").selectOption("blocked");
  await expect(page.getByTestId("count-blocked")).toHaveText("1");
  await expect(page.getByTestId("count-available")).toHaveText("0");
  await expect(plot).toBeHidden();
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByLabel("Filter block").selectOption("North");
  await page.getByLabel("Filter facing").selectOption("North");
  await page.getByLabel("Filter corner").selectOption("yes");
  await expect(
    page.getByRole("status").filter({ hasText: "1 of 8 plots shown." }),
  ).toBeVisible();
  await page.getByLabel("Minimum size (sqft)").fill("1362");
  await expect(
    page.getByText(
      "No plots match these filters. Clear or adjust the filters.",
    ),
  ).toBeVisible();
  await page.getByLabel("Minimum size (sqft)").fill("1300");
  await page.getByLabel("Maximum price (major currency units)").fill("120000");
  await expect(page.getByTestId("count-available")).toHaveText("0");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Refresh published map", exact: true })
    .click();
  await expect(page.getByTestId("count-available")).toHaveText("7");
});
test("search, wheel/drag controls and roving keyboard plot navigation", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await login(page);
  await open(page);
  await page.getByLabel("Search published plot number").fill("A-3");
  await page.getByRole("button", { name: "Find plot", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Found plot A-3." }),
  ).toBeVisible();
  await expect(page.getByTestId("map-zoom")).not.toHaveText("100%");
  const a = page.getByRole("button", { name: /^Plot A-3, / });
  await expect(a).toBeFocused();
  await a.press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Plot A-3 information" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close plot information" }).click();
  await expect(a).toBeFocused();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await a.press("ArrowLeft");
  const focused = await page.evaluate(() =>
    document.activeElement?.getAttribute("aria-label"),
  );
  expect(focused).toMatch(/^Plot 2,/);
  await page.keyboard.press("Escape");
  await page
    .getByRole("button", { name: "Fit to screen", exact: true })
    .click();
  await expect(page.getByTestId("map-zoom")).toHaveText("100%");
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  await expect(page.getByTestId("map-zoom")).toHaveText("150%");
  await page.getByRole("button", { name: "Zoom out", exact: true }).click();
  await expect(page.getByTestId("map-zoom")).toHaveText("100%");
  const canvas = page.getByTestId("interactive-published-map");
  await canvas.scrollIntoViewIfNeeded();
  const box = (await canvas.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.wheel(0, -200);
  await expect(page.getByTestId("map-zoom")).not.toHaveText("100%");
  const world = page.getByTestId("published-map-world"),
    before = await world.getAttribute("style");
  await page.mouse.move(box.x + 20, box.y + 20);
  await page.mouse.down();
  await page.mouse.move(box.x + 100, box.y + 60, { steps: 5 });
  await page.mouse.up();
  await expect(world).not.toHaveAttribute("style", before!);
  await page.getByLabel("Filter status").selectOption("blocked");
  await page.getByLabel("Search published plot number").fill("1");
  await page.getByRole("button", { name: "Find plot", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: /hidden by filters/ }),
  ).toBeVisible();
});
test("mobile tap tooltip stays in viewport; real two-finger pinch zooms without accidental selection", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
      baseURL,
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
    }),
    page = await context.newPage();
  try {
    await login(page);
    await open(page);
    const p = page.getByRole("button", { name: /^Plot 1, / });
    await p.tap();
    const dialog = page.getByRole("dialog", { name: "Plot 1 information" });
    await expect(dialog).toBeVisible();
    const b = (await dialog.boundingBox())!;
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width).toBeLessThanOrEqual(390);
    expect(b.y + b.height).toBeLessThanOrEqual(844);
    await page.getByRole("button", { name: "Close plot information" }).tap();
    await expect(dialog).toHaveCount(0);
    const canvas = page.getByTestId("interactive-published-map");
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!,
      x = box.x + box.width / 2,
      y = box.y + box.height / 2;
    const cdp = await context.newCDPSession(page);
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [
        { x: x - 30, y, id: 1 },
        { x: x + 30, y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        { x: x - 60, y, id: 1 },
        { x: x + 60, y, id: 2 },
      ],
    });
    await cdp.send("Input.dispatchTouchEvent", {
      type: "touchEnd",
      touchPoints: [],
    });
    await expect(page.getByTestId("map-zoom")).not.toHaveText("100%");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
test("1,000 plots keep their SVG nodes during hover/filter/zoom and tooltip needs no detail fetch", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const source = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 400">${Array.from({ length: 1000 }, (_, i) => `<rect data-plot="${i + 1}" x="${(i % 50) * 15}" y="${Math.floor(i / 50) * 15}" width="10" height="10"/>`).join("")}</svg>`;
  await publish(page.request, "prop_4", source);
  await open(page, "prop_4");
  await expect(page.getByTestId("count-available")).toHaveText("1000");
  await expect(page.locator("[data-plot-id]")).toHaveCount(1000);
  let reads = 0;
  page.on("request", (r) => {
    if (r.url().includes("/plot-maps/")) reads++;
  });
  await page.evaluate(() => {
    const w = window as unknown as {
      originalNode: Element | null;
      changes: number;
    };
    w.originalNode = document.querySelector("[data-plot-id]");
    w.changes = 0;
    new MutationObserver((ms) => {
      w.changes += ms.filter((m) => m.type === "childList").length;
    }).observe(
      document.querySelector('[aria-label="Published plot outlines"]')!,
      { childList: true, subtree: true },
    );
  });
  const times = await page.evaluate(async () => {
    const nodes = [
        ...document.querySelectorAll<SVGPathElement>("[data-plot-id]"),
      ].slice(0, 5),
      times: number[] = [];
    for (const n of nodes) {
      const start = performance.now();
      n.dispatchEvent(
        new PointerEvent("pointerover", {
          bubbles: true,
          pointerType: "mouse",
          clientX: 100,
          clientY: 150,
        }),
      );
      for (let i = 0; i < 12; i++) {
        await new Promise(requestAnimationFrame);
        if (
          document.querySelector('[role="tooltip"] h3')?.textContent ===
          n.getAttribute("aria-label")!.split(",")[0]
        )
          break;
      }
      times.push(performance.now() - start);
    }
    return times;
  });
  expect([...times].sort((a, b) => a - b)[2]).toBeLessThan(100);
  await page.getByLabel("Filter status").selectOption("blocked");
  await page
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await page.getByRole("button", { name: "Zoom in", exact: true }).click();
  expect(
    await page.evaluate(() => {
      const w = window as unknown as {
        originalNode: Element | null;
        changes: number;
      };
      return (
        w.changes === 0 &&
        w.originalNode === document.querySelector("[data-plot-id]")
      );
    }),
  ).toBe(true);
  expect(reads).toBe(0);
});

test("all six status styles render from a published DTO without transaction workflows", async ({
  page,
}) => {
  await login(page);
  // Render fixture only: Phase D/E creation of booked/sold/resale records is not invented here.
  await page.route(
    "**/api/v1/properties/prop_3/plot-maps/viewer",
    async (route) => {
      const response = await route.fetch(),
        data = await response.json(),
        statuses = [
          "available",
          "reserved",
          "booked",
          "sold",
          "resale",
          "blocked",
        ];
      data.plots.forEach((p: { status: string }, i: number) => {
        p.status = statuses[i % 6];
      });
      await route.fulfill({ response, json: data });
    },
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  for (const status of [
    "available",
    "reserved",
    "booked",
    "sold",
    "resale",
    "blocked",
  ]) {
    const node = page
      .locator(`[data-plot-id][data-status="${status}"]`)
      .first();
    await expect(node).toHaveAttribute("fill", new RegExp(`-${status}\\)`));
    await node.hover();
    await expect(page.getByRole("tooltip")).toContainText(
      status[0].toUpperCase() + status.slice(1),
    );
  }
});

test("review/viewer share the selected project and draft-only projects show a clear empty state", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  await open(page);
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue(
    "prop_3",
  );
  await page
    .getByRole("button", { name: "Published map", exact: true })
    .click();
  await expect(page.getByLabel("Published map project")).toHaveValue("prop_3");
  await expect(page.getByTestId("count-available")).toHaveText("7");
  await page.getByLabel("Published map project").selectOption("prop_5");
  await expect(
    page.getByRole("alert").filter({ hasText: /No published map/ }),
  ).toBeVisible();
  await expect(page.getByTestId("interactive-published-map")).toHaveCount(0);
  await page
    .getByRole("button", { name: "Review & publish", exact: true })
    .click();
  await expect(page.getByLabel("Project", { exact: true })).toHaveValue(
    "prop_5",
  );
});
