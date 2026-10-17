/** Explicit demo import; no seeded inventory or financial writes. */
import { readFileSync } from "node:fs";
import { getDb } from "../src/server/db";
import { freshContext } from "../src/server/modules/orchestration/orchestration.service";
import {
  uploadMap,
  getMap,
} from "../src/server/modules/plot-maps/plot-maps.service";
if (process.env.REMS_DEPLOYMENT === "production")
  throw new Error(
    "Sample import is demo-only; use authenticated upload for real projects.",
  );
const projectId = process.argv[2] || "prop_1",
  file = process.argv[3] || "samples/plots-explicit.svg";
getDb();
const ctx = freshContext("org_pakland", "usr_admin");
const map = uploadMap(ctx, projectId, readFileSync(file, "utf8"));
console.log(
  JSON.stringify(
    { ...map, plots: getMap(ctx, projectId, map.id, { limit: 100 }).plots },
    null,
    2,
  ),
);
console.log(
  "Draft geometry only: no publication, bookings, sales, payments or existing units were changed.",
);
