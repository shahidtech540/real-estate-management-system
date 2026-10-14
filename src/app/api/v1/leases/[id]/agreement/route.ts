import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  requirePermission,
  HttpError,
} from "@/server/auth/guards";
import { handleApiError } from "@/server/auth/http";
import { assertReadable } from "@/server/modules/shared/access";
import { pdfResponse } from "@/server/modules/shared/pdf";
import {
  generateLeaseAgreementDocument,
  listLeases,
} from "@/server/modules/leases/leases.service";
import { recordAuditLog } from "@/server/modules/audit/audit.service";
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = requireAuth(req);
    requirePermission(ctx, "leases:read");
    const { id } = await params;
    const lease = listLeases({ organizationId: ctx.organizationId }).find(
      (l) => l.id === id,
    );
    if (!lease) throw new HttpError(404, "NOT_FOUND", "Lease not found.");
    assertReadable(ctx, lease.propertyId, lease.tenantId);
    const agreement = generateLeaseAgreementDocument(ctx.organizationId, id);
    recordAuditLog({
      organizationId: ctx.organizationId,
      actorUserId: ctx.sub,
      action: "lease.agreement_downloaded",
      entityType: "lease",
      entityId: id,
    });
    if (req.nextUrl.searchParams.get("format") === "json")
      return NextResponse.json(agreement);
    return pdfResponse(
      agreement.title,
      [
        ...agreement.contractText.split("\n"),
        "Terms: Tenant shall use the premises for the agreed purpose only, maintain the premises, and pay utilities and rent by the due date. Subletting requires written landlord consent. Alterations require written approval.",
        "Landlord shall provide peaceful possession subject to compliance with this agreement. Parties shall comply with applicable Pakistani tenancy laws. Disputes are subject to the competent local court or rent authority.",
        "Termination and renewal require written agreement and settlement of outstanding rent, utilities, and damages. Security deposit settlements are recorded separately from rent payments.",
        "This is an unsigned draft template until executed by both parties. Electronic signature integration is not enabled.",
        "Landlord signature: __________________ Date: __________",
        "Tenant signature: ____________________ Date: __________",
        "Witness name / CNIC / signature: __________________________",
      ],
      `${lease.leaseNumber}.pdf`,
    );
  } catch (e) {
    return handleApiError(e);
  }
}
