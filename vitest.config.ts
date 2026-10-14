import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    coverage: {
      provider: "v8",
      include: ["src/server/**/*.ts", "src/lib/**/*.ts"],
      exclude: ["src/server/db/seed-cli.ts", "src/server/modules/accounting/cycle-cli.ts", "src/server/modules/billing/cycle-cli.ts", "src/server/modules/maintenance/cycle-cli.ts"],
      thresholds: {
        lines: 70,
        functions: 70,
        statements: 70,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
});
