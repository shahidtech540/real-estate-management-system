import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  assignPropertyOwners,
  createOwner,
  listOwners,
} from "@/server/modules/portfolio/portfolio.service";

const createOwnerSchema = z.object({
  fullName: z.string().min(2),
  cnicNtn: z.string().min(5),
  email: z.string().email(),
  phone: z.string().min(6),
  bankName: z.string().optional(),
  iban: z.string().optional(),
  managementFeePct: z.number().min(0).max(50).optional(),
});

const assignOwnersSchema = z.object({
  propertyId: z.string().min(1),
  allocations: z.array(
    z.object({
      ownerId: z.string().min(1),
      ownershipPct: z.number().positive(),
      isPrimary: z.boolean().optional(),
    })
  ),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "owners:read");

    const owners = listOwners(ctx.organizationId);
    return NextResponse.json({ owners });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "owners:write");

    const body = await req.json();
    const parsed = createOwnerSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid owner creation payload." } },
        { status: 400 }
      );
    }

    const owner = createOwner(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ owner }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PUT(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "owners:write");

    const body = await req.json();
    const parsed = assignOwnersSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid ownership allocation payload." } },
        { status: 400 }
      );
    }

    const property = assignPropertyOwners(
      ctx.organizationId,
      ctx.sub,
      parsed.data.propertyId,
      parsed.data.allocations
    );
    return NextResponse.json({ property });
  } catch (err) {
    return handleApiError(err);
  }
}
