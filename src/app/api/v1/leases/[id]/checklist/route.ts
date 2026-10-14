import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  HttpError,
} from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { assertReadable } from "@/server/modules/shared/access";
import {
  listLeases,
  listChecklists,
  saveChecklist,
  getLeaseEvents,
} from "@/server/modules/leases/leases.service";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leases:read");
    const { id } = await params;
    const lease = listLeases({ organizationId: ctx.organizationId }).find(
      (l) => l.id === id,
    );
    if (!lease) throw new HttpError(404, "NOT_FOUND", "Lease not found.");
    assertReadable(ctx, lease.propertyId, lease.tenantId);
    return NextResponse.json({
      checklists: listChecklists(ctx.organizationId, id),
      events: getLeaseEvents(ctx.organizationId, id),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leases:write");
    const { id } = await params;
    return NextResponse.json({
      checklists: saveChecklist(
        ctx.organizationId,
        ctx.sub,
        id,
        await req.json(),
      ),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
