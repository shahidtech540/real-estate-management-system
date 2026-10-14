import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/server/auth/guards";
import { attachAuthCookies, handleApiError } from "@/server/auth/http";
import { switchUserContext } from "@/server/modules/auth/auth.service";

const contextSchema = z.object({
  branchId: z.string().optional(),
  locale: z.enum(["en", "ur"]).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    const body = await req.json();
    const parsed = contextSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid context payload." } },
        { status: 400 }
      );
    }

    const updated = switchUserContext({
      userId: ctx.sub,
      organizationId: ctx.organizationId,
      branchId: parsed.data.branchId,
      locale: parsed.data.locale,
    });

    const res = NextResponse.json(updated);
    attachAuthCookies(res, { accessToken: updated.accessToken });
    return res;
  } catch (err) {
    return handleApiError(err);
  }
}
