import { NextRequest, NextResponse } from "next/server";
import { requireAuth, requirePermission } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { z } from "zod";
import { valid } from "@/server/modules/shared/domain";
import {
  ticketDetail,
  triageTicket,
  assignWorkOrder,
  updateWorkOrder,
  confirmTicket,
} from "@/server/modules/maintenance/maintenance.service";
type Params = { params: Promise<{ id: string }> };
export async function GET(req: NextRequest, { params }: Params) {
  try {
    return NextResponse.json(ticketDetail(requireAuth(req), (await params).id));
  } catch (e) {
    return handleApiError(e);
  }
}
export async function PATCH(req: NextRequest, { params }: Params) {
  try {
    const ctx = requireAuth(req),
      { id } = await params;
    const { action, data } = valid(
      z.object({
        action: z.enum(["triage", "assign", "work_order", "confirm"]),
        data: z.unknown(),
      }),
      await req.json(),
    );
    const result =
      action === "triage"
        ? triageTicket(ctx, id, data)
        : action === "assign"
          ? assignWorkOrder(ctx, id, data)
          : action === "work_order"
            ? updateWorkOrder(ctx, id, data)
            : confirmTicket(ctx, id, data);
    return NextResponse.json(result);
  } catch (e) {
    return handleApiError(e);
  }
}
