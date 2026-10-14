import { NextResponse } from "next/server";
import { getDb } from "@/server/db";

export async function GET() {
  const start = Date.now();
  const db = getDb();
  const orgCount = (db.prepare("SELECT COUNT(*) as c FROM organizations").get() as { c: number }).c;
  const propCount = (db.prepare("SELECT COUNT(*) as c FROM properties WHERE organization_id = 'org_pakland'").get() as { c: number }).c;
  const unitCount = (db.prepare("SELECT COUNT(*) as c FROM units WHERE organization_id = 'org_pakland'").get() as { c: number }).c;
  const latencyMs = Date.now() - start;

  return NextResponse.json({
    status: "ok",
    service: "rems-agentic-platform",
    phase: 4,
    timestamp: new Date().toISOString(),
    dbLatencyMs: latencyMs,
    metrics: {
      organizations: orgCount,
      paklandProperties: propCount,
      paklandUnits: unitCount,
    },
  });
}
