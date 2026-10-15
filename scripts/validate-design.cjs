// Static PostgreSQL design + Compose validation; no engine download or DB connection.
const fs = require("node:fs");
const wasm = require("@prisma/prisma-schema-wasm");
const yaml = require("yaml");
wasm.validate(
  JSON.stringify({
    prismaSchema: [
      ["schema.prisma", fs.readFileSync("prisma/schema.prisma", "utf8")],
    ],
    noColor: true,
  }),
);
const doc = yaml.parse(fs.readFileSync("docker-compose.yml", "utf8"));
for (const name of [
  "app",
  "maintenance-worker",
  "reports-worker",
  "agents-worker",
]) {
  const service = doc.services[name];
  if (
    !service?.volumes.includes("sqlite_data:/app/data") ||
    service.environment.SQLITE_DB_PATH !== "/app/data/rems.sqlite"
  )
    throw new Error(`${name} must share the application's SQLite path/volume`);
}
if (doc.services["agents-worker"].environment.AGENT_PROVIDER_MODE !== "local")
  throw new Error("The packaged agent worker must use the local provider");
console.log(
  "Prisma 6.19 design schema and Compose shared-runtime configuration validated. Docker execution is a separate check.",
);
