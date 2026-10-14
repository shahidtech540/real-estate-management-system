import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { importUnitsFromCsv } from "@/server/modules/portfolio/portfolio.service";

const csvImportSchema = z.object({
  csvText: z.string().min(1),
  dryRun: z.boolean().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "properties:write");

    const body = await req.json();
    const parsed = csvImportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "CSV text payload is required." } },
        { status: 400 }
      );
    }

    const report = importUnitsFromCsv({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      csvText: parsed.data.csvText,
      dryRun: parsed.data.dryRun,
    });

    return NextResponse.json({ report });
  } catch (err) {
    return handleApiError(err);
  }
}
