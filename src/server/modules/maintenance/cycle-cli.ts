import { getDb } from "@/server/db";
import { runMaintenanceCycle } from "./maintenance.service";
import { dispatchNotifications } from "../notifications/notifications.service";
import type { JwtPayload } from "@/server/auth/crypto";
import { nowIso } from "../shared/domain";

const watch = process.argv.includes("--watch");
const reference = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
let stopping = false,
  timer: ReturnType<typeof setTimeout> | undefined,
  wake: (() => void) | undefined;
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    stopping = true;
    if (timer) clearTimeout(timer);
    wake?.();
  });
async function runOnce() {
  for (const org of getDb()
    .prepare(
      "SELECT id FROM organizations WHERE status='active' AND deleted_at IS NULL",
    )
    .all()) {
    const ctx: JwtPayload = {
      sub: "system",
      email: "",
      fullName: "Maintenance scheduler",
      organizationId: String(org.id),
      organizationSlug: "",
      branchId: null,
      roleId: "",
      roleSlug: "system",
      permissions: ["maintenance:read", "maintenance:triage"],
    };
    const when = reference || nowIso();
    console.log(
      JSON.stringify({
        organizationId: ctx.organizationId,
        ...runMaintenanceCycle(ctx, when),
        notifications: await dispatchNotifications(
          ctx.organizationId,
          undefined,
          when,
        ),
      }),
    );
  }
}
async function main() {
  if (watch && reference)
    throw new Error(
      "Historical reference time is only supported for a one-shot cycle, not --watch.",
    );
  do {
    try {
      await runOnce();
    } catch (error) {
      if (!watch) throw error;
      console.error(
        JSON.stringify({
          event: "maintenance.cycle_failed",
          message: error instanceof Error ? error.message : String(error),
        }),
      );
    }
    if (!watch || stopping) break;
    await new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, 60000);
    });
  } while (!stopping);
}
main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
