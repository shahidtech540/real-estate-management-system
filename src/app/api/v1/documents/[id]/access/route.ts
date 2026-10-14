import {getDb} from "@/server/db";
import {canReadDocument} from "@/server/modules/shared/access";
import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission,HttpError } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { recordDocumentAccess } from "@/server/modules/documents/documents.service";

const accessSchema = z.object({
  accessType: z.enum(["view", "download"]).default("view"),
});

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "documents:read");

    const { id } = await context.params;
    const doc=getDb().prepare("SELECT entity_type,entity_id FROM documents WHERE organization_id=? AND id=? AND deleted_at IS NULL").get(ctx.organizationId,id);
    if(!doc||!canReadDocument(ctx,String(doc.entity_type),String(doc.entity_id)))throw new HttpError(404,"NOT_FOUND","Document not found.");
    let accessType: "view" | "download" = "view";
    try {
      const body = await readJson(req);
      const parsed = accessSchema.safeParse(body);
      if (parsed.success) {
        accessType = parsed.data.accessType;
      }
    } catch {
      // default to view
    }

    const ipAddress =
      req.headers.get("x-forwarded-for") || req.headers.get("x-real-ip") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "REMS-Browser";

    const accessRecord = recordDocumentAccess({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      documentId: id,
      accessType,
      ipAddress,
      userAgent,
    });

    return NextResponse.json({ access: accessRecord });
  } catch (err) {
    return handleApiError(err);
  }
}
