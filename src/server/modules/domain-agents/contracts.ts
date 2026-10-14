import { z } from "zod";
import { dateSchema, moneySchema } from "../shared/domain";
export const entityId = z.string().min(1).max(180);
export const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const intents = [
  "lead",
  "listing",
  "rent",
  "maintenance",
  "lease",
  "insights",
] as const;
export type AgentKind = (typeof intents)[number];
export const SLUGS: Record<AgentKind, string> = {
  lead: "lead-agent",
  listing: "listing-agent",
  rent: "rent-collection-agent",
  maintenance: "maintenance-triage-agent",
  lease: "lease-lifecycle-agent",
  insights: "insights-knowledge-agent",
};
const types = z.enum([
  "plot",
  "house",
  "apartment",
  "shop",
  "office",
  "warehouse",
]);
export const schemas = {
  lead: z
    .object({
      leadId: entityId,
      intent: z.enum(["sale", "rent"]).default("sale"),
      unitType: types.optional(),
      minBedrooms: z.number().int().min(0).max(20).optional(),
      viewingAt: z.string().datetime().optional(),
    })
    .strict(),
  listing: z
    .object({
      unitId: entityId,
      purpose: z.enum(["sale", "rent"]).default("sale"),
    })
    .strict(),
  rent: z
    .object({
      invoiceId: entityId,
      installments: z.number().int().min(1).max(12).default(3),
    })
    .strict(),
  maintenance: z
    .object({
      ticketId: entityId,
      scheduledAt: z.string().datetime().optional(),
    })
    .strict(),
  lease: z
    .object({
      leaseId: entityId,
      documentId: entityId.optional(),
      newEndDate: dateSchema.optional(),
    })
    .strict(),
  insights: z
    .object({
      question: z.string().trim().min(3).max(500),
      propertyId: entityId.optional(),
      from: dateSchema.optional(),
      to: dateSchema.optional(),
    })
    .strict()
    .refine((b) => !b.from || !b.to || b.from <= b.to, "Invalid date range"),
};
export interface Citation {
  entityType: string;
  id: string;
  field: string;
  updatedAt?: string;
  version?: number;
  excerpt?: string;
}
export interface Proposal {
  id: string;
  title: string;
  tool: string;
  input: Record<string, unknown>;
  expectedSourceHash: string;
  requiresApproval: true;
}
export interface Assessment {
  kind: AgentKind;
  engine: "local-domain-v1";
  version: "1";
  generatedAt: string;
  asOf: string;
  summary: string;
  summaryUr: string;
  findings: Record<string, unknown>;
  citations: Citation[];
  warnings: string[];
  proposals: Proposal[];
}
export const actionSchemas = {
  "crm.qualify": z
    .object({
      leadId: entityId,
      stage: z.literal("contacted"),
      note: z.string().trim().min(3).max(1000),
    })
    .strict(),
  "crm.viewing": z
    .object({
      leadId: entityId,
      unitId: entityId,
      agentId: entityId,
      scheduledAt: z.string().datetime(),
    })
    .strict(),
  "listings.draft": z
    .object({
      unitId: entityId,
      purpose: z.enum(["sale", "rent"]),
      askingPriceMinor: moneySchema.positive(),
    })
    .strict(),
  "rent.reminder": z.object({ invoiceId: entityId }).strict(),
  "maintenance.triage": z
    .object({
      ticketId: entityId,
      category: z.enum([
        "plumbing",
        "electrical",
        "hvac",
        "structural",
        "cleaning",
        "general",
      ]),
      priority: z.enum(["low", "medium", "high", "emergency"]),
      note: z.string().trim().min(3).max(1000),
    })
    .strict(),
  "leases.offer": z
    .object({
      leaseId: entityId,
      newEndDate: dateSchema,
      offeredRentMinor: moneySchema.positive(),
    })
    .strict(),
};
export type ActionName = keyof typeof actionSchemas;
