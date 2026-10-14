import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { extractAuthContext, requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  createListing,
  listListings,
  updateListingStatus,
  VALID_LISTING_PURPOSES,
  VALID_LISTING_STATUSES,
} from "@/server/modules/listings/listings.service";

const createListingSchema = z.object({
  propertyId: z.string().min(1),
  unitId: z.string().min(1),
  titleEn: z.string().min(3),
  titleUr: z.string().optional(),
  descriptionEn: z.string().min(5),
  descriptionUr: z.string().optional(),
  purpose: z.enum(VALID_LISTING_PURPOSES),
  askingPriceMinor: z.number().positive(),
  status: z.enum(VALID_LISTING_STATUSES).optional(),
  syndicatePortals: z.boolean().optional(),
});

const updateListingSchema = z.object({
  listingId: z.string().min(1),
  status: z.enum(VALID_LISTING_STATUSES).optional(),
  askingPriceMinor: z.number().positive().optional(),
  syndicatePortals: z.boolean().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const isPublic = searchParams.get("public") === "true";
    const ctx = extractAuthContext(req);

    if (!isPublic) {
      const authCtx = requireAuth(req);
      requirePermission(authCtx, "listings:read");
    }

    const listings = listListings({
      organizationId: ctx?.organizationId || "org_pakland",
      onlyPublished: isPublic,
      purpose: searchParams.get("purpose") || undefined,
      status: searchParams.get("status") || undefined,
      city: searchParams.get("city") || undefined,
      unitType: searchParams.get("unitType") || undefined,
      minPriceMinor: searchParams.get("minPriceMinor")
        ? Number(searchParams.get("minPriceMinor"))
        : undefined,
      maxPriceMinor: searchParams.get("maxPriceMinor")
        ? Number(searchParams.get("maxPriceMinor"))
        : undefined,
      minAreaSqft: searchParams.get("minAreaSqft")
        ? Number(searchParams.get("minAreaSqft"))
        : undefined,
      minBedrooms: searchParams.get("minBedrooms")
        ? Number(searchParams.get("minBedrooms"))
        : undefined,
      search: searchParams.get("search") || undefined,
    });

    return NextResponse.json({ listings });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "listings:write");

    const body = await req.json();
    const parsed = createListingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid listing creation payload.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const listing = createListing(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ listing }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "listings:write");

    const body = await req.json();
    const parsed = updateListingSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid listing update payload." } },
        { status: 400 }
      );
    }

    const listing = updateListingStatus(
      ctx.organizationId,
      ctx.sub,
      parsed.data.listingId,
      {
        status: parsed.data.status,
        askingPriceMinor: parsed.data.askingPriceMinor,
        syndicatePortals: parsed.data.syndicatePortals,
      }
    );

    return NextResponse.json({ listing });
  } catch (err) {
    return handleApiError(err);
  }
}
