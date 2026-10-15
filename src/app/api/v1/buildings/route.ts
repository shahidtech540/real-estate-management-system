import {canReadProperty} from "@/server/modules/shared/access";
import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { createBuilding, listBuildings } from "@/server/modules/portfolio/portfolio.service";

const createBuildingSchema = z.object({
  propertyId: z.string().min(1),
  code: z.string().min(1),
  name: z.string().min(2),
  floors: z.number().int().min(1).optional(),
  blockSector: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:read");

    const { searchParams } = new URL(req.url);
    const propertyId = searchParams.get("propertyId") || undefined;
    const buildings = listBuildings(ctx.organizationId, propertyId);
    return NextResponse.json({buildings:buildings.filter(b=>canReadProperty(ctx,String(b.propertyId)))});
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:write");

    const body = await readJson(req);
    const parsed = createBuildingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid building payload." } },
        { status: 400 }
      );
    }

    const building = createBuilding(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ building }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
