const fs = require("node:fs"),
  path = require("node:path"),
  spec = JSON.parse(fs.readFileSync("docs/openapi.json"));
if (spec.openapi !== "3.0.3") throw Error("OpenAPI version");
const ids = new Set();
for (const [url, methods] of Object.entries(spec.paths)) {
  const file = "src/app" + url.replace(/\{([^}]+)\}/g, "[$1]") + "/route.ts";
  if (!fs.existsSync(file)) throw Error("Missing implementation: " + url);
  const src = fs.readFileSync(file, "utf8");
  for (const [method, op] of Object.entries(methods)) {
    if (
      !src.includes("export async function " + method.toUpperCase() + "(") ||
      ids.has(op.operationId)
    )
      throw Error("Invalid/duplicate operation " + url);
    ids.add(op.operationId);
    if (!op.responses) throw Error("Missing responses");
  }
}
function check(dir) {
  for (const n of fs.readdirSync(dir)) {
    const p = path.join(dir, n);
    if (fs.statSync(p).isDirectory()) check(p);
    else if (n === "route.ts") {
      const url =
        "/api/v1/" +
        path
          .relative("src/app/api/v1", dir)
          .replaceAll(path.sep, "/")
          .replace(/\[([^\]]+)\]/g, "{$1}");
      if (!spec.paths[url]) throw Error("Undocumented handler " + url);
    }
  }
}
check("src/app/api/v1");
const refs = JSON.stringify(spec).matchAll(/"\$ref":"([^\"]+)"/g);
for (const [, r] of refs) {
  let node = spec;
  for (const key of r.replace("#/", "").split("/")) node = node?.[key];
  if (!node) throw Error("Unresolved schema " + r);
}
console.log(
  "Validated",
  Object.keys(spec.paths).length,
  "routes and",
  ids.size,
  "operations; portal schemas resolved.",
);
