import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  createUnit,
  listUnits,
  updateUnit,
  VALID_UNIT_STATUSES,
  VALID_UNIT_TYPES,
} from "@/server/modules/portfolio/portfolio.service";

const createUnitSchema = z.object({
  propertyId: z.string().min(1),
  buildingId: z.string().optional(),
  unitNumber: z.string().min(1),
  type: z.enum(VALID_UNIT_TYPES),
  areaSqft: z.number().positive(),
  areaDisplay: z.string().min(1),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  status: z.enum(VALID_UNIT_STATUSES).optional(),
  marketPriceMinor: z.number().min(0),
  monthlyRentMinor: z.number().min(0),
  amenities: z.array(z.string()).optional(),
});

const updateUnitSchema = z.object({
  unitId: z.string().min(1),
  status: z.enum(VALID_UNIT_STATUSES).optional(),
  marketPriceMinor: z.number().min(0).optional(),
  monthlyRentMinor: z.number().min(0).optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:read");

    const { searchParams } = new URL(req.url);
    const result = listUnits({
      organizationId: ctx.organizationId,
      ownerUserId: ctx.roleSlug === "owner" ? ctx.sub : undefined,
      propertyId: searchParams.get("propertyId") || undefined,
      buildingId: searchParams.get("buildingId") || undefined,
      type: searchParams.get("type") || undefined,
      status: searchParams.get("status") || undefined,
      search: searchParams.get("search") || undefined,
      limit: parseInt(searchParams.get("limit") || "50", 10),
      offset: parseInt(searchParams.get("offset") || "0", 10),
    });

    return NextResponse.json(result);
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:write");

    const body = await readJson(req);
    const parsed = createUnitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid unit creation payload.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const unit = createUnit(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ unit }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:write");

    const body = await readJson(req);
    const parsed = updateUnitSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid unit update payload." } },
        { status: 400 }
      );
    }

    const updated = updateUnit(ctx.organizationId, ctx.sub, parsed.data.unitId, {
      status: parsed.data.status,
      marketPriceMinor: parsed.data.marketPriceMinor,
      monthlyRentMinor: parsed.data.monthlyRentMinor,
    });
    return NextResponse.json({ unit: updated });
  } catch (err) {
    return handleApiError(err);
  }
}
