import {publicOrganizationId} from "@/server/modules/shared/public-organization";
import { NextRequest, NextResponse } from "next/server";
import { extractAuthContext } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { exportSyndicationFeed } from "@/server/modules/listings/listings.service";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const format = searchParams.get("format") === "csv" ? "csv" : "json";
    const ctx = extractAuthContext(req);
    const organizationId = ctx?.organizationId || publicOrganizationId();

    const feed = exportSyndicationFeed(organizationId, format);
    return new NextResponse(feed.body, {
      status: 200,
      headers: {
        "Content-Type": feed.contentType,
        "X-Syndication-Count": String(feed.count),
      },
    });
  } catch (err) {
    return handleApiError(err);
  }
}
