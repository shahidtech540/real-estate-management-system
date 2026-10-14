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
  fullName: z.string().min(2),
  phone: z.string().min(6),
  email: z.string().email().optional().or(z.literal("")),
  source: z.enum(VALID_LEAD_SOURCES).optional(),
  budgetMinor: z.number().min(0).optional(),
  requirementsText: z.string().optional(),
});

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
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
