import crypto from "node:crypto";
import { getDb } from "../../db";
import { HttpError } from "../../auth/guards";
import { recordAuditLog } from "../audit/audit.service";

export const VALID_LEAD_STAGES = [
  "new",
  "contacted",
  "viewing_scheduled",
  "negotiation",
  "won",
  "lost",
] as const;

export const VALID_LEAD_SOURCES = [
  "web",
  "whatsapp",
  "phone",
  "email",
  "walk_in",
] as const;

export type LeadStage = (typeof VALID_LEAD_STAGES)[number];
export type LeadSource = (typeof VALID_LEAD_SOURCES)[number];

export interface LeadTimelineItem {
  id: string;
  type: "note" | "stage_change" | "task";
  text: string;
  author: string;
  dueDate?: string;
  completed?: boolean;
  createdAt: string;
}

export interface AgentCommissionSplit {
  agentId: string;
  agentName: string;
  splitPct: number;
  amountMinor: number;
}

/**
 * Deterministic lead scoring algorithm (0 - 100) based on source, stage, budget, and contact info.
 */
export function calculateLeadScore(input: {
  source: LeadSource;
  stage: LeadStage;
  budgetMinor: number;
  hasEmail: boolean;
  hasListing: boolean;
}): number {
  let score = 40;
  const sourceWeights: Record<LeadSource, number> = {
    walk_in: 18,
    whatsapp: 15,
    phone: 14,
    web: 12,
    email: 10,
  };
  const stageWeights: Record<LeadStage, number> = {
    new: 5,
    contacted: 12,
    viewing_scheduled: 22,
    negotiation: 30,
    won: 40,
    lost: -25,
  };

  score += sourceWeights[input.source] || 10;
  score += stageWeights[input.stage] || 0;
  if (input.budgetMinor > 0) score += 8;
  if (input.hasEmail) score += 4;
  if (input.hasListing) score += 6;

  return Math.max(5, Math.min(99, score));
}

export function listLeads(params: {
  organizationId: string;
  stage?: string;
  source?: string;
  assignedAgentId?: string;
  search?: string;
}) {
  const db = getDb();
  let where = "WHERE l.organization_id = ? AND l.deleted_at IS NULL";
  const args: string[] = [params.organizationId];

  if (params.stage) {
    where += " AND l.stage = ?";
    args.push(params.stage);
  }
  if (params.source) {
    where += " AND l.source = ?";
    args.push(params.source);
  }
  if (params.assignedAgentId) {
    where += " AND l.assigned_agent_id = ?";
    args.push(params.assignedAgentId);
  }
  if (params.search && params.search.trim() !== "") {
    where += ` AND (
      LOWER(l.full_name) LIKE LOWER(?) OR
      LOWER(l.phone) LIKE LOWER(?) OR
      LOWER(COALESCE(l.email, '')) LIKE LOWER(?) OR
      LOWER(COALESCE(l.requirements_text, '')) LIKE LOWER(?)
    )`;
    const q = `%${params.search.trim()}%`;
    args.push(q, q, q, q);
  }

  const rows = db
    .prepare(`
      SELECT
        l.id,
        l.organization_id as organizationId,
        l.branch_id as branchId,
        l.listing_id as listingId,
        lst.title_en as listingTitle,
        lst.slug as listingSlug,
        lst.unit_id as listingUnitId,
        l.assigned_agent_id as assignedAgentId,
        u.full_name as assignedAgentName,
        l.full_name as fullName,
        l.phone,
        l.email,
        l.source,
        l.stage,
        l.score,
        l.budget_minor as budgetMinor,
        l.currency,
        l.requirements_text as requirementsText,
        l.notes_json as notesJson,
        l.created_at as createdAt,
        l.updated_at as updatedAt
      FROM leads l
      LEFT JOIN listings lst ON lst.id = l.listing_id
      LEFT JOIN users u ON u.id = l.assigned_agent_id
      ${where}
      ORDER BY l.score DESC, l.updated_at DESC
    `)
    .all(...args) as Array<{
    id: string;
    organizationId: string;
    branchId: string | null;
    listingId: string | null;
    listingTitle: string | null;
    listingSlug: string | null;
    listingUnitId: string | null;
    assignedAgentId: string | null;
    assignedAgentName: string | null;
    fullName: string;
    phone: string;
    email: string | null;
    source: LeadSource;
    stage: LeadStage;
    score: number;
    budgetMinor: number;
    currency: string;
    requirementsText: string | null;
    notesJson: string;
    createdAt: string;
    updatedAt: string;
  }>;

  return rows.map((r) => {
    let timeline: LeadTimelineItem[] = [];
    try {
      timeline = JSON.parse(r.notesJson || "[]");
    } catch {
      timeline = [];
    }
    return {
      ...r,
      timeline,
    };
  });
}

