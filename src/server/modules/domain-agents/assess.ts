import type { JwtPayload } from "@/server/auth/crypto";
import { canReadProperty } from "../shared/access";
import { HttpError } from "@/server/auth/guards";
import { getDb } from "@/server/db";
import { nowIso, today, valid, sourceDate, dateSchema } from "../shared/domain";
import { calculateLeadScore } from "../crm/crm.service";
import {
  defaultFilter,
  financialReport,
  sumMinor,
} from "../accounting/reports.service";
import {
  schemas,
  type AgentKind,
  type Assessment,
  type Proposal,
} from "./contracts";
import {
  fingerprint,
  getEntity,
  citation,
  safeText,
  requireDomain,
  untrustedWarning,
  documentPermission,
  insightsMode,
  futureSlot,
  type Row,
} from "./safety";
import {
  classifyMaintenance,
  installmentPlan,
  escalatedRent,
  retrievalScore,
  extractLeaseTerms,
} from "./rules";
import { actionSnapshot, listingCopy } from "./actions";
function draftProposal(
  ctx: JwtPayload,
  tool: string,
  input: Record<string, unknown>,
  title: string,
): Proposal {
  return {
    id: fingerprint({ tool, input }).slice(0, 24),
    title,
    tool,
    input,
    expectedSourceHash: fingerprint(actionSnapshot(ctx, tool, input)),
    requiresApproval: true,
  };
}
function sourceWarning(result: Assessment, text: unknown) {
  if (untrustedWarning(String(text)))
    result.warnings.push(
      "Instruction-like source text was treated as untrusted data, never as tool instructions.",
    );
}
function positiveMoney(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < 0 || n > 1e12)
    throw new HttpError(
      422,
      "BAD_SOURCE",
      "Source price/balance is outside exact supported paisa range.",
    );
  return n;
}
function project(ctx: JwtPayload, id: unknown) {
  const p = getDb()
    .prepare(
      "SELECT * FROM properties WHERE organization_id=? AND id=? AND deleted_at IS NULL",
    )
    .get(ctx.organizationId, String(id));
  if (!p || !canReadProperty(ctx, String(p.id)))
    throw new HttpError(404, "NOT_FOUND", "Project not found.");
  return p;
}
export function assessDomain(
  ctx: JwtPayload,
  kind: AgentKind,
  input: unknown,
): Assessment {
  const b = valid(schemas[kind], input);
  requireDomain(ctx, kind, b);
  const db = getDb(),
    org = ctx.organizationId,
    date = today(),
    result: Assessment = {
      kind,
      engine: "local-domain-v1",
      version: "1",
      generatedAt: nowIso(),
      asOf: date,
      summary: "",
      summaryUr: "",
      findings: {},
      citations: [],
      warnings: [
        "Local rules/retrieval, not live-model output. Stored demo inventory, prices and ownership are not independently verified.",
      ],
      proposals: [],
    };
  if (kind === "lead") {
    const q = valid(schemas.lead, b),
      lead = getEntity(ctx, "leads", q.leadId),
      budget = positiveMoney(lead.budget_minor),
      closed = ["won", "lost"].includes(String(lead.stage));
    sourceWarning(result, lead.requirements_text);
    sourceWarning(result, lead.full_name);
    const price =
      q.intent === "rent" ? "monthly_rent_minor" : "market_price_minor";
    const units = db
      .prepare(
        `SELECT u.*,p.name AS project_name,p.city FROM units u JOIN properties p ON p.id=u.property_id AND p.organization_id=u.organization_id WHERE u.organization_id=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL AND u.status='available' ${q.unitType ? "AND u.type=?" : ""} ${q.minBedrooms !== undefined ? "AND u.bedrooms>=?" : ""} AND u.${price}>0 ${budget ? "AND u." + price + "<=?" : ""} ORDER BY u.${price} DESC,u.id LIMIT 5`,
      )
      .all(
        org,
        ...(q.unitType ? [q.unitType] : []),
        ...(q.minBedrooms !== undefined ? [q.minBedrooms] : []),
        ...(budget ? [budget] : []),
      )
      .filter((u) => canReadProperty(ctx, String(u.property_id)));
    const score = calculateLeadScore({
      source: lead.source as Parameters<typeof calculateLeadScore>[0]["source"],
      stage: lead.stage as Parameters<typeof calculateLeadScore>[0]["stage"],
      budgetMinor: budget,
      hasEmail: !!lead.email,
      hasListing: !!lead.listing_id,
    });
    result.summary = closed
      ? "Lead already closed; no follow-up change proposed."
      : `${score}/100 recorded-field qualification score; ${units.length} available candidate units. Budget ${budget ? "provided" : "unknown"}.`;
    result.summaryUr = closed
      ? "رابطہ پہلے ہی بند ہے؛ کوئی تبدیلی تجویز نہیں ہوئی۔"
      : `درج معلومات کا اہلیت اسکور ${score}/100؛ ${units.length} دستیاب یونٹ۔`;
    result.findings = {
      leadId: lead.id,
      stage: lead.stage,
      score,
      budgetMinor: budget,
      intent: q.intent,
      missingFields: [
        ...(!budget ? ["budget"] : []),
        "preferred viewing time / timeline confirmation",
      ],
      matches: units.map((u) => ({
        id: u.id,
        propertyId: u.property_id,
        project: safeText(u.project_name),
        unitNumber: safeText(u.unit_number),
        type: u.type,
        bedrooms: u.bedrooms,
        priceMinor: positiveMoney(u[price]),
        affordabilityKnown: !!budget,
      })),
      responseDraft: {
        en: "Thank you for your enquiry. Please confirm your budget, property type and preferred viewing time. Availability and legal/ownership documents must be verified with the office before commitment.",
        ur: "آپ کی دلچسپی کا شکریہ۔ براہ کرم بجٹ، پراپرٹی کی قسم اور ملاقات کا مناسب وقت بتائیں۔ کسی وعدے سے پہلے دفتر سے دستیابی، ملکیت اور قانونی دستاویزات کی تصدیق ضروری ہے۔",
      },
      externalMessageSent: false,
    };
    result.citations = [
      citation("lead", lead, "source, stage, budget_minor, email, listing_id"),
      ...units.map((u) =>
        citation("unit", u, `status, type, bedrooms, ${price}`),
      ),
    ];
    if (!closed && ["new", "contacted"].includes(String(lead.stage))) {
      const stage = "contacted";
      result.proposals.push(
        draftProposal(
          ctx,
          "crm.qualify",
          {
            leadId: q.leadId,
            stage,
            note: `Local recorded-field qualification score ${score}/100; budget ${budget ? "provided" : "needs confirmation"}. Inventory and timeline require human verification.`,
          },
          "Save qualification note/stage after independent review",
        ),
      );
    }
    if (q.viewingAt && !closed && units.length) {
      futureSlot(q.viewingAt);
      const assigned = db
        .prepare(
          "SELECT u.id FROM users u JOIN roles r ON r.id=u.role_id AND r.organization_id=u.organization_id WHERE u.organization_id=? AND u.id=? AND u.status='active' AND u.deleted_at IS NULL AND r.slug='agent'",
        )
        .get(org, String(lead.assigned_agent_id));
      if (assigned)
        result.proposals.push(
          draftProposal(
            ctx,
            "crm.viewing",
            {
              leadId: q.leadId,
              unitId: String(units[0].id),
              agentId: String(assigned.id),
              scheduledAt: q.viewingAt,
            },
            "Schedule the explicitly supplied viewing time after review",
          ),
        );
      else
        result.warnings.push(
          "No active assigned sales agent; viewing was not scheduled.",
        );
    }
    return result;
  }
  if (kind === "listing") {
    const q = valid(schemas.listing, b),
      unit = getEntity(ctx, "units", q.unitId),
      p = project(ctx, unit.property_id),
      column =
        q.purpose === "rent" ? "monthly_rent_minor" : "market_price_minor",
      price = positiveMoney(unit[column]);
    sourceWarning(result, `${p.name} ${unit.unit_number}`);
    const comps = db
      .prepare(
        `SELECT u.id,u.property_id,u.${column} AS price,u.area_sqft,u.updated_at FROM units u JOIN properties p ON p.id=u.property_id AND p.organization_id=u.organization_id WHERE u.organization_id=? AND u.id<>? AND u.type=? AND p.city=? AND u.deleted_at IS NULL AND p.deleted_at IS NULL AND u.${column}>0 AND u.area_sqft BETWEEN ? AND ? ORDER BY u.${column},u.id LIMIT 200`,
      )
      .all(
        org,
        q.unitId,
        String(unit.type),
        String(p.city),
        Number(unit.area_sqft) * 0.75,
        Number(unit.area_sqft) * 1.25,
      )
      .filter((u) => canReadProperty(ctx, String(u.property_id)));
    const prices = comps.map((c) => positiveMoney(c.price));
    const median =
      prices.length >= 3
        ? Number(
            (BigInt(prices[Math.floor((prices.length - 1) / 2)]) +
              BigInt(prices[Math.floor(prices.length / 2)]) +
              1n) /
              2n,
          )
        : null;
    let photos: unknown = [];
    try {
      photos = JSON.parse(String(unit.photos_json || "[]"));
    } catch {
      result.warnings.push("Invalid stored photo metadata; no photos assumed.");
    }
    const copy = listingCopy(unit, p, q.purpose, price),
      existing = db
        .prepare(
          "SELECT id,status,asking_price_minor,updated_at FROM listings WHERE organization_id=? AND unit_id=? AND purpose=? AND deleted_at IS NULL ORDER BY updated_at DESC LIMIT 20",
        )
        .all(org, q.unitId, q.purpose);
    const stale = existing.filter(
      (l) => Date.parse(String(l.updated_at)) < Date.now() - 30 * 86400000,
    );
    result.summary = `Bilingual draft based on recorded unit fields. ${comps.length} comparable stored asking prices; ${stale.length} listings older than 30 days. Not an appraisal.`;
    result.summaryUr =
      "درج یونٹ کی معلومات سے دو لسانی مسودہ؛ یہ مارکیٹ کی تصدیق شدہ قیمت یا قانونی منظوری نہیں۔";
    result.findings = {
      unitId: q.unitId,
      availability: unit.status,
      purpose: q.purpose,
      storedPriceMinor: price,
      copy,
      pricing: {
        method:
          "Same stored city/type; area ±25%; recorded unit asking prices only, max 200",
        sampleCount: comps.length,
        medianMinor: median,
        lowerQuartileMinor:
          prices.length >= 3 ? prices[Math.floor(prices.length * 0.25)] : null,
        upperQuartileMinor:
          prices.length >= 3
            ? prices[Math.floor((prices.length - 1) * 0.75)]
            : null,
        confidence: median
          ? "low — unverified asking comparables"
          : "insufficient evidence",
      },
      quality: {
        staleListingIds: stale.map((l) => l.id),
        missingPhotos: !Array.isArray(photos) || photos.length === 0,
        approvalVerified: false,
      },
      externalPublication: false,
    };
    result.citations = [
      citation("unit", unit, `type, area_sqft, bedrooms, ${column}, status`),
      citation("property", p, "name, city"),
      ...comps.slice(0, 10).map((c) => citation("unit", c, column)),
    ];
    if (!median)
      result.warnings.push(
        "Fewer than three comparable asking records; no market price recommendation.",
      );
    if (
      unit.status === "available" &&
      price > 0 &&
      !existing.some((l) => l.status === "draft")
    )
      result.proposals.push(
        draftProposal(
          ctx,
          "listings.draft",
          { unitId: q.unitId, purpose: q.purpose, askingPriceMinor: price },
          "Save private, unsyndicated listing draft at the recorded price",
        ),
      );
    else
      result.warnings.push(
        "Unavailable unit, unknown price or existing draft: no new draft action.",
      );
    return result;
  }
  if (kind === "rent") {
    const q = valid(schemas.rent, b),
      invoice = getEntity(ctx, "invoices", q.invoiceId),
      lease = getEntity(ctx, "leases", String(invoice.lease_id));
    const payments = db
      .prepare(
        "SELECT id,amount_minor,reference_number,paid_at,updated_at FROM payments WHERE organization_id=? AND invoice_id=? AND status='completed' AND deleted_at IS NULL ORDER BY paid_at,id",
      )
      .all(org, q.invoiceId);
    positiveMoney(invoice.total_minor);
    positiveMoney(invoice.paid_minor);
    const recorded = sumMinor(payments.map((p) => Number(p.amount_minor))),
      gap = Number(invoice.paid_minor) - recorded,
      outstanding = Number(invoice.total_minor) - Number(invoice.paid_minor),
      days = Math.max(
        0,
        Math.floor(
          (Date.parse(date) - Date.parse(String(invoice.due_date))) / 86400000,
        ),
      );
    const stage =
      outstanding < 0
        ? "source_mismatch"
        : outstanding === 0
          ? "settled"
          : days === 0
            ? "not_overdue"
            : days <= Number(lease.grace_days)
              ? "within_grace"
              : days <= 30
                ? "courtesy_reminder"
                : days <= 60
                  ? "human_payment_plan"
                  : days <= 90
                    ? "manager_review"
                    : "human_legal_review_only";
    result.summary = `${safeText(invoice.invoice_number)}: outstanding PKR ${(outstanding / 100).toFixed(2)}, ${days} days overdue. ${gap > 0 ? "Legacy settlement evidence is incomplete." : "Recorded receipts checked."}`;
    result.summaryUr = `درج بقایا ${(outstanding / 100).toFixed(2)} پاکستانی روپے؛ آخری تاریخ سے ${days} دن۔ قانونی کارروائی خودکار نہیں۔`;
    result.findings = {
      invoiceId: q.invoiceId,
      outstandingMinor: outstanding,
      daysOverdue: days,
      stage,
      graceDays: Number(lease.grace_days),
      recordedReceiptsMinor: recorded,
      invoiceSettledMinor: Number(invoice.paid_minor),
      legacyGapMinor: gap,
      reconciliationStatus:
        gap > 0
          ? "legacy_evidence_missing"
          : gap < 0
            ? "source_mismatch"
            : "recorded_receipts_match",
      installmentProposal: {
        amountsMinor:
          outstanding > 0 ? installmentPlan(outstanding, q.installments) : [],
        binding: false,
        datesAgreed: false,
      },
      reminderDraft: {
        en: `Please review invoice ${safeText(invoice.invoice_number)}. Recorded outstanding PKR ${(outstanding / 100).toFixed(2)}. Contact the office if a verified payment is missing. Courtesy reminder, not a legal notice.`,
        ur: `بل ${safeText(invoice.invoice_number)} کا جائزہ لیں۔ درج بقایا ${(outstanding / 100).toFixed(2)} پاکستانی روپے۔ تصدیق شدہ ادائیگی درج نہ ہو تو دفتر سے رابطہ کریں۔ یہ قانونی نوٹس نہیں۔`,
      },
      externalMessageSent: false,
    };
    result.citations = [
      citation("invoice", invoice, "total_minor, paid_minor, due_date, status"),
      citation("lease", lease, "grace_days"),
      ...payments
        .slice(0, 10)
        .map((p) => citation("payment", p, "amount_minor, paid_at")),
    ];
    if (gap !== 0)
      result.warnings.push(
        "No cash receipt is fabricated; missing/mismatched evidence requires accountant investigation.",
      );
    if (outstanding > 0 && invoice.status !== "cancelled" && gap >= 0) {
      const user = db
        .prepare(
          "SELECT u.id FROM tenants t JOIN users u ON u.id=t.user_id AND u.organization_id=t.organization_id WHERE t.organization_id=? AND t.id=? AND t.deleted_at IS NULL AND u.status='active' AND u.deleted_at IS NULL",
        )
        .get(org, String(invoice.tenant_id));
      if (user)
        result.proposals.push(
          draftProposal(
            ctx,
            "rent.reminder",
            { invoiceId: q.invoiceId },
            "Deliver one approved courtesy reminder to the linked tenant inbox",
          ),
        );
      else
        result.warnings.push(
          "No active linked tenant inbox. Draft only; no outbound delivery.",
        );
    }
    return result;
  }
  if (kind === "maintenance") {
    const q = valid(schemas.maintenance, b),
      ticket = getEntity(ctx, "maintenance_tickets", q.ticketId),
      text = `${ticket.title} ${ticket.description}`,
      risk = classifyMaintenance(text, String(ticket.priority));
    sourceWarning(result, text);
    const vendors = /gas|گیس/i.test(text)
      ? []
      : db
          .prepare(
            "SELECT id,name,trade_category,rating,base_rate_minor,sla_hours,available,updated_at FROM vendors WHERE organization_id=? AND deleted_at IS NULL AND available=1 AND trade_category=? ORDER BY sla_hours,rating DESC,base_rate_minor,id LIMIT 5",
          )
          .all(org, risk.category);
    if (/gas|گیس/i.test(text))
      result.warnings.push(
        "No verified gas specialist is configured; no generic vendor was recommended or contacted.",
      );
    const breached =
      Date.parse(String(ticket.sla_due_at)) < Date.now() &&
      !["closed", "cancelled"].includes(String(ticket.status));
    result.summary = `Advisory ${risk.category} / ${risk.priority}; ${breached ? "SLA overdue" : "recorded SLA not overdue"}. ${risk.advice}`;
    result.summaryUr = risk.emergency
      ? "ممکنہ ہنگامی خطرہ: دور رہیں، فوری مقامی ایمرجنسی خدمات اور دفتر سے رابطہ کریں۔ مرمت خود نہ کریں۔"
      : "مرمت کی درجہ بندی تجویز ہے؛ عملے کی جانچ اور منظوری ضروری ہے۔";
    result.findings = {
      ticketId: q.ticketId,
      classification: risk,
      recordedSlaDueAt: ticket.sla_due_at,
      slaBreached: breached,
      vendorRecommendations: vendors.map((v) => ({
        id: v.id,
        name: safeText(v.name),
        trade: v.trade_category,
        recordedRating: v.rating,
        recordedBaseRateMinor: v.base_rate_minor,
        slaHours: v.sla_hours,
        credentialsVerified: false,
      })),
      externalDispatch: false,
    };
    result.citations = [
      citation(
        "maintenance_ticket",
        ticket,
        "title, description, priority, status, sla_due_at",
      ),
      ...vendors.map((v) =>
        citation(
          "vendor",
          v,
          "trade_category, available, sla_hours, rating, base_rate_minor",
        ),
      ),
    ];
    if (["open", "triaged"].includes(String(ticket.status)))
      result.proposals.push(
        draftProposal(
          ctx,
          "maintenance.triage",
          {
            ticketId: q.ticketId,
            category: risk.category,
            priority: risk.priority,
            note: `Local safety rule classification: ${risk.category}/${risk.priority}. ${risk.advice}`,
          },
          "Apply coordinator triage after independent review",
        ),
      );
    if (
      q.scheduledAt &&
      ticket.status === "triaged" &&
      risk.category === ticket.category &&
      vendors.length &&
      !/gas|گیس/i.test(text)
    ) {
      futureSlot(q.scheduledAt);
      const input = {
        ticketId: q.ticketId,
        vendorId: String(vendors[0].id),
        scheduledAt: q.scheduledAt,
        estimatedCostMinor: Number(vendors[0].base_rate_minor),
      };
      result.proposals.push(
        draftProposal(
          ctx,
          "maintenance.assign",
          input,
          "Assign the supplied slot and recorded vendor estimate after review",
        ),
      );
    }
    if (risk.emergency)
      result.warnings.push(
        "Do not wait for agent approval to seek emergency help. No real emergency service or vendor has been contacted.",
      );
    return result;
  }
  if (kind === "lease") {
    const q = valid(schemas.lease, b),
      lease = getEntity(ctx, "leases", q.leaseId),
      days = Math.floor(
        (Date.parse(String(lease.end_date)) - Date.parse(date)) / 86400000,
      ),
      rent = positiveMoney(lease.rent_minor),
      renewal = escalatedRent(rent, Number(lease.escalation_pct));
    const window =
      days < 0
        ? "expired"
        : days <= 30
          ? "30_days"
          : days <= 60
            ? "60_days"
            : days <= 90
              ? "90_days"
              : "outside_window";
    const events = db
      .prepare(
        "SELECT id,type,payload_json,created_at FROM lease_events WHERE organization_id=? AND lease_id=? ORDER BY created_at,id",
      )
      .all(org, q.leaseId);
    const held = sumMinor(
      events
        .filter((e) =>
          ["deposit_received", "deposit_refunded"].includes(String(e.type)),
        )
        .map(
          (e) =>
            Number(JSON.parse(String(e.payload_json)).amountMinor) *
            (e.type === "deposit_received" ? 1 : -1),
        ),
    );
    const leaseInvoices = db
      .prepare(
        "SELECT id,total_minor,paid_minor,updated_at FROM invoices WHERE organization_id=? AND lease_id=? AND deleted_at IS NULL AND status!='cancelled' ORDER BY id",
      )
      .all(org, q.leaseId);
    const arrears = sumMinor(
      leaseInvoices.map((i) => Number(i.total_minor) - Number(i.paid_minor)),
    );
    const checklists = db
      .prepare(
        "SELECT id,kind,created_at FROM lease_checklists WHERE organization_id=? AND lease_id=? ORDER BY created_at",
      )
      .all(org, q.leaseId);
    let extraction: unknown = null;
    if (q.documentId) {
      const doc = db
        .prepare(
          "SELECT * FROM documents WHERE organization_id=? AND id=? AND deleted_at IS NULL",
        )
        .get(org, q.documentId);
      if (
        !doc ||
        !documentPermission(ctx, doc) ||
        doc.entity_type !== "lease" ||
        doc.entity_id !== q.leaseId
      )
        throw new HttpError(
          404,
          "NOT_FOUND",
          "Authorized lease document not found.",
        );
      sourceWarning(result, doc.content_text);
      const extracted = extractLeaseTerms(
        String(doc.content_text || "").slice(0, 32000),
      );
      for (const d of [extracted.startDate, extracted.endDate])
        if (
          d &&
          (!dateSchema.safeParse(d).success ||
            (!!extracted.startDate &&
              !!extracted.endDate &&
              extracted.endDate < extracted.startDate))
        ) {
          extracted.startDate = null;
          extracted.endDate = null;
        }
      extraction = {
        documentId: doc.id,
        version: doc.version,
        method:
          "anchored stored-text extraction, not OCR or PDF binary extraction",
        terms: extracted,
        matchesRecordedLease: {
          rent: extracted.rentMinor === rent,
          deposit: extracted.depositMinor === Number(lease.deposit_minor),
          start: extracted.startDate === lease.start_date,
          end: extracted.endDate === lease.end_date,
        },
        needsHumanVerification: true,
      };
      result.citations.push(
        citation("document", doc, "content_text (untrusted stored text)"),
      );
      if (Object.values(extracted).some((v) => v === null))
        result.warnings.push(
          "Missing or ambiguous text fields were withheld. Scanned/binary-only PDFs need verified text/OCR; no terms invented.",
        );
    }
    result.summary = `${safeText(lease.lease_number)}: ${days} days to recorded expiry (${window}). Proposed escalated rent PKR ${(renewal / 100).toFixed(2)} is unsigned and nonbinding.`;
    result.summaryUr = `درج معاہدے کی آخری تاریخ میں ${days} دن۔ مجوزہ کرایہ ${(renewal / 100).toFixed(2)} پاکستانی روپے؛ پیشکش غیر دستخط شدہ اور غیر پابند ہے۔`;
    result.findings = {
      leaseId: q.leaseId,
      status: lease.status,
      daysUntilExpiry: days,
      renewalWindow: window,
      currentRentMinor: rent,
      escalationPct: lease.escalation_pct,
      offer: {
        rentMinor: renewal,
        newEndDate: q.newEndDate || null,
        binding: false,
        changesExistingLease: false,
      },
      extraction,
      moveOut: {
        agreedDepositMinor: Number(lease.deposit_minor),
        recordedDepositHeldMinor: held,
        outstandingInvoicesMinor: arrears,
        moveInChecklistPresent: checklists.some((c) => c.kind === "move_in"),
        moveOutChecklistPresent: checklists.some((c) => c.kind === "move_out"),
        refundRecommendation:
          "No automatic refund, damage deduction or lease termination. Confirm inspections and receipts.",
      },
    };
    result.citations.unshift(
      citation(
        "lease",
        lease,
        "start_date, end_date, rent_minor, deposit_minor, escalation_pct, status",
      ),
    );
    result.citations.push(
      ...leaseInvoices
        .slice(0, 10)
        .map((i) => citation("invoice", i, "total_minor, paid_minor")),
      ...checklists
        .slice(-10)
        .map((c) => citation("lease_checklist", c, "kind, created_at")),
      ...events
        .slice(-10)
        .map((e) => citation("lease_event", e, "type, payload_json")),
    );
    if (
      q.newEndDate &&
      ["active", "expiring", "renewed"].includes(String(lease.status)) &&
      days <= 90 &&
      days >= 0
    ) {
      if (q.newEndDate <= String(lease.end_date))
        throw new HttpError(
          400,
          "OFFER_DATE",
          "Offer end date must follow the existing lease end.",
        );
      result.proposals.push(
        draftProposal(
          ctx,
          "leases.offer",
          {
            leaseId: q.leaseId,
            newEndDate: q.newEndDate,
            offeredRentMinor: renewal,
          },
          "Save an unsigned offer draft only; existing lease remains unchanged",
        ),
      );
    }
    return result;
  }
  const q = valid(schemas.insights, b),
    mode = insightsMode(q.question);
  sourceWarning(result, q.question);
  if (q.propertyId) project(ctx, q.propertyId);
  result.findings = { mode, question: safeText(q.question, 500), answer: null };
  const where = q.propertyId ? "AND property_id=?" : "",
    args = [org, ...(q.propertyId ? [q.propertyId] : [])];
  if (mode === "finance") {
    const defaults = defaultFilter(),
      report = financialReport(ctx, {
        from: q.from || defaults.from,
        to: q.to || defaults.to,
        ...(q.propertyId ? { propertyId: q.propertyId } : {}),
      });
    result.findings = {
      mode,
      period: report.filter,
      incomeMinor: report.totals.incomeMinor,
      expenseMinor: report.totals.expenseMinor,
      profitMinor: report.totals.profitMinor,
      cashMovementMinor: report.totals.cashMovementMinor,
      legacyClearingMinor: report.totals.legacyClearingMinor,
      reconciliation: report.reconciliation,
      answer:
        "Accrual property operations only. Legacy clearing is not cash; recorded cash is not a verified bank balance.",
    };
    result.citations = [
      {
        entityType: "ledger_query",
        id: org,
        field: `org-scoped posted ledger aggregation ${JSON.stringify(report.filter)}`,
      },
    ];
    if (!report.reconciliation.fullyPosted)
      result.warnings.push(
        "Incomplete posting/reconciliation: financial figures must not be represented as fully reconciled.",
      );
  } else if (mode === "occupancy" || mode === "vacancy") {
    const units = db
        .prepare(
          `SELECT id,property_id,status,unit_number,vacant_since,updated_at FROM units WHERE organization_id=? AND deleted_at IS NULL ${where} ORDER BY id`,
        )
        .all(...args)
        .filter((u) => canReadProperty(ctx, String(u.property_id))),
      pool = units.filter((u) => u.status !== "sold"),
      occupied = units.filter((u) => u.status === "rented").length,
      vacant = units.filter((u) => u.status === "available");
    result.findings = {
      mode,
      asOf: date,
      totalUnits: units.length,
      rentalPoolUnits: pool.length,
      occupiedUnits: occupied,
      occupancyPct: pool.length
        ? Math.round((occupied / pool.length) * 10000) / 100
        : 0,
      vacancies: vacant.slice(0, 50).map((u) => ({
        unitId: u.id,
        unitNumber: safeText(u.unit_number),
        vacantSince: u.vacant_since,
        days: u.vacant_since
          ? Math.max(
              0,
              Math.floor(
                (Date.parse(date) -
                  Date.parse(sourceDate(String(u.vacant_since)))) /
                  86400000,
              ),
            )
          : null,
      })),
      answer:
        "Current physical inventory, excluding sold units from occupancy denominator. Historical vacancy dates are unknown where not recorded.",
    };
    result.citations = units
      .slice(0, 10)
      .map((u) => citation("unit", u, "status, vacant_since"));
  } else if (mode === "arrears") {
    const invoices = db
      .prepare(
        `SELECT id,property_id,tenant_id,total_minor,paid_minor,due_date,updated_at FROM invoices WHERE organization_id=? AND deleted_at IS NULL AND status!='cancelled' AND total_minor>paid_minor ${where} ORDER BY due_date,id`,
      )
      .all(...args)
      .filter((i) =>
        canReadProperty(ctx, String(i.property_id), String(i.tenant_id)),
      );
    result.findings = {
      mode,
      asOf: date,
      outstandingMinor: sumMinor(
        invoices.map((i) => Number(i.total_minor) - Number(i.paid_minor)),
      ),
      overdueCount: invoices.filter((i) => String(i.due_date) < date).length,
      answer:
        "Current invoice balances, not a historical reconstruction or legal notice.",
    };
    result.citations = invoices
      .slice(0, 10)
      .map((i) => citation("invoice", i, "total_minor, paid_minor, due_date"));
  } else if (mode === "maintenance") {
    const tickets = db
        .prepare(
          `SELECT id,property_id,tenant_id,status,sla_due_at,updated_at FROM maintenance_tickets WHERE organization_id=? AND deleted_at IS NULL ${where} ORDER BY id`,
        )
        .all(...args)
        .filter((t) =>
          canReadProperty(ctx, String(t.property_id), String(t.tenant_id)),
        ),
      open = tickets.filter(
        (t) => !["closed", "cancelled"].includes(String(t.status)),
      );
    result.findings = {
      mode,
      openCount: open.length,
      slaBreaches: open.filter(
        (t) => Date.parse(String(t.sla_due_at)) < Date.now(),
      ).length,
      answer:
        "Recorded current ticket state and deadline comparisons. No automated dispatch or diagnosis.",
    };
    result.citations = tickets
      .slice(0, 10)
      .map((t) => citation("maintenance_ticket", t, "status, sla_due_at"));
  } else {
    const docs = db
      .prepare(
        `SELECT d.* FROM documents d WHERE d.organization_id=? AND d.deleted_at IS NULL AND NOT EXISTS(SELECT 1 FROM documents n WHERE n.organization_id=d.organization_id AND n.entity_type=d.entity_type AND n.entity_id=d.entity_id AND lower(n.title)=lower(d.title) AND n.version>d.version AND n.deleted_at IS NULL) ORDER BY d.updated_at DESC,d.id LIMIT 200`,
      )
      .all(org)
      .filter((d) => documentPermission(ctx, d))
      .filter(
        (d) =>
          !q.propertyId ||
          (d.entity_type === "property" && d.entity_id === q.propertyId) ||
          (d.entity_type === "unit" &&
            !!db
              .prepare(
                "SELECT id FROM units WHERE organization_id=? AND id=? AND property_id=? AND deleted_at IS NULL",
              )
              .get(org, String(d.entity_id), q.propertyId)),
      );
    const matches = docs
      .map((d) => ({
        doc: d,
        score: retrievalScore(
          q.question,
          `${d.title} ${String(d.content_text || "").slice(0, 32000)}`,
        ),
      }))
      .filter((d) => d.score >= 0.15)
      .sort(
        (a, b) =>
          b.score - a.score || String(a.doc.id).localeCompare(String(b.doc.id)),
      )
      .slice(0, 5);
    result.findings = {
      mode,
      method: "local Unicode lexical retrieval (not live embeddings)",
      answer: matches.length
        ? "Retrieved stored excerpts below. These are untrusted document records, not independent legal verification."
        : "No authorized matching source excerpt. I cannot substantiate an answer from the available records.",
      retrieved: matches.map(({ doc, score }) => ({
        id: doc.id,
        title: safeText(doc.title),
        version: doc.version,
        score,
        excerpt: safeText(doc.content_text, 300),
      })),
      externalSearch: false,
    };
    result.citations = matches.map(({ doc }) => ({
      ...citation("document", doc, "content_text"),
      excerpt: safeText(doc.content_text, 300),
    }));
    matches.forEach(({ doc }) => sourceWarning(result, doc.content_text));
    result.warnings.push(
      "Search is bounded to the latest 200 vault records and 32,000 characters per text. No external search, OCR, live embedding or approval certification.",
    );
  }
  result.summary = `Source-backed ${mode} insight. ${String(result.findings.answer || "")}`;
  result.summaryUr =
    "درج مجاز ریکارڈ سے اخذ کردہ خلاصہ؛ ذرائع کی تصدیق ضروری ہے، بیرونی معلومات یا قانونی تصدیق کا دعویٰ نہیں۔";
  return result;
}
