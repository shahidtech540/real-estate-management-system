import { getDb } from "@/server/db";
import { syncSourcesInternal } from "./accounting.service";
import { runReportCycle } from "./schedules.service";
const watch = process.argv.includes("--watch"),
  sync = process.argv.includes("--sync");
let stopped = false,
  timer: ReturnType<typeof setTimeout> | undefined,
  wake: (() => void) | undefined;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    wake?.();
  });
async function main() {
  if (watch && sync)
    throw new Error("Use --sync once, not as a recurring worker.");
  do {
    try {
      for (const org of getDb()
        .prepare(
          "SELECT id FROM organizations WHERE status='active' AND deleted_at IS NULL",
        )
        .all())
        console.log(
          JSON.stringify({
            organizationId: org.id,
            ...(sync
              ? syncSourcesInternal(String(org.id), "system")
              : runReportCycle(String(org.id))),
          }),
        );
    } catch (e) {
      if (!watch) throw e;
      console.error(e instanceof Error ? e.message : String(e));
    }
    if (!watch || stopped) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, 60000);
    });
  } while (!stopped);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