/**
 * Captures a new lead from the public web listing form or WhatsApp/phone inquiry without requiring staff login.
 */
export function capturePublicLead(input: {
  listingId?: string;
  listingSlug?: string;
  fullName: string;
  phone: string;
  email?: string;
  source?: LeadSource;
  budgetMinor?: number;
  requirementsText?: string;
}) {
  const db = getDb();
  let organizationId = "org_pakland";
  let branchId: string | null = "br_isb";
  let resolvedListingId: string | null = null;
  let listingTitle = "General Website Inquiry";

  if (input.listingId || input.listingSlug) {
    const lst = db
      .prepare(`
        SELECT l.id, l.organization_id as organizationId, l.title_en as titleEn, p.branch_id as branchId
        FROM listings l
        JOIN properties p ON p.id = l.property_id
        WHERE (l.id = ? OR l.slug = ?) AND l.deleted_at IS NULL
      `)
      .get(input.listingId || "", input.listingSlug || "") as
      | { id: string; organizationId: string; titleEn: string; branchId: string }
      | undefined;

    if (lst) {
      organizationId = lst.organizationId;
      branchId = lst.branchId;
      resolvedListingId = lst.id;
      listingTitle = lst.titleEn;
    }
  }

  // Find default sales agent in organization
  const agentRow = db
    .prepare(`
      SELECT u.id, u.full_name as fullName
      FROM users u
      JOIN roles r ON r.id = u.role_id
      WHERE u.organization_id = ? AND r.slug = 'agent' AND u.deleted_at IS NULL
      LIMIT 1
    `)
    .get(organizationId) as { id: string; fullName: string } | undefined;

  const source: LeadSource = input.source || "web";
  const budgetMinor = Math.max(0, Math.round(input.budgetMinor || 0));
  const score = calculateLeadScore({
    source,
    stage: "new",
    budgetMinor,
    hasEmail: Boolean(input.email),
    hasListing: Boolean(resolvedListingId),
  });

  const id = `lead_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();
  const initialTimeline: LeadTimelineItem[] = [
    {
      id: `tl_${crypto.randomUUID().slice(0, 8)}`,
      type: "note",
      text: `Lead captured via ${source.toUpperCase()} for '${listingTitle}'.`,
      author: "Public Web Capture",
      createdAt: now,
    },
  ];

  db.prepare(`
    INSERT INTO leads (
      id, organization_id, branch_id, listing_id, assigned_agent_id,
      full_name, phone, email, source, stage, score, budget_minor, currency,
      requirements_text, notes_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'new', ?, ?, 'PKR', ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    branchId,
    resolvedListingId,
    agentRow?.id || null,
    input.fullName.trim(),
    input.phone.trim(),
    input.email?.trim() || null,
    source,
    score,
    budgetMinor,
    input.requirementsText?.trim() || `Interested in ${listingTitle}`,
    JSON.stringify(initialTimeline),
    now,
    now
  );

  recordAuditLog({
    organizationId,
    actorUserId: agentRow?.id || null,
    action: "crm.lead.captured_public",
    entityType: "lead",
    entityId: id,
    metadata: {
      fullName: input.fullName,
      source,
      listingId: resolvedListingId,
      score,
    },
  });

  return listLeads({ organizationId }).find((l) => l.id === id)!;
}

