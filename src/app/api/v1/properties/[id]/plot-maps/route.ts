import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { rateLimit, readJson } from "@/server/security/request";
import { readSvgUpload } from "@/server/modules/plot-maps/svg";
import {
  authorizeMapUpload,
  listMaps,
  mapSettings,
  uploadMap,
} from "@/server/modules/plot-maps/plot-maps.service";
type Context = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, c: Context) {
  try {
    return NextResponse.json(listMaps(requireAuth(req), (await c.params).id));
  } catch (e) {
    return handleApiError(e);
  }
}
export async function POST(req: NextRequest, c: Context) {
  try {
    const { id } = await c.params,
      ctx = authorizeMapUpload(requireAuth(req), id);
    rateLimit(`plot-map-upload:${ctx.organizationId}:${ctx.sub}`, 20);
    return NextResponse.json(uploadMap(ctx, id, await readSvgUpload(req)), {
      status: 201,
    });
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest, c: Context) {
  try {
    const { id } = await c.params,
      ctx = authorizeMapUpload(requireAuth(req), id);
    return NextResponse.json(mapSettings(ctx, id, await readJson(req)));
  } catch (e) {
    return handleApiError(e);
  }
}
