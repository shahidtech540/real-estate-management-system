import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  ExpiryStatus,
  listDocuments,
  uploadDocument,
} from "@/server/modules/documents/documents.service";

const uploadDocSchema = z.object({
  entityType: z.enum(["property", "unit", "owner", "tenant", "lease", "organization"]),
  entityId: z.string().min(1),
  title: z.string().min(2),
  category: z.string().min(2),
  mimeType: z.string().optional(),
  sizeBytes: z.number().int().positive().optional(),
  tags: z.array(z.string()).optional(),
  expiryDate: z.string().nullable().optional(),
  contentText: z.string().optional(),
});

export async function GET(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "documents:read");

    const { searchParams } = new URL(req.url);
    const expiryStatus = (searchParams.get("expiryStatus") as ExpiryStatus) || undefined;
    const documents = listDocuments({
      organizationId: ctx.organizationId,
      entityType: searchParams.get("entityType") || undefined,
      entityId: searchParams.get("entityId") || undefined,
      category: searchParams.get("category") || undefined,
      search: searchParams.get("search") || undefined,
      expiryStatus,
    });

    return NextResponse.json({ documents });
  } catch (err) {
    return handleApiError(err);
  }
}

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "documents:write");

    const body = await req.json();
    const parsed = uploadDocSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid document upload payload.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const document = uploadDocument(ctx.organizationId, ctx.sub, parsed.data);
    return NextResponse.json({ document }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