export function createLead(
  organizationId: string,
  actorUserId: string,
  input: {
    listingId?: string;
    branchId?: string;
    assignedAgentId?: string;
    fullName: string;
    phone: string;
    email?: string;
    source: LeadSource;
    stage?: LeadStage;
    budgetMinor?: number;
    requirementsText?: string;
  }
) {
  const db = getDb();
  const stage: LeadStage = input.stage || "new";
  const budgetMinor = Math.max(0, Math.round(input.budgetMinor || 0));
  const score = calculateLeadScore({
    source: input.source,
    stage,
    budgetMinor,
    hasEmail: Boolean(input.email),
    hasListing: Boolean(input.listingId),
  });

  const id = `lead_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const now = new Date().toISOString();
  const initialTimeline: LeadTimelineItem[] = [
    {
      id: `tl_${crypto.randomUUID().slice(0, 8)}`,
      type: "note",
      text: `Lead created manually from channel '${input.source}'.`,
      author: actorUserId,
      createdAt: now,
    },
  ];

  db.prepare(`
    INSERT INTO leads (
      id, organization_id, branch_id, listing_id, assigned_agent_id,
      full_name, phone, email, source, stage, score, budget_minor, currency,
      requirements_text, notes_json, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', ?, ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.branchId || "br_isb",
    input.listingId || null,
    input.assignedAgentId || actorUserId,
    input.fullName.trim(),
    input.phone.trim(),
    input.email?.trim() || null,
    input.source,
    stage,
    score,
    budgetMinor,
    input.requirementsText?.trim() || null,
    JSON.stringify(initialTimeline),
    now,
    now,
    actorUserId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "crm.lead.created",
    entityType: "lead",
    entityId: id,
    metadata: { fullName: input.fullName, source: input.source, stage, score },
  });

  return listLeads({ organizationId }).find((l) => l.id === id)!;
}

export function updateLeadStageOrActivity(
  organizationId: string,
  actorUserId: string,
  leadId: string,
  input: {
    stage?: LeadStage;
    assignedAgentId?: string;
    noteText?: string;
    taskText?: string;
    taskDueDate?: string;
    toggleTaskId?: string;
  }
) {
  const db = getDb();
  const existing = db
    .prepare(`
      SELECT id, organization_id as organizationId, source, stage, budget_minor as budgetMinor,
             email, listing_id as listingId, notes_json as notesJson
      FROM leads
      WHERE id = ? AND deleted_at IS NULL
    `)
    .get(leadId) as
    | {
        id: string;
        organizationId: string;
        source: LeadSource;
        stage: LeadStage;
        budgetMinor: number;
        email: string | null;
        listingId: string | null;
        notesJson: string;
      }
    | undefined;

  if (!existing) {
    throw new HttpError(404, "LEAD_NOT_FOUND", "Lead not found.");
  }
  if (existing.organizationId !== organizationId) {
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization lead access denied.");
  }

  let timeline: LeadTimelineItem[] = [];
  try {
    timeline = JSON.parse(existing.notesJson || "[]");
  } catch {
    timeline = [];
  }

  const now = new Date().toISOString();
  const nextStage = input.stage || existing.stage;

  if (input.stage && input.stage !== existing.stage) {
    timeline.unshift({
      id: `tl_${crypto.randomUUID().slice(0, 8)}`,
      type: "stage_change",
      text: `Pipeline stage progressed from '${existing.stage}' to '${input.stage}'.`,
      author: actorUserId,
      createdAt: now,
    });
  }

  if (input.noteText && input.noteText.trim() !== "") {
    timeline.unshift({
      id: `tl_${crypto.randomUUID().slice(0, 8)}`,
      type: "note",
      text: input.noteText.trim(),
      author: actorUserId,
      createdAt: now,
    });
  }

  if (input.taskText && input.taskText.trim() !== "") {
    timeline.unshift({
      id: `task_${crypto.randomUUID().slice(0, 8)}`,
      type: "task",
      text: input.taskText.trim(),
      dueDate: input.taskDueDate || "2026-10-20",
      completed: false,
      author: actorUserId,
      createdAt: now,
    });
  }

  if (input.toggleTaskId) {
    timeline = timeline.map((item) =>
      item.id === input.toggleTaskId ? { ...item, completed: !item.completed } : item
    );
  }

  const newScore = calculateLeadScore({
    source: existing.source,
    stage: nextStage,
    budgetMinor: existing.budgetMinor,
    hasEmail: Boolean(existing.email),
    hasListing: Boolean(existing.listingId),
  });

  db.prepare(`
    UPDATE leads
    SET stage = ?,
        score = ?,
        assigned_agent_id = COALESCE(?, assigned_agent_id),
        notes_json = ?,
        updated_at = ?
    WHERE id = ?
  `).run(
    nextStage,
    newScore,
    input.assignedAgentId || null,
    JSON.stringify(timeline),
    now,
    leadId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "crm.lead.updated",
    entityType: "lead",
    entityId: leadId,
    metadata: {
      previousStage: existing.stage,
      nextStage,
      newScore,
    },
  });

  return listLeads({ organizationId }).find((l) => l.id === leadId)!;
}

