import {
  test,
  expect,
  type Page,
  type APIRequestContext,
} from "@playwright/test";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { PDFDocument } from "pdf-lib";
const base = "/api/v1/properties/prop_2/plot-maps";
async function login(request: APIRequestContext) {
  expect(
    (
      await request.post("/api/v1/auth/login", {
        data: { email: "admin@fahadrealestate.test", password: "Password123!" },
      })
    ).ok(),
  ).toBeTruthy();
}
async function open(page: Page, number = "1") {
  await page.goto("/dashboard");
  await expect(page.getByTestId("active-role-badge")).toContainText("admin");
  if (await page.getByTestId("tab-plot-map").isVisible())
    await page.getByTestId("tab-plot-map").click();
  else await page.getByTestId("workspace-select").selectOption("plot-map");
  await page
    .getByRole("button", { name: "Published map", exact: true })
    .click();
  await page.getByLabel("Published map project").selectOption("prop_2");
  await expect(page.getByTestId("interactive-published-map")).toBeVisible();
  const shape = page.getByRole("button", {
    name: new RegExp(`^Plot ${number}, `),
  });
  await shape.scrollIntoViewIfNeeded();
  if (await page.evaluate(() => navigator.maxTouchPoints > 0))
    await shape.tap();
  else await shape.click();
  await expect(
    page.getByRole("dialog", { name: `Plot ${number} information` }),
  ).toBeVisible();
}
async function existingClient(page: Page) {
  await expect(
    page.getByRole("form", { name: "Plot booking form" }),
  ).toBeVisible();
  await page.getByLabel("Search clients by name or phone").fill("Booking E2E");
  await expect(
    page.getByLabel("Existing client").locator("option"),
  ).toHaveCount(2);
  await page
    .getByLabel("Existing client")
    .selectOption({ label: "Booking E2E Buyer · +923001234567" });
}
function futureLocal(days: number) {
  const d = new Date(Date.now() + days * 86400000);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000)
    .toISOString()
    .slice(0, 16);
}
test.beforeAll(async ({ request }) => {
  await login(request);
  const upload = await request.post(base, {
    headers: { "Content-Type": "image/svg+xml" },
    data: readFileSync("samples/plots-explicit.svg", "utf8"),
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
  expect(
    (
      await request.patch(`${base}/${m.id}/review`, {
        data: {
          action: "bulk",
          revision: r.revision,
          elementIds: r.plots.map((p: { elementId: string }) => p.elementId),
          data: { total_price_minor: 100003, currency: "PKR" },
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
          elementIds: [
            r.plots.find((p: { plotNumber: string }) => p.plotNumber === "8")
              .elementId,
          ],
          data: { status: "blocked" },
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
          elementIds: [
            r.plots.find((p: { plotNumber: string }) => p.plotNumber === "7")
              .elementId,
          ],
          data: { total_price_minor: 0 },
        },
      })
    ).ok(),
  ).toBeTruthy();
  r = await (await request.get(`${base}/${m.id}/review`)).json();
  expect(
    (
      await request.post(`${base}/${m.id}/publish`, {
        data: {
          revision: r.revision,
          baselineMapId: r.diff.baselineMapId,
          keepExistingData: true,
          acceptWarnings: true,
          warningReason: "Checked synthetic Phase D fixture",
          acknowledgeRemoved: true,
        },
      })
    ).ok(),
  ).toBeTruthy();
});
test("available click → new client/reservation/installments/uploads → PDFs/CRM/billing → extend/confirm/cancel on full page", async ({
  page,
}) => {
  await login(page.request);
  await open(page);
  await expect(
    page.getByRole("form", { name: "Plot booking form" }),
  ).toBeVisible();
  await page.getByLabel("Client mode").selectOption("new");
  await page.getByLabel("Client full name").fill("Booking E2E Buyer");
  await page.getByLabel("Client phone").fill("+923001234567");
  await page
    .getByLabel("Client CNIC / ID (optional)")
    .fill("synthetic-id-only");
  await page.getByLabel("Client email (optional)").fill("buyer@example.test");
  await page
    .getByLabel("Client address (optional)")
    .fill("Synthetic test address");
  await page.getByLabel("Assigned agent").selectOption("usr_agent");
  await page.getByLabel("Token requested (PKR)").fill("123.45");
  await page
    .getByLabel("Payment plan", { exact: true })
    .selectOption("installment");
  await page.getByLabel("Down payment including token (PKR)").fill("200");
  await page.getByLabel("Number of monthly installments").fill("3");
  await page
    .getByLabel("First installment date")
    .fill(new Date(Date.now() + 32 * 86400000).toISOString().slice(0, 10));
  await expect(page.getByTestId("payment-schedule")).toContainText(
    "PKR 266.67",
  );
  const doc = await PDFDocument.create();
  doc.addPage();
  const buffer = Buffer.from(await doc.save());
  await page.getByLabel("ID copy (PDF, PNG or JPEG, max 2 MiB)").setInputFiles({
    name: "synthetic-id.pdf",
    mimeType: "application/pdf",
    buffer,
  });
  await expect(
    page.getByRole("button", { name: "Remove ID copy" }),
  ).toBeVisible();
  await page
    .getByLabel("Payment evidence (unverified, max 2 MiB)")
    .setInputFiles({
      name: "synthetic-evidence.pdf",
      mimeType: "application/pdf",
      buffer,
    });
  await expect(
    page.getByRole("button", { name: "Remove payment evidence" }),
  ).toBeVisible();
  const saved = page.waitForResponse(
    (r) => r.url().endsWith("/bookings") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save plot booking" }).click();
  const response = await saved;
  expect(response.status()).toBe(201);
  const result = await response.json();
  await expect(
    page.getByRole("status").filter({ hasText: "Booking saved." }),
  ).toBeVisible();
  await expect(page.getByTestId("plot-detail-status")).toHaveText(
    "Status: reserved",
  );
  await expect(page.getByTestId("count-reserved")).toHaveText("1");
  await expect(
    page.locator(`[data-plot-id="${result.plot.id}"]`),
  ).toHaveAttribute("data-status", "reserved");
  expect(result.bookings[0].lead_id).toBeTruthy();
  expect(result.bookings[0].files).toHaveLength(4);
  const downloadEvent = page.waitForEvent("download");
  await page
    .getByRole("link", { name: "Download confirmation PDF", exact: true })
    .click();
  const downloaded = await downloadEvent;
  const bytes = await readFile((await downloaded.path())!);
  expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
  expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  const file = result.bookings[0].files.find(
    (f: { kind: string }) => f.kind === "id_copy",
  );
  const protectedFile = await page.request.get(
    `/api/v1/plots/${result.plot.id}/files/${file.id}`,
  );
  expect(protectedFile.headers()["content-security-policy"]).toContain(
    "sandbox",
  );
  expect(protectedFile.headers()["content-disposition"]).toContain(
    "attachment",
  );
  expect(protectedFile.headers()["cache-control"]).toContain("no-store");
  expect((await protectedFile.body()).equals(buffer)).toBeTruthy();
  const invoices = await (
    await page.request.get("/api/v1/billing/plot-invoices")
  ).json();
  expect(
    invoices.invoices.find(
      (i: { booking_id: string }) => i.booking_id === result.bookingId,
    ),
  ).toMatchObject({ amount_minor: 12345, status: "pending" });
  await page.getByRole("link", { name: "Full plot page & activity" }).click();
  await expect(page).toHaveURL(new RegExp(`/plots/${result.plot.id}$`));
  await expect(
    page.getByRole("heading", { name: "Private plot record" }),
  ).toBeVisible();
  await expect(
    page.getByText("plot.booking.created", { exact: false }),
  ).toBeVisible();
  await page
    .getByLabel("Reason for booking action")
    .fill("Buyer requested longer hold");
  await page
    .getByLabel("Extended hold expiry (browser local time)")
    .fill(futureLocal(3));
  await page.getByRole("button", { name: "Extend hold", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "extend saved" }),
  ).toBeVisible();
  await page
    .getByLabel("Reason for booking action")
    .fill("Terms verified by administrator");
  await page
    .getByRole("button", { name: "Confirm booking", exact: true })
    .click();
  await expect(page.getByTestId("plot-detail-status")).toHaveText(
    "Status: booked",
  );
  await page
    .getByLabel("Reason for booking action")
    .fill("Buyer withdrew booking request");
  await page
    .getByRole("button", { name: "Cancel booking", exact: true })
    .click();
  await expect(page.getByTestId("plot-detail-status")).toHaveText(
    "Status: available",
  );
  await expect(
    page.getByRole("heading", { name: "Booking E2E Buyer · cancelled" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Download confirmation PDF" }),
  ).toBeVisible();
});
test("two actual browser submissions have one winner; loser sees clear conflict and its local map updates", async ({
  page,
  context,
}) => {
  await login(page.request);
  const other = await context.newPage();
  try {
    await open(page);
    await open(other);
    await existingClient(page);
    await existingClient(other);
    const a = page.waitForResponse(
        (r) => r.url().endsWith("/bookings") && r.request().method() === "POST",
      ),
      b = other.waitForResponse(
        (r) => r.url().endsWith("/bookings") && r.request().method() === "POST",
      );
    await Promise.all([
      page.getByRole("button", { name: "Save plot booking" }).click(),
      other.getByRole("button", { name: "Save plot booking" }).click(),
    ]);
    const responses = await Promise.all([a, b]);
    expect(responses.map((r) => r.status()).sort()).toEqual([201, 409]);
    const loser = responses[0].status() === 409 ? page : other,
      winner = loser === page ? other : page;
    await expect(
      loser.getByRole("alert").filter({ hasText: "just booked" }),
    ).toContainText("just booked");
    for (const p of [page, other]) {
      await expect(p.getByTestId("plot-detail-status")).toHaveText(
        "Status: reserved",
      );
      await expect(p.getByTestId("count-reserved")).toHaveText("1");
    }
    await winner
      .getByLabel("Reason for booking action")
      .fill("End isolated browser race fixture");
    await winner
      .getByRole("button", { name: "Cancel booking", exact: true })
      .click();
    await expect(winner.getByTestId("plot-detail-status")).toHaveText(
      "Status: available",
    );
  } finally {
    await other.close();
  }
});
test("phone tap → existing client → confirmed full-plan booking; focus stays in modal and returns to plot", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({
    baseURL,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  try {
    const page = await context.newPage();
    await login(page.request);
    await open(page, "2");
    await existingClient(page);
    await page.getByLabel("Booking type", { exact: true }).selectOption("book");
    await expect(
      page.getByLabel("Hold expiry (browser local time)", { exact: true }),
    ).toHaveCount(0);
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press("Tab");
      expect(
        await page.evaluate(
          () => !!document.activeElement?.closest("dialog[data-plot-booking]"),
        ),
      ).toBeTruthy();
    }
    await page.getByRole("button", { name: "Save plot booking" }).tap();
    await expect(page.getByTestId("plot-detail-status")).toHaveText(
      "Status: booked",
    );
    await expect(
      page.getByRole("status").filter({ hasText: "Booking saved." }),
    ).toBeVisible();
    const box = (await page.getByRole("dialog").boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    expect(box.height).toBeLessThanOrEqual(844);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Plot 2, / })).toBeFocused();
    await expect(page.getByTestId("count-booked")).toHaveText("1");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  } finally {
    await context.close();
  }
});
test("blocked and unpriced plots cannot open a submit form; full-page billing register links remain usable", async ({
  page,
}) => {
  await login(page.request);
  await open(page, "8");
  await expect(
    page.getByText(/Blocked: booking is not permitted/),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Plot booking form" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close plot information" }).click();
  await page.getByRole("button", { name: /^Plot 7, / }).click();
  await expect(page.getByText(/Publish a positive total price/)).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Plot booking form" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close plot information" }).click();
  await page.getByTestId("tab-billing").click();
  await expect(
    page.getByRole("heading", { name: "Plot token invoices", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Abdullah City · Plot/ }).first(),
  ).toBeVisible();
});

