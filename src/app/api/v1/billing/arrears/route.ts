import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { canReadProperty } from "@/server/modules/shared/access";
import { getArrearsAgingReport } from "@/server/modules/billing/billing.service";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "invoices:read");
    const report = getArrearsAgingReport(ctx.organizationId);
    report.totalArrearsMinor = 0;
    report.totalUnpaidInvoices = 0;
    for (const bucket of Object.values(report.buckets)) {
      bucket.items = bucket.items.filter((i) =>
        canReadProperty(ctx, i.propertyId, i.tenantId),
      );
      bucket.count = bucket.items.length;
      bucket.totalMinor = bucket.items.reduce((n, i) => n + i.balanceMinor, 0);
      report.totalArrearsMinor += bucket.totalMinor;
      report.totalUnpaidInvoices += bucket.count;
    }
    return NextResponse.json(report);
  } catch (e) {
    return handleApiError(e);
  }
}
