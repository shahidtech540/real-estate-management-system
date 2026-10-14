import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 60000,
  webServer: {
    command: "npm start",
    url: "http://localhost:3000",
    reuseExistingServer: !process.env.CI,
    env: { SQLITE_DB_PATH: `./data/e2e-${Date.now()}.sqlite` },
    timeout: 60000,
  },
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"],
        }
      : undefined,
  },
});
