import {readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { recordDeposit } from "@/server/modules/leases/leases.service";
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "payments:write");
    const { id } = await params;
    return NextResponse.json(
      {
        events: recordDeposit(
          ctx.organizationId,
          ctx.sub,
          id,
          await readJson(req),
        ),
      },
      { status: 201 },
    );
  } catch (e) {
    return handleApiError(e);
  }
}
