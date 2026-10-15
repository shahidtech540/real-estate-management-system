import { test, expect } from "@playwright/test";
test("login shows Fahad Real Estate and only its six demo roles", async ({
  page,
}, info) => {
  await page.goto("/login");
  await expect(
    page.getByRole("heading", { name: "Fahad Real Estate", exact: true }),
  ).toBeVisible();
  await expect(page.locator('[data-testid^="quick-login-"]')).toHaveCount(6);
  await expect(page.getByText("Our Projects · Rahim Yar Khan")).toBeVisible();
  await expect(
    page.getByText(/Indus Valley|Islamabad|Rawalpindi|Lahore|PakLand/),
  ).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("fahad-login.png") });
});
test("production dashboard exposes one RYK office and exactly the five configured projects", async ({
  page,
}, info) => {
  await page.request.post("/api/v1/auth/login", {
    data: { email: "admin@fahadrealestate.test", password: "Password123!" },
  });
  const me = await (await page.request.get("/api/v1/auth/me")).json();
  expect(me.user.organization.name).toBe("Fahad Real Estate");
  expect(me.branches).toHaveLength(1);
  expect(me.branches[0].city).toBe("Rahim Yar Khan");
  expect(me.summary.kpis.totalProperties).toBe(5);
  const result = await (await page.request.get("/api/v1/properties")).json();
  expect(result.properties.map((p: { name: string }) => p.name).sort()).toEqual(
    [
      "Fahad Garden Housing Scheme",
      "Abdullah City",
      "Taj Commercial Center",
      "VIP Block",
      "University Commercial Centers",
    ].sort(),
  );
  expect(
    result.properties.every(
      (p: {
        city: string;
        latitude: number | null;
        longitude: number | null;
      }) =>
        p.city === "Rahim Yar Khan" &&
        p.latitude === null &&
        p.longitude === null,
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/dashboard");
  await expect(page.getByTestId("branch-switcher-select")).toBeDisabled();
  await expect(
    page.getByTestId("branch-switcher-select").locator("option"),
  ).toHaveCount(1);
  await expect(
    page.getByTestId("role-switcher-select").locator("option"),
  ).toHaveCount(6);
  await page.waitForLoadState("networkidle");
  await page.screenshot({ path: info.outputPath("fahad-dashboard.png") });
});
test("public portal and listing detail show RYK without fabricated approval claims", async ({
  page,
}, info) => {
  await page.goto("/listings");
  await expect(
    page.getByRole("heading", { name: "Properties in Rahim Yar Khan" }),
  ).toBeVisible();
  const data = await (
    await page.request.get("/api/v1/listings?public=true")
  ).json();
  expect(data.listings.length).toBeGreaterThan(0);
  expect(
    data.listings.every((l: { city: string }) => l.city === "Rahim Yar Khan"),
  ).toBe(true);
  await page.goto(`/listings/${data.listings[0].slug}`);
  await expect(
    page.getByText("Contact Fahad Real Estate to verify details"),
  ).toBeVisible();
  await expect(
    page.getByText(/LDA-approved|backed by verified ownership|PakLand/),
  ).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(391);
  await page.screenshot({ path: info.outputPath("fahad-listing-mobile.png") });
});