test("stale publication cannot be booked; a status-filtered booking keeps its confirmation open and closes to canvas focus", async ({
  page,
}) => {
  await login(page.request);
  // Explicit stale-client render fixture; server publication/booking data is not modified.
  await page.route(
    "**/api/v1/properties/prop_2/plot-maps/viewer",
    async (route) => {
      const response = await route.fetch(),
        map = await response.json();
      await route.fulfill({
        response,
        json: { ...map, id: "stale-client-publication" },
      });
    },
  );
  await open(page, "A-3");
  await expect(
    page.getByRole("alert").filter({ hasText: "Publication changed" }),
  ).toBeVisible();
  await expect(
    page.getByRole("form", { name: "Plot booking form" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close plot information" }).click();
  await page.unroute("**/api/v1/properties/prop_2/plot-maps/viewer");
  await page
    .getByRole("button", { name: "Refresh published map", exact: true })
    .click();
  await expect(page.getByTestId("interactive-published-map")).toBeVisible();
  await page.getByLabel("Filter status").selectOption("available");
  await page.getByRole("button", { name: /^Plot A-3, / }).click();
  await existingClient(page);
  await page.getByRole("button", { name: "Save plot booking" }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "Booking saved." }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("button", { name: /^Plot A-3, / })).toHaveCount(
    0,
  );
  await page.getByRole("button", { name: "Close plot information" }).click();
  await expect(page.getByTestId("interactive-published-map")).toBeFocused();
});
