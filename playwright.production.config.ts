import { defineConfig } from "@playwright/test";
import { randomBytes } from "node:crypto";
const port = "3002",
  baseURL = `http://localhost:${port}`;
export default defineConfig({
  testDir: "./e2e-production",
  workers: 1,
  timeout: 60000,
  webServer: {
    command: `npm run db:provision && npx next start -H 0.0.0.0 -p ${port}`,
    url: baseURL + "/api/v1/health",
    reuseExistingServer: false,
    timeout: 60000,
    env: {
      REMS_DEPLOYMENT: "production",
      SQLITE_DB_PATH: `./data/production-e2e-${Date.now()}.sqlite`,
      JWT_ACCESS_SECRET: randomBytes(48).toString("hex"),
      JWT_REFRESH_SECRET: randomBytes(48).toString("hex"),
      ADMIN_EMAIL: "operator@company.pk",
      ADMIN_PASSWORD: "synthetic-production-browser-fixture-password",
      TRUSTED_ORIGINS: baseURL,
      FRAME_ANCESTORS: "'self'",
    },
  },
  use: {
    baseURL,
    launchOptions: process.env.CHROMIUM_PATH
      ? {
          executablePath: process.env.CHROMIUM_PATH,
          args: ["--no-sandbox", "--disable-dev-shm-usage", "--no-zygote"],
        }
      : {},
  },
});
