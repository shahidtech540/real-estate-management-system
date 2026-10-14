"use client";

import { AuthenticatedDownload } from "@/components/AuthenticatedDownload";

import { authFetch } from "@/lib/auth-client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Plus,
  ExternalLink,
  Download,
  Calendar,
  CheckCircle2,
  TrendingUp,
  UserPlus,
  MessageSquare,
  Award,
  Clock,
} from "lucide-react";
import { formatCompactPkr, formatMinorCurrency } from "@/lib/format";

interface ListingRecord {
  id: string;
  propertyId: string;
  unitId: string;
  slug: string;
  titleEn: string;
  titleUr: string;
  descriptionEn: string;
  descriptionUr: string;
  purpose: "sale" | "rent";
  askingPriceMinor: number;
  currency: string;
  status: "draft" | "published" | "under_offer" | "closed";
  syndicatePortals: boolean;
  propertyCode: string;
  propertyName: string;
  city: string;
  unitNumber: string;
  unitType: string;
  areaDisplay: string;
  shareableUrl: string;
  qrCodeSvgDataUri: string;
}

interface LeadTimelineItem {
  id: string;
  type: "note" | "stage_change" | "task";
  text: string;
  author: string;
  dueDate?: string;
  completed?: boolean;
  createdAt: string;
}

interface LeadRecord {
  id: string;
  listingId: string | null;
  listingTitle: string | null;
  listingUnitId: string | null;
  assignedAgentId: string | null;
  assignedAgentName: string | null;
  fullName: string;
  phone: string;
  email: string | null;
  source: string;
  stage: "new" | "contacted" | "viewing_scheduled" | "negotiation" | "won" | "lost";
  score: number;
  budgetMinor: number;
  requirementsText: string | null;
  timeline: LeadTimelineItem[];
  createdAt: string;
}

interface ViewingRecord {
  id: string;
  leadId: string;
  leadName: string;
  leadPhone: string;
  unitId: string;
  unitNumber: string;
  propertyName: string;
  propertyCity: string;
  agentName: string;
  scheduledAt: string;
  status: string;
  feedback: string | null;
  googleCalendarUrl: string;
}

interface DealRecord {
  id: string;
  leadId: string | null;
  clientName: string;
  clientPhone: string;
  unitNumber: string;
  propertyName: string;
  primaryAgentName: string;
  dealType: "sale" | "lease";
  dealValueMinor: number;
  commissionPct: number;
  commissionMinor: number;
  agentSplits: Array<{
    agentId: string;
    agentName: string;
    splitPct: number;
    amountMinor: number;
  }>;
  status: string;
  closedAt: string | null;
}

interface PropertyOption {
  id: string;
  code: string;
  name: string;
}

interface UnitOption {
  id: string;
  propertyId: string;
  unitNumber: string;
  propertyName: string;
  type: string;
  areaDisplay: string;
}

