import { NextRequest, NextResponse } from "next/server";
import { extractAuthContext } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { getListingBySlugOrId } from "@/server/modules/listings/listings.service";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await context.params;
    const ctx = extractAuthContext(req);
    const listing = getListingBySlugOrId(slug, ctx?.organizationId);
    return NextResponse.json({ listing });
  } catch (err) {
    return handleApiError(err);
  }
}
