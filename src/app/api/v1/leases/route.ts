import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { valid, dateSchema } from "@/server/modules/shared/domain";
import { canReadProperty } from "@/server/modules/shared/access";
import {
  createLease,
  listLeases,
  updateLeaseLifecycle,
} from "@/server/modules/leases/leases.service";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leases:read");
    return NextResponse.json({
      leases: listLeases({
        organizationId: ctx.organizationId,
        status: req.nextUrl.searchParams.get("status") || undefined,
        expiryWindow: req.nextUrl.searchParams.get("expiryWindow") || undefined,
      }).filter((l) => canReadProperty(ctx, l.propertyId, l.tenantId)),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leases:write");
    return NextResponse.json(
      { lease: createLease(ctx.organizationId, ctx.sub, await readJson(req)) },
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leases:write");
    const body = valid(
      z.object({
        id: z.string().min(1),
        status: z.enum([
          "draft",
          "pending_signature",
          "active",
          "expiring",
          "renewed",
          "terminated",
          "expired",
        ]),
        newEndDate: dateSchema.optional(),
        applyEscalation: z.boolean().optional(),
      }),
      await readJson(req),
    );
    return NextResponse.json({
      lease: updateLeaseLifecycle(ctx.organizationId, ctx.sub, body.id, body),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