export function ListingsWorkspace({
  properties,
  units,
  onNotify,
  onRefreshAudit,
}: {
  properties: PropertyOption[];
  units: UnitOption[];
  onNotify: (type: "success" | "error", text: string) => void;
  onRefreshAudit: () => void;
}) {
  const [listings, setListings] = useState<ListingRecord[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [purposeFilter, setPurposeFilter] = useState("");
  const [search, setSearch] = useState("");

  // Create Listing form state
  const [unitId, setUnitId] = useState(units[0]?.id || "unit_21");
  const [titleEn, setTitleEn] = useState("");
  const [titleUr, setTitleUr] = useState("");
  const [descriptionEn, setDescriptionEn] = useState("");
  const [purpose, setPurpose] = useState<"sale" | "rent">("sale");
  const [askingPricePkr, setAskingPricePkr] = useState("25000000");
  const [status, setStatus] = useState<"draft" | "published">("published");

  const fetchListings = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (purposeFilter) params.set("purpose", purposeFilter);
    if (search) params.set("search", search);

    const res = await authFetch(`/api/v1/listings?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setListings(data.listings || []);
    }
  }, [statusFilter, purposeFilter, search]);

  useEffect(() => {
    fetchListings();
  }, [fetchListings]);

  async function handleCreateListing(e: React.FormEvent) {
    e.preventDefault();
    const targetUnit = units.find((u) => u.id === unitId);
    const propertyId = targetUnit?.propertyId || properties[0]?.id || "prop_1";

    const res = await authFetch("/api/v1/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        propertyId,
        unitId,
        titleEn,
        titleUr: titleUr || titleEn,
        descriptionEn,
        purpose,
        askingPriceMinor: Math.round(Number(askingPricePkr) * 100),
        status,
        syndicatePortals: true,
      }),
    });

    const data = await res.json();
    if (!res.ok) {
      onNotify("error", data?.error?.message || "Failed to create listing.");
      return;
    }

    setTitleEn("");
    setTitleUr("");
    setDescriptionEn("");
    onNotify("success", `Published listing '${data.listing.titleEn}' (${data.listing.slug})`);
    fetchListings();
    onRefreshAudit();
  }

  async function handleStatusChange(listingId: string, nextStatus: string) {
    const res = await authFetch("/api/v1/listings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listingId, status: nextStatus }),
    });
    const data = await res.json();
    if (!res.ok) {
      onNotify("error", data?.error?.message || "Failed to update listing status.");
      return;
    }
    onNotify("success", `Listing '${data.listing.slug}' moved to '${nextStatus}'`);
    fetchListings();
    onRefreshAudit();
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-8 space-y-4">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="p-5 border-b border-slate-200 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-slate-900">
                Listings & Portal Syndication ({listings.length})
              </h3>
              <p className="text-xs text-slate-500">
                Workflow: draft &rarr; published &rarr; under_offer &rarr; closed • Bilingual SEO +
                QR codes
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link
                href="/listings"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
              >
                <ExternalLink className="w-3.5 h-3.5" />
                <span>Open Public Portal (/listings)</span>
              </Link>
              <AuthenticatedDownload
                href="/api/v1/listings/feed?format=json"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                <span>JSON Feed</span>
              </AuthenticatedDownload>
              <AuthenticatedDownload
                href="/api/v1/listings/feed?format=csv"
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                <span>CSV Feed</span>
              </AuthenticatedDownload>
            </div>
          </div>

          <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search title, unit, city..."
              className="px-3 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
            />
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="">All Statuses</option>
              <option value="draft">draft</option>
              <option value="published">published</option>
              <option value="under_offer">under_offer</option>
              <option value="closed">closed</option>
            </select>
            <select
              value={purposeFilter}
              onChange={(e) => setPurposeFilter(e.target.value)}
              className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="">Sale & Rent</option>
              <option value="sale">For Sale</option>
              <option value="rent">For Rent</option>
            </select>
          </div>

          <div className="divide-y divide-slate-200">
            {listings.map((lst) => (
              <div
                key={lst.id}
                className="p-5 hover:bg-slate-50 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4"
              >
                <div className="flex items-start gap-3.5">
                  <img
                    src={lst.qrCodeSvgDataUri}
                    alt={`QR ${lst.slug}`}
                    className="w-14 h-14 rounded-lg border border-slate-200 shrink-0 bg-white p-1"
                  />
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[11px] font-bold uppercase ${
                          lst.purpose === "sale"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-blue-100 text-blue-900"
                        }`}
                      >
                        {lst.purpose}
                      </span>
                      <Link
                        href={lst.shareableUrl}
                        className="font-bold text-sm text-slate-900 hover:text-emerald-700"
                      >
                        {lst.titleEn}
                      </Link>
                    </div>
                    <div dir="rtl" className="text-xs font-medium text-emerald-800">
                      {lst.titleUr}
                    </div>
                    <div className="text-xs text-slate-500">
                      {lst.propertyName} ({lst.city}) • Unit{" "}
                      <strong className="font-mono text-slate-700">{lst.unitNumber}</strong> •{" "}
                      {lst.areaDisplay}
                    </div>
                    <div className="text-sm font-bold text-slate-900">
                      {lst.purpose === "sale"
                        ? formatCompactPkr(lst.askingPriceMinor)
                        : `${formatMinorCurrency(lst.askingPriceMinor)} / month`}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <select
                    aria-label={`Status for ${lst.slug}`}
                    value={lst.status}
                    onChange={(e) => handleStatusChange(lst.id, e.target.value)}
                    className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                  >
                    <option value="draft">draft</option>
                    <option value="published">published</option>
                    <option value="under_offer">under_offer</option>
                    <option value="closed">closed</option>
                  </select>
                  <Link
                    href={lst.shareableUrl}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold"
                  >
                    SEO Page
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Create Listing Form */}
      <div className="lg:col-span-4">
        <form
          onSubmit={handleCreateListing}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-3.5"
        >
          <h3 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Plus className="w-4 h-4 text-emerald-600" />
            <span>Create Bilingual Listing</span>
          </h3>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Select Unit / Plot
            </label>
            <select
              value={unitId}
              onChange={(e) => setUnitId(e.target.value)}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitNumber} — {u.propertyName} ({u.areaDisplay})
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">Purpose</label>
              <select
                value={purpose}
                onChange={(e) => setPurpose(e.target.value as "sale" | "rent")}
                className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
              >
                <option value="sale">For Sale</option>
                <option value="rent">For Rent</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Initial Status
              </label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value as "draft" | "published")}
                className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
              >
                <option value="published">published</option>
                <option value="draft">draft</option>
              </select>
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Title (English) *
            </label>
            <input
              type="text"
              required
              value={titleEn}
              onChange={(e) => setTitleEn(e.target.value)}
              placeholder="Prime 10 Marla Plot in Fahad Garden"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Title (Urdu / اردو)
            </label>
            <input
              type="text"
              dir="rtl"
              value={titleUr}
              onChange={(e) => setTitleUr(e.target.value)}
              placeholder="فہد گارڈن میں بہترین 10 مرلہ پلاٹ"
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Asking Price (PKR) *
            </label>
            <input
              type="number"
              required
              value={askingPricePkr}
              onChange={(e) => setAskingPricePkr(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-700 mb-1">
              Description (English) *
            </label>
            <textarea
              rows={3}
              required
              value={descriptionEn}
              onChange={(e) => setDescriptionEn(e.target.value)}
              placeholder="Highlight key features, NOC approval, boulevard access..."
              className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>

          <button
            type="submit"
            className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs transition"
          >
            Publish Listing & Generate QR
          </button>
        </form>
      </div>
    </div>
  );
}

