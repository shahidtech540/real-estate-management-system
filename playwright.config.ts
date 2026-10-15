import { defineConfig } from "@playwright/test";

const port = process.env.E2E_PORT || "3000";
const baseURL = `http://localhost:${port}`;
export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  workers: 1, // Shared demo fixtures and kill switches: keep workflow tests serial.
  webServer: {
    command: `npx next start -H 0.0.0.0 -p ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    env: {
      REMS_DEPLOYMENT: "demo",
      SQLITE_DB_PATH: `./data/e2e-${Date.now()}.sqlite`,
    },
    timeout: 60000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
    // Synthetic cross-site iframe tests never leave the intercepted test origin.
    // Disable Chromium's local-network gate only for this local browser harness.
    launchOptions: {
      ...(process.env.CHROMIUM_PATH
        ? { executablePath: process.env.CHROMIUM_PATH }
        : {}),
      args: [
        ...(process.env.CHROMIUM_PATH
          ? ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"]
          : []),
        "--disable-features=LocalNetworkAccessChecks",
      ],
    },
  },
});
