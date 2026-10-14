import {publicOrganizationId} from "@/server/modules/shared/public-organization";
import {mutationOrigin,rateLimit,readJson} from "@/server/security/request";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { handleApiError } from "@/server/auth/http";
import {
  capturePublicLead,
  VALID_LEAD_SOURCES,
} from "@/server/modules/crm/crm.service";

const publicLeadSchema = z.object({
  listingId: z.string().optional(),
  listingSlug: z.string().optional(),
  fullName: z.string().min(2).max(160),
  phone: z.string().min(6).max(32),
  email: z.string().email().optional().or(z.literal("")),
  source: z.enum(VALID_LEAD_SOURCES).optional(),
  budgetMinor: z.number().min(0).optional(),
  requirementsText: z.string().max(2000).optional(),
});

export async function POST(req: NextRequest) {
  try {
    mutationOrigin(req);rateLimit("public-leads:"+publicOrganizationId(),100);
    const body = await readJson(req);
    const parsed = publicLeadSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Please provide your full name and phone number.",
            details: parsed.error.flatten(),
          },
        },
        { status: 400 }
      );
    }

    const lead = capturePublicLead({
      ...parsed.data,
      email: parsed.data.email || undefined,
    });

    return NextResponse.json({ lead }, { status: 201 });
  } catch (err) {
    return handleApiError(err);
  }
}