export function CrmWorkspace({
  units,
  onNotify,
  onRefreshAudit,
  onRefreshPortfolio,
}: {
  units: UnitOption[];
  onNotify: (type: "success" | "error", text: string) => void;
  onRefreshAudit: () => void;
  onRefreshPortfolio: () => void;
}) {
  const [leads, setLeads] = useState<LeadRecord[]>([]);
  const [viewings, setViewings] = useState<ViewingRecord[]>([]);
  const [deals, setDeals] = useState<DealRecord[]>([]);
  const [stageFilter, setStageFilter] = useState("");
  const [selectedLeadId, setSelectedLeadId] = useState<string>("lead_1");

  // Activity / Task form state
  const [noteInput, setNoteInput] = useState("");
  const [taskInput, setTaskInput] = useState("");
  const [taskDueDate, setTaskDueDate] = useState("2026-10-20");

  // New Lead form state
  const [newLeadName, setNewLeadName] = useState("");
  const [newLeadPhone, setNewLeadPhone] = useState("");
  const [newLeadSource, setNewLeadSource] = useState("whatsapp");
  const [newLeadBudgetPkr, setNewLeadBudgetPkr] = useState("22000000");
  const [newLeadReq, setNewLeadReq] = useState("");

  // Schedule Viewing state
  const [viewLeadId, setViewLeadId] = useState("lead_1");
  const [viewUnitId, setViewUnitId] = useState("unit_21");
  const [viewDate, setViewDate] = useState("2026-10-18T11:00");

  // Close Deal state
  const [dealLeadId, setDealLeadId] = useState("lead_3");
  const [dealUnitId, setDealUnitId] = useState("unit_23");
  const [dealType, setDealType] = useState<"sale" | "lease">("sale");
  const [dealValuePkr, setDealValuePkr] = useState("25000000");
  const [commissionPct, setCommissionPct] = useState("2.0");
  const [primarySplitPct, setPrimarySplitPct] = useState("70");
  const [secondarySplitPct, setSecondarySplitPct] = useState("30");

  const fetchCrmData = useCallback(async () => {
    const leadQuery = stageFilter ? `?stage=${stageFilter}` : "";
    const [lRes, vRes, dRes] = await Promise.all([
      authFetch(`/api/v1/crm/leads${leadQuery}`),
      authFetch("/api/v1/crm/viewings"),
      authFetch("/api/v1/crm/deals"),
    ]);

    if (lRes.ok) {
      const lData = await lRes.json();
      setLeads(lData.leads || []);
    }
    if (vRes.ok) {
      const vData = await vRes.json();
      setViewings(vData.viewings || []);
    }
    if (dRes.ok) {
      const dData = await dRes.json();
      setDeals(dData.deals || []);
    }
  }, [stageFilter]);

  useEffect(() => {
    fetchCrmData();
  }, [fetchCrmData]);

  const selectedLead = leads.find((l) => l.id === selectedLeadId) || leads[0] || null;

  async function handleStageChange(leadId: string, stage: string) {
    const res = await authFetch("/api/v1/crm/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, stage }),
    });
    const data = await res.json();
    if (!res.ok) {
      onNotify("error", data?.error?.message || "Failed to update lead stage.");
      return;
    }
    onNotify(
      "success",
      `Lead '${data.lead.fullName}' moved to '${stage}' (Updated Score: ${data.lead.score}/100)`
    );
    fetchCrmData();
    onRefreshAudit();
  }

  async function handleAddActivity(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedLead) return;

    const res = await authFetch("/api/v1/crm/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: selectedLead.id,
        noteText: noteInput || undefined,
        taskText: taskInput || undefined,
        taskDueDate: taskInput ? taskDueDate : undefined,
      }),
    });
    if (res.ok) {
      setNoteInput("");
      setTaskInput("");
      onNotify("success", `Updated timeline for ${selectedLead.fullName}`);
      fetchCrmData();
      onRefreshAudit();
    }
  }

  async function handleToggleTask(leadId: string, taskId: string) {
    const res = await authFetch("/api/v1/crm/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId, toggleTaskId: taskId }),
    });
    if (res.ok) {
      fetchCrmData();
    }
  }

  async function handleCreateLead(e: React.FormEvent) {
    e.preventDefault();
    const res = await authFetch("/api/v1/crm/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullName: newLeadName,
        phone: newLeadPhone,
        source: newLeadSource,
        budgetMinor: Math.round(Number(newLeadBudgetPkr) * 100),
        requirementsText: newLeadReq,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      onNotify("error", data?.error?.message || "Failed to create lead.");
      return;
    }
    setNewLeadName("");
    setNewLeadPhone("");
    setNewLeadReq("");
    onNotify("success", `Created CRM lead ${data.lead.fullName} (Score: ${data.lead.score})`);
    fetchCrmData();
    onRefreshAudit();
  }

  async function handleScheduleViewing(e: React.FormEvent) {
    e.preventDefault();
    const res = await authFetch("/api/v1/crm/viewings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: viewLeadId,
        unitId: viewUnitId,
        scheduledAt: new Date(viewDate).toISOString(),
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      onNotify("error", data?.error?.message || "Failed to schedule viewing.");
      return;
    }
    onNotify("success", `Scheduled viewing for ${data.viewing.leadName}`);
    fetchCrmData();
    onRefreshAudit();
  }

  async function handleCloseDeal(e: React.FormEvent) {
    e.preventDefault();
    const pSplit = Number(primarySplitPct);
    const sSplit = Number(secondarySplitPct);
    const splits = [{ agentId: "usr_agent", agentName: "Bilal Ahmed (Sales Agent)", splitPct: pSplit }];
    if (sSplit > 0) {
      splits.push({
        agentId: "usr_admin",
        agentName: "Tariq Mahmood (COO / Co-Agent)",
        splitPct: sSplit,
      });
    }

    const res = await authFetch("/api/v1/crm/deals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: dealLeadId,
        unitId: dealUnitId,
        dealType,
        dealValueMinor: Math.round(Number(dealValuePkr) * 100),
        commissionPct: Number(commissionPct),
        agentSplits: splits,
      }),
    });
    const data = await res.json();
    if (!res.ok) {
      onNotify("error", data?.error?.message || "Failed to close deal.");
      return;
    }
    onNotify(
      "success",
      `Closed Deal for ${data.deal.clientName}! Commission: ${formatMinorCurrency(
        data.deal.commissionMinor
      )}`
    );
    fetchCrmData();
    onRefreshPortfolio();
    onRefreshAudit();
  }

  return (
    <div className="space-y-6">
      {/* Pipeline Stage Filter Pills */}
      <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 flex-wrap">
          {["", "new", "contacted", "viewing_scheduled", "negotiation", "won", "lost"].map(
            (st) => (
              <button
                key={st || "all"}
                type="button"
                onClick={() => setStageFilter(st)}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold capitalize transition ${
                  stageFilter === st
                    ? "bg-slate-900 text-white"
                    : "bg-slate-100 hover:bg-slate-200 text-slate-700"
                }`}
              >
                {st === "" ? `All Leads (${leads.length})` : st.replace("_", " ")}
              </button>
            )
          )}
        </div>
        <div className="text-xs font-semibold text-emerald-700">
          {viewings.length} Viewings • {deals.length} Closed Deals
        </div>
      </div>

      {/* Main CRM Grid: Leads Table + Selected Lead Timeline */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        <div className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              CRM Leads Pipeline & Lead Scoring
            </h3>
            <span className="text-xs text-slate-500">Click any lead to inspect timeline</span>
          </div>

          <div className="divide-y divide-slate-200">
            {leads.map((ld) => {
              const isSelected = selectedLead?.id === ld.id;
              return (
                <div
                  key={ld.id}
                  onClick={() => setSelectedLeadId(ld.id)}
                  className={`p-4 cursor-pointer transition flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 ${
                    isSelected ? "bg-emerald-50/80" : "hover:bg-slate-50"
                  }`}
                >
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-slate-900">{ld.fullName}</span>
                      <span className="px-2 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-900">
                        Score: {ld.score}/100
                      </span>
                      <span className="px-2 py-0.5 rounded text-[11px] font-mono uppercase bg-slate-100 text-slate-700">
                        {ld.source}
                      </span>
                    </div>
                    <div className="text-xs text-slate-500">
                      {ld.phone} {ld.email ? `• ${ld.email}` : ""} • Budget:{" "}
                      <strong className="text-slate-700">
                        {formatCompactPkr(ld.budgetMinor)}
                      </strong>
                    </div>
                    {ld.requirementsText && (
                      <p className="text-xs text-slate-600 line-clamp-1">{ld.requirementsText}</p>
                    )}
                  </div>

                  <div
                    className="flex items-center gap-2 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <select
                      aria-label={`Stage for ${ld.fullName}`}
                      value={ld.stage}
                      onChange={(e) => handleStageChange(ld.id, e.target.value)}
                      className="px-2.5 py-1.5 rounded-xl border border-slate-300 text-xs font-semibold bg-white"
                    >
                      <option value="new">new</option>
                      <option value="contacted">contacted</option>
                      <option value="viewing_scheduled">viewing_scheduled</option>
                      <option value="negotiation">negotiation</option>
                      <option value="won">won</option>
                      <option value="lost">lost</option>
                    </select>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Selected Lead Timeline & Tasks Panel */}
        <div className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-4">
          {selectedLead ? (
            <>
              <div className="border-b border-slate-200 pb-3">
                <div className="text-xs font-bold uppercase text-emerald-700">
                  Activity Timeline & Reminders
                </div>
                <h4 className="text-base font-bold text-slate-900">{selectedLead.fullName}</h4>
                <p className="text-xs text-slate-500">
                  Stage: <strong>{selectedLead.stage}</strong> • Assigned:{" "}
                  {selectedLead.assignedAgentName || "Bilal Ahmed"}
                </p>
              </div>

              <form onSubmit={handleAddActivity} className="space-y-2.5">
                <input
                  type="text"
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  placeholder="Add call log or qualification note..."
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={taskInput}
                    onChange={(e) => setTaskInput(e.target.value)}
                    placeholder="Add follow-up task / reminder..."
                    className="flex-1 px-3 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                  <input
                    type="date"
                    value={taskDueDate}
                    onChange={(e) => setTaskDueDate(e.target.value)}
                    className="px-2.5 py-2 rounded-xl border border-slate-300 text-xs"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white font-semibold text-xs"
                >
                  Save Note / Task to Timeline
                </button>
              </form>

              <div className="space-y-2.5 max-h-64 overflow-y-auto pt-2">
                {selectedLead.timeline.map((item) => (
                  <div
                    key={item.id}
                    className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold uppercase text-[10px] text-slate-500 flex items-center gap-1">
                        {item.type === "task" ? (
                          <Clock className="w-3 h-3 text-amber-600" />
                        ) : (
                          <MessageSquare className="w-3 h-3 text-emerald-600" />
                        )}
                        {item.type}
                      </span>
                      <span className="text-[10px] font-mono text-slate-400">
                        {item.createdAt.slice(0, 10)}
                      </span>
                    </div>
                    {item.type === "task" ? (
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={Boolean(item.completed)}
                          onChange={() => handleToggleTask(selectedLead.id, item.id)}
                          className="rounded text-emerald-600"
                        />
                        <span className={item.completed ? "line-through text-slate-400" : "font-medium"}>
                          {item.text} (Due: {item.dueDate})
                        </span>
                      </label>
                    ) : (
                      <p className="text-slate-700">{item.text}</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="text-xs text-slate-500">Select a lead to view timeline.</p>
          )}
        </div>
      </div>

      {/* Bottom Row: Manual Lead Entry, Viewing Scheduler, and Deal & Commission Split Closer */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* 1. Manual Lead Capture */}
        <form
          onSubmit={handleCreateLead}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3"
        >
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <UserPlus className="w-4 h-4 text-emerald-600" />
            <span>Capture Lead (Phone / WhatsApp / Walk-in)</span>
          </h4>
          <input
            type="text"
            required
            value={newLeadName}
            onChange={(e) => setNewLeadName(e.target.value)}
            placeholder="Prospect Full Name"
            className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
          />
          <input
            type="text"
            required
            value={newLeadPhone}
            onChange={(e) => setNewLeadPhone(e.target.value)}
            placeholder="Phone (+92-300-...)"
            className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
          />
          <div className="grid grid-cols-2 gap-2">
            <select
              value={newLeadSource}
              onChange={(e) => setNewLeadSource(e.target.value)}
              className="px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="whatsapp">WhatsApp</option>
              <option value="phone">Phone Call</option>
              <option value="walk_in">Walk-In</option>
              <option value="email">Email</option>
              <option value="web">Web</option>
            </select>
            <input
              type="number"
              value={newLeadBudgetPkr}
              onChange={(e) => setNewLeadBudgetPkr(e.target.value)}
              placeholder="Budget PKR"
              className="px-2.5 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>
          <input
            type="text"
            value={newLeadReq}
            onChange={(e) => setNewLeadReq(e.target.value)}
            placeholder="Requirements (e.g. 10 Marla Plot in Fahad Garden)"
            className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
          />
          <button
            type="submit"
            className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
          >
            Add Lead to Pipeline
          </button>
        </form>

        {/* 2. Viewing Scheduler + Google Calendar */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-3">
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Calendar className="w-4 h-4 text-blue-600" />
            <span>Schedule Viewing & Google Calendar</span>
          </h4>
          <form onSubmit={handleScheduleViewing} className="space-y-2.5">
            <select
              value={viewLeadId}
              onChange={(e) => setViewLeadId(e.target.value)}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              {leads.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.fullName} ({l.stage})
                </option>
              ))}
            </select>
            <select
              value={viewUnitId}
              onChange={(e) => setViewUnitId(e.target.value)}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              {units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.unitNumber} — {u.propertyName}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={viewDate}
              onChange={(e) => setViewDate(e.target.value)}
              className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs"
            />
            <button
              type="submit"
              className="w-full py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs"
            >
              Schedule Viewing
            </button>
          </form>

          <div className="pt-2 border-t border-slate-200 space-y-2 max-h-40 overflow-y-auto">
            {viewings.map((vw) => (
              <div
                key={vw.id}
                className="p-2.5 rounded-xl bg-slate-50 border border-slate-200 text-xs flex items-center justify-between gap-2"
              >
                <div>
                  <div className="font-semibold text-slate-900">
                    {vw.leadName} &rarr; {vw.unitNumber}
                  </div>
                  <div className="text-[11px] text-slate-500">
                    {vw.scheduledAt.slice(0, 16).replace("T", " ")} ({vw.status})
                  </div>
                </div>
                <a
                  href={vw.googleCalendarUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="px-2 py-1 rounded bg-blue-50 text-blue-700 border border-blue-200 text-[11px] font-semibold shrink-0"
                >
                  + Google Cal
                </a>
              </div>
            ))}
          </div>
        </div>

        {/* 3. Close Deal & Commission Splits */}
        <form
          onSubmit={handleCloseDeal}
          className="bg-white rounded-2xl border border-slate-200 shadow-sm p-5 space-y-2.5"
        >
          <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
            <Award className="w-4 h-4 text-emerald-600" />
            <span>Close Deal & Agent Commission Splits</span>
          </h4>
          <select
            value={dealLeadId}
            onChange={(e) => setDealLeadId(e.target.value)}
            className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
          >
            {leads.map((l) => (
              <option key={l.id} value={l.id}>
                Lead: {l.fullName} ({l.stage})
              </option>
            ))}
          </select>
          <select
            value={dealUnitId}
            onChange={(e) => setDealUnitId(e.target.value)}
            className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
          >
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                Unit: {u.unitNumber} ({u.propertyName})
              </option>
            ))}
          </select>
          <div className="grid grid-cols-3 gap-2">
            <select
              value={dealType}
              onChange={(e) => setDealType(e.target.value as "sale" | "lease")}
              className="px-2 py-2 rounded-xl border border-slate-300 text-xs bg-white"
            >
              <option value="sale">Sale</option>
              <option value="lease">Lease</option>
            </select>
            <input
              type="number"
              value={dealValuePkr}
              onChange={(e) => setDealValuePkr(e.target.value)}
              placeholder="Value PKR"
              className="px-2 py-2 rounded-xl border border-slate-300 text-xs"
            />
            <input
              type="number"
              step="0.5"
              value={commissionPct}
              onChange={(e) => setCommissionPct(e.target.value)}
              placeholder="Comm %"
              className="px-2 py-2 rounded-xl border border-slate-300 text-xs"
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] font-semibold text-slate-600">
                Primary Agent Split %
              </label>
              <input
                type="number"
                value={primarySplitPct}
                onChange={(e) => setPrimarySplitPct(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold text-slate-600">
                Co-Agent Split %
              </label>
              <input
                type="number"
                value={secondarySplitPct}
                onChange={(e) => setSecondarySplitPct(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded-lg border border-slate-300 text-xs"
              />
            </div>
          </div>
          <button
            type="submit"
            className="w-full py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs"
          >
            Close Deal & Calculate Splits
          </button>

          <div className="pt-2 border-t border-slate-200 space-y-1.5 max-h-32 overflow-y-auto">
            {deals.map((d) => (
              <div key={d.id} className="p-2 rounded-lg bg-emerald-50 border border-emerald-200 text-xs">
                <div className="font-bold text-emerald-950">
                  {d.clientName} • {d.unitNumber} ({formatCompactPkr(d.dealValueMinor)})
                </div>
                <div className="text-[11px] text-emerald-800">
                  Commission ({d.commissionPct}%):{" "}
                  <strong>{formatMinorCurrency(d.commissionMinor)}</strong> •{" "}
                  {d.agentSplits.map((s) => `${s.agentName.split(" ")[0]}: ${s.splitPct}%`).join(" / ")}
                </div>
              </div>
            ))}
          </div>
        </form>
      </div>
    </div>
  );
}