// ============================================================================
// Viewing Scheduler + Google Calendar / iCal Integration
// ============================================================================

export function buildGoogleCalendarUrl(params: {
  title: string;
  scheduledAtIso: string;
  location: string;
  description: string;
}): string {
  const start = new Date(params.scheduledAtIso);
  const end = new Date(start.getTime() + 60 * 60 * 1000); // 1 hour viewing
  const fmt = (d: Date) =>
    d
      .toISOString()
      .replace(/[-:]/g, "")
      .replace(/\.\d{3}Z$/, "Z");

  const query = new URLSearchParams({
    action: "TEMPLATE",
    text: params.title,
    dates: `${fmt(start)}/${fmt(end)}`,
    details: params.description,
    location: params.location,
  });

  return `https://calendar.google.com/calendar/render?${query.toString()}`;
}

export function listViewings(organizationId: string, leadId?: string) {
  const db = getDb();
  let where = "WHERE v.organization_id = ? AND v.deleted_at IS NULL";
  const args: string[] = [organizationId];

  if (leadId) {
    where += " AND v.lead_id = ?";
    args.push(leadId);
  }

  const rows = db
    .prepare(`
      SELECT
        v.id,
        v.organization_id as organizationId,
        v.lead_id as leadId,
        l.full_name as leadName,
        l.phone as leadPhone,
        v.unit_id as unitId,
        u.unit_number as unitNumber,
        u.type as unitType,
        p.name as propertyName,
        p.address as propertyAddress,
        p.city as propertyCity,
        v.agent_id as agentId,
        ag.full_name as agentName,
        v.scheduled_at as scheduledAt,
        v.status,
        v.calendar_event_id as calendarEventId,
        v.feedback,
        v.created_at as createdAt
      FROM viewings v
      JOIN leads l ON l.id = v.lead_id
      JOIN units u ON u.id = v.unit_id
      JOIN properties p ON p.id = u.property_id
      JOIN users ag ON ag.id = v.agent_id
      ${where}
      ORDER BY v.scheduled_at ASC
    `)
    .all(...args) as Array<{
    id: string;
    organizationId: string;
    leadId: string;
    leadName: string;
    leadPhone: string;
    unitId: string;
    unitNumber: string;
    unitType: string;
    propertyName: string;
    propertyAddress: string;
    propertyCity: string;
    agentId: string;
    agentName: string;
    scheduledAt: string;
    status: string;
    calendarEventId: string | null;
    feedback: string | null;
    createdAt: string;
  }>;

  return rows.map((r) => ({
    ...r,
    googleCalendarUrl: buildGoogleCalendarUrl({
      title: `Property Viewing: ${r.unitNumber} (${r.propertyName}) with ${r.leadName}`,
      scheduledAtIso: r.scheduledAt,
      location: `${r.propertyName}, ${r.propertyAddress}, ${r.propertyCity}`,
      description: `Lead: ${r.leadName} (${r.leadPhone}) | Agent: ${r.agentName}`,
    }),
  }));
}

