import { getDb } from "@/server/db";
import { today, valid, monthSchema } from "@/server/modules/shared/domain";
import {
  listLeases,
  updateLeaseLifecycle,
} from "@/server/modules/leases/leases.service";
import { generateMonthlyRentCycle, applyLateFees } from "./billing.service";
const period = valid(monthSchema, process.argv[2] || today().slice(0, 7));
for (const org of getDb()
  .prepare(
    "SELECT id FROM organizations WHERE status = 'active' AND deleted_at IS NULL",
  )
  .all()) {
  const id = String(org.id);
  for (const lease of listLeases({ organizationId: id })) {
    if (["active", "expiring", "renewed"].includes(lease.status)) {
      if (lease.endDate < today())
        updateLeaseLifecycle(id, "system", lease.id, { status: "expired" });
      else if (lease.daysRemaining <= 90 && lease.status !== "expiring")
        updateLeaseLifecycle(id, "system", lease.id, { status: "expiring" });
    }
  }
  const cycle = generateMonthlyRentCycle(id, "system", period);
  console.log(
    JSON.stringify({
      organizationId: id,
      periodMonth: period,
      generated: cycle.generatedCount,
      skipped: cycle.skippedCount,
      lateFees: applyLateFees(id, "system"),
    }),
  );
}
