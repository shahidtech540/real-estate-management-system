import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { listRolesAndPermissions, toggleRolePermission } from "@/server/modules/admin/admin.service";

const toggleSchema = z.object({
  roleSlug: z.string().min(1),
  permissionCode: z.string().min(1),
  enabled: z.boolean(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    const data = listRolesAndPermissions(ctx.organizationId);
    return NextResponse.json(data);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "admin:manage");

    const body = await req.json();
    const parsed = toggleSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid permission toggle payload." } },
        { status: 400 }
      );
    }

    const updated = toggleRolePermission(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