export function scheduleViewing(
  organizationId: string,
  actorUserId: string,
  input: {
    leadId: string;
    unitId: string;
    agentId?: string;
    scheduledAt: string;
    feedback?: string;
  }
) {
  const db = getDb();
  const lead = db
    .prepare("SELECT id, organization_id as organizationId, stage FROM leads WHERE id = ? AND deleted_at IS NULL")
    .get(input.leadId) as { id: string; organizationId: string; stage: LeadStage } | undefined;

  if (!lead) {
    throw new HttpError(404, "LEAD_NOT_FOUND", "Lead not found.");
  }
  if (lead.organizationId !== organizationId) {
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization lead access denied.");
  }

  const unit = db
    .prepare("SELECT id, organization_id as organizationId FROM units WHERE id = ? AND deleted_at IS NULL")
    .get(input.unitId) as { id: string; organizationId: string } | undefined;

  if (!unit || unit.organizationId !== organizationId) {
    throw new HttpError(404, "UNIT_NOT_FOUND", "Unit not found in organization.");
  }

  const id = `vw_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const calendarEventId = `gcal_${id}`;
  const now = new Date().toISOString();
  const agentId = input.agentId || actorUserId;

  db.prepare(`
    INSERT INTO viewings (
      id, organization_id, lead_id, unit_id, agent_id, scheduled_at,
      status, calendar_event_id, feedback, created_at, updated_at, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?, ?, ?, ?)
  `).run(
    id,
    organizationId,
    input.leadId,
    input.unitId,
    agentId,
    new Date(input.scheduledAt).toISOString(),
    calendarEventId,
    input.feedback || null,
    now,
    now,
    actorUserId
  );

  // Advance lead stage to viewing_scheduled if currently new or contacted
  if (lead.stage === "new" || lead.stage === "contacted") {
    updateLeadStageOrActivity(organizationId, actorUserId, input.leadId, {
      stage: "viewing_scheduled",
      noteText: `Scheduled site viewing for ${input.scheduledAt} (Calendar Ref: ${calendarEventId}).`,
    });
  }

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "crm.viewing.scheduled",
    entityType: "viewing",
    entityId: id,
    metadata: {
      leadId: input.leadId,
      unitId: input.unitId,
      scheduledAt: input.scheduledAt,
      calendarEventId,
    },
  });

  return listViewings(organizationId).find((v) => v.id === id)!;
}

export function updateViewingStatus(
  organizationId: string,
  actorUserId: string,
  viewingId: string,
  input: {
    status: "scheduled" | "completed" | "cancelled" | "no_show";
    feedback?: string;
  }
) {
  const db = getDb();
  const vw = db
    .prepare("SELECT id, organization_id as organizationId FROM viewings WHERE id = ? AND deleted_at IS NULL")
    .get(viewingId) as { id: string; organizationId: string } | undefined;

  if (!vw) {
    throw new HttpError(404, "VIEWING_NOT_FOUND", "Viewing not found.");
  }
  if (vw.organizationId !== organizationId) {
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization viewing access denied.");
  }

  const now = new Date().toISOString();
  db.prepare("UPDATE viewings SET status = ?, feedback = COALESCE(?, feedback), updated_at = ? WHERE id = ?").run(
    input.status,
    input.feedback || null,
    now,
    viewingId
  );

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "crm.viewing.updated",
    entityType: "viewing",
    entityId: viewingId,
    metadata: { ...input },
  });

  return listViewings(organizationId).find((v) => v.id === viewingId)!;
}

// ============================================================================
// Deals, Client Conversion & Multi-Agent Commission Splits
// ============================================================================

export function listDeals(organizationId: string) {
  const db = getDb();
  const rows = db
    .prepare(`
      SELECT
        d.id,
        d.organization_id as organizationId,
        d.lead_id as leadId,
        d.client_id as clientId,
        c.full_name as clientName,
        c.phone as clientPhone,
        c.cnic as clientCnic,
        d.unit_id as unitId,
        u.unit_number as unitNumber,
        u.type as unitType,
        p.name as propertyName,
        p.code as propertyCode,
        d.primary_agent_id as primaryAgentId,
        ag.full_name as primaryAgentName,
        d.deal_type as dealType,
        d.deal_value_minor as dealValueMinor,
        d.commission_pct as commissionPct,
        d.commission_minor as commissionMinor,
        d.agent_splits_json as agentSplitsJson,
        d.currency,
        d.status,
        d.closed_at as closedAt,
        d.created_at as createdAt
      FROM deals d
      JOIN clients c ON c.id = d.client_id
      JOIN units u ON u.id = d.unit_id
      JOIN properties p ON p.id = u.property_id
      JOIN users ag ON ag.id = d.primary_agent_id
      WHERE d.organization_id = ? AND d.deleted_at IS NULL
      ORDER BY d.created_at DESC
    `)
    .all(organizationId) as Array<{
    id: string;
    organizationId: string;
    leadId: string | null;
    clientId: string;
    clientName: string;
    clientPhone: string;
    clientCnic: string | null;
    unitId: string;
    unitNumber: string;
    unitType: string;
    propertyName: string;
    propertyCode: string;
    primaryAgentId: string;
    primaryAgentName: string;
    dealType: "sale" | "lease";
    dealValueMinor: number;
    commissionPct: number;
    commissionMinor: number;
    agentSplitsJson: string;
    currency: string;
    status: string;
    closedAt: string | null;
    createdAt: string;
  }>;

  return rows.map((r) => {
    let agentSplits: AgentCommissionSplit[] = [];
    try {
      agentSplits = JSON.parse(r.agentSplitsJson || "[]");
    } catch {
      agentSplits = [];
    }
    return {
      ...r,
      agentSplits,
    };
  });
}

export function createDealFromLead(
  organizationId: string,
  actorUserId: string,
  input: {
    leadId: string;
    unitId: string;
    dealType: "sale" | "lease";
    dealValueMinor: number;
    commissionPct: number;
    clientCnic?: string;
    agentSplits?: Array<{
      agentId: string;
      agentName?: string;
      splitPct: number;
    }>;
  }
) {
  const db = getDb();

  const lead = db
    .prepare(`
      SELECT id, organization_id as organizationId, listing_id as listingId,
             full_name as fullName, phone, email, assigned_agent_id as assignedAgentId
      FROM leads
      WHERE id = ? AND deleted_at IS NULL
    `)
    .get(input.leadId) as
    | {
        id: string;
        organizationId: string;
        listingId: string | null;
        fullName: string;
        phone: string;
        email: string | null;
        assignedAgentId: string | null;
      }
    | undefined;

  if (!lead) {
    throw new HttpError(404, "LEAD_NOT_FOUND", "Lead not found.");
  }
  if (lead.organizationId !== organizationId) {
    throw new HttpError(403, "FORBIDDEN_CROSS_TENANT", "Cross-organization lead access denied.");
  }

  const unit = db
    .prepare("SELECT id, organization_id as organizationId FROM units WHERE id = ? AND deleted_at IS NULL")
    .get(input.unitId) as { id: string; organizationId: string } | undefined;

  if (!unit || unit.organizationId !== organizationId) {
    throw new HttpError(404, "UNIT_NOT_FOUND", "Unit not found in organization.");
  }

  if (input.dealValueMinor <= 0) {
    throw new HttpError(400, "INVALID_DEAL_VALUE", "Deal value must be positive.");
  }
  if (input.commissionPct < 0 || input.commissionPct > 25) {
    throw new HttpError(400, "INVALID_COMMISSION_PCT", "Commission percentage must be between 0% and 25%.");
  }

  const commissionMinor = Math.round(input.dealValueMinor * (input.commissionPct / 100));
  const primaryAgentId = lead.assignedAgentId || actorUserId;

  // Validate and compute agent splits
  const rawSplits =
    input.agentSplits && input.agentSplits.length > 0
      ? input.agentSplits
      : [{ agentId: primaryAgentId, splitPct: 100 }];

  const totalSplitPct = rawSplits.reduce((acc, s) => acc + s.splitPct, 0);
  if (Math.abs(totalSplitPct - 100) > 0.01) {
    throw new HttpError(
      400,
      "INVALID_COMMISSION_SPLIT",
      `Agent commission splits must sum to 100% (got ${totalSplitPct}%).`
    );
  }

  const computedSplits: AgentCommissionSplit[] = rawSplits.map((s) => {
    const userRow = db
      .prepare("SELECT full_name as fullName FROM users WHERE id = ?")
      .get(s.agentId) as { fullName: string } | undefined;
    return {
      agentId: s.agentId,
      agentName: s.agentName || userRow?.fullName || s.agentId,
      splitPct: s.splitPct,
      amountMinor: Math.round(commissionMinor * (s.splitPct / 100)),
    };
  });

  const now = new Date().toISOString();
  const dealId = `deal_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

  db.exec("BEGIN TRANSACTION;");
  try {
    // 1. Find or create Client record from Lead
    let clientRow = db
      .prepare("SELECT id FROM clients WHERE organization_id = ? AND lead_id = ? AND deleted_at IS NULL")
      .get(organizationId, lead.id) as { id: string } | undefined;

    if (!clientRow) {
      const clientId = `cli_${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;
      db.prepare(`
        INSERT INTO clients (
          id, organization_id, lead_id, full_name, cnic, phone, email, client_type,
          created_at, updated_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        clientId,
        organizationId,
        lead.id,
        lead.fullName,
        input.clientCnic || "35202-0000000-1",
        lead.phone,
        lead.email,
        input.dealType === "sale" ? "buyer" : "corporate_tenant",
        now,
        now,
        actorUserId
      );
      clientRow = { id: clientId };
    }

    // 2. Insert Deal record
    db.prepare(`
      INSERT INTO deals (
        id, organization_id, lead_id, client_id, unit_id, primary_agent_id,
        deal_type, deal_value_minor, commission_pct, commission_minor,
        agent_splits_json, currency, status, closed_at, created_at, updated_at, created_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PKR', 'closed_won', ?, ?, ?, ?)
    `).run(
      dealId,
      organizationId,
      lead.id,
      clientRow.id,
      input.unitId,
      primaryAgentId,
      input.dealType,
      Math.round(input.dealValueMinor),
      input.commissionPct,
      commissionMinor,
      JSON.stringify(computedSplits),
      now,
      now,
      now,
      actorUserId
    );

    // 3. Mark Lead as 'won' and score 99
    db.prepare("UPDATE leads SET stage = 'won', score = 99, updated_at = ? WHERE id = ?").run(
      now,
      lead.id
    );

    // 4. Update Unit status ('sold' or 'rented') and close linked Listing
    const nextUnitStatus = input.dealType === "sale" ? "sold" : "rented";
    db.prepare("UPDATE units SET status = ?, updated_at = ? WHERE id = ?").run(
      nextUnitStatus,
      now,
      input.unitId
    );

    db.prepare(
      "UPDATE listings SET status = 'closed', updated_at = ? WHERE organization_id = ? AND unit_id = ?"
    ).run(now, organizationId, input.unitId);

    db.exec("COMMIT;");
  } catch (err) {
    db.exec("ROLLBACK;");
    throw err;
  }

  recordAuditLog({
    organizationId,
    actorUserId,
    action: "crm.deal.closed_won",
    entityType: "deal",
    entityId: dealId,
    metadata: {
      leadId: lead.id,
      unitId: input.unitId,
      dealType: input.dealType,
      dealValueMinor: input.dealValueMinor,
      commissionMinor,
      splitsCount: computedSplits.length,
    },
  });

  return listDeals(organizationId).find((d) => d.id === dealId)!;
}
