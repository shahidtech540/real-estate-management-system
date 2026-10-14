import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  createProperty,
  listProperties,
  VALID_PROPERTY_TYPES,
} from "@/server/modules/portfolio/portfolio.service";

const createPropertySchema = z.object({
  branchId: z.string().min(1),
  code: z.string().min(2),
  name: z.string().min(2),
  type: z.enum(VALID_PROPERTY_TYPES),
  city: z.string().min(2),
  address: z.string().min(4),
  latitude: z.number().optional(),
  longitude: z.number().optional(),
  amenities: z.array(z.string()).optional(),
  initialBuildingName: z.string().optional(),
  owners: z
    .array(
      z.object({
        ownerId: z.string().min(1),
        ownershipPct: z.number().positive().max(100),
        isPrimary: z.boolean().optional(),
      })
    )
    .optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:read");

    const { searchParams } = new URL(req.url);
    const properties = listProperties({
      organizationId: ctx.organizationId,
      branchId: searchParams.get("branchId") || undefined,
      type: searchParams.get("type") || undefined,
      city: searchParams.get("city") || undefined,
      search: searchParams.get("search") || undefined,
    });

    return NextResponse.json({ properties });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:write");

    const body = await req.json();
    const parsed = createPropertySchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid property creation payload.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const property = createProperty(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ property }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
