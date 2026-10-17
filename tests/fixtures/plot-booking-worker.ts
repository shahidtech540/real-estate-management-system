/** Isolated test subprocess: never run against a business database. */
import { createBooking } from "../../src/server/modules/plot-maps/bookings.service";
import { freshContext } from "../../src/server/modules/orchestration/orchestration.service";
import { getDb } from "../../src/server/db";
if (process.env.NODE_ENV !== "test" || !process.send)
  throw new Error("Test-only IPC worker");
getDb();
process.on("message", async (message: { plotId: string; input: unknown }) => {
  let result: Record<string, unknown>;
  try {
    const r = await createBooking(
      freshContext("org_pakland", "usr_admin"),
      message.plotId,
      message.input,
    );
    result = { status: 201, bookingId: r.bookingId };
  } catch (e) {
    result = {
      status: (e as { status?: number }).status || 500,
      code: (e as { code?: string }).code || "ERROR",
      error: (e as Error).message,
    };
  } finally {
    getDb().close();
    process.send?.(result!, () => {
      if (process.connected) process.disconnect();
    });
  }
});
process.send({ ready: true });
