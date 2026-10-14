import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  createOrganizationUser,
  listOrganizationUsers,
  updateOrganizationUser,
} from "@/server/modules/admin/admin.service";

const createUserSchema = z.object({
  email: z.string().email(),
  fullName: z.string().min(2),
  password: z.string().min(8),
  roleSlug: z.string().min(2),
  branchId: z.string().optional(),
  phone: z.string().optional(),
  locale: z.enum(["en", "ur"]).optional(),
});

const updateUserSchema = z.object({
  userId: z.string().min(1),
  roleSlug: z.string().optional(),
  status: z.enum(["active", "suspended"]).optional(),
  branchId: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    const users = listOrganizationUsers(ctx.organizationId);
    return NextResponse.json({ users });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "admin:manage");

    const body = await req.json();
    const parsed = createUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid user creation payload." } },
        { status: 400 }
      );
    }

    const created = createOrganizationUser(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ user: created }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "admin:manage");

    const body = await req.json();
    const parsed = updateUserSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid user update payload." } },
        { status: 400 }
      );
    }

    const updated = updateOrganizationUser(ctx.organizationId, ctx.sub, parsed.data.userId, {
      roleSlug: parsed.data.roleSlug,
      status: parsed.data.status,
      branchId: parsed.data.branchId,
    });
    return NextResponse.json(updated);
  } catch (err) {
    return handleApiError(err);
  }
}
