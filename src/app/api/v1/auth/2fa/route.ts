import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAuth } from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import {
  disableTwoFactor,
  setupTwoFactor,
  verifyAndEnableTwoFactor,
} from "@/server/modules/auth/auth.service";

const actionSchema = z.object({
  action: z.enum(["setup", "verify", "disable"]),
  code: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const ctx = requireAuth(req);
    const body = await req.json();
    const parsed = actionSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid 2FA action payload." } },
        { status: 400 }
      );
    }

    if (parsed.data.action === "setup") {
      const setup = setupTwoFactor(ctx.sub, ctx.organizationId);
      return NextResponse.json(setup);
    }

    if (parsed.data.action === "verify") {
      if (!parsed.data.code) {
        return NextResponse.json(
          { error: { code: "MISSING_CODE", message: "6-digit verification code is required." } },
          { status: 400 }
        );
      }
      const verified = verifyAndEnableTwoFactor(ctx.sub, ctx.organizationId, parsed.data.code);
      return NextResponse.json(verified);
    }

    const disabled = disableTwoFactor(ctx.sub, ctx.organizationId);
    return NextResponse.json(disabled);
  } catch (err) {
    return handleApiError(err);
  }
}
