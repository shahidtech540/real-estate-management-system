import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { valid } from "@/server/modules/shared/domain";
import {
  createTenant,
  listTenants,
  updateTenantKyc,
} from "@/server/modules/leases/leases.service";
export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "tenants:read");
    return NextResponse.json({
      tenants: listTenants({
        organizationId: ctx.organizationId,
        search: req.nextUrl.searchParams.get("search") || undefined,
        kycStatus: req.nextUrl.searchParams.get("kycStatus") || undefined,
      }),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "tenants:write");
    return NextResponse.json(
      { tenant: createTenant(ctx.organizationId, ctx.sub, await req.json()) },
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "tenants:write");
    const body = valid(
      z.object({
        id: z.string().min(1),
        kycStatus: z.enum(["pending", "verified", "rejected"]),
      }),
      await req.json(),
    );
    return NextResponse.json({
      tenant: updateTenantKyc(
        ctx.organizationId,
        ctx.sub,
        body.id,
        body.kycStatus,
      ),
    });
  } catch (e) {
    return handleApiError(e);
  }
}
