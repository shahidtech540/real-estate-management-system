"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import {
  Building2,
  Search,
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  QrCode,
  Share2,
  Send,
  Globe,
  CheckCircle2,
  ArrowRight,
  Download,
  ExternalLink,
} from "lucide-react";
import { formatCompactPkr, formatMinorCurrency } from "@/lib/format";
import { Locale } from "@/lib/i18n";

interface PublicListing {
  id: string;
  slug: string;
  titleEn: string;
  titleUr: string;
  descriptionEn: string;
  descriptionUr: string;
  purpose: "sale" | "rent";
  askingPriceMinor: number;
  currency: string;
  status: string;
  propertyCode: string;
  propertyName: string;
  city: string;
  address: string;
  unitNumber: string;
  unitType: string;
  areaSqft: number;
  areaDisplay: string;
  bedrooms: number;
  bathrooms: number;
  shareableUrl: string;
  qrCodeSvgDataUri: string;
}

export default function PublicListingsPage() {
  const [locale, setLocale] = useState<Locale>("en");
  const [listings, setListings] = useState<PublicListing[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [search, setSearch] = useState("");
  const [purpose, setPurpose] = useState("");
  const [city, setCity] = useState("");
  const [unitType, setUnitType] = useState("");
  const [minBedrooms, setMinBedrooms] = useState("");
  const [maxPricePkr, setMaxPricePkr] = useState("");

  // Selected listing for QR modal or Inquiry form
  const [selectedListing, setSelectedListing] = useState<PublicListing | null>(null);
  const [qrModalListing, setQrModalListing] = useState<PublicListing | null>(null);

  // Web Lead Capture Form state
  const [leadName, setLeadName] = useState("");
  const [leadPhone, setLeadPhone] = useState("");
  const [leadEmail, setLeadEmail] = useState("");
  const [leadSource, setLeadSource] = useState<"web" | "whatsapp" | "phone">("web");
  const [leadBudgetPkr, setLeadBudgetPkr] = useState("");
  const [leadMessage, setLeadMessage] = useState("");
  const [leadSuccess, setLeadSuccess] = useState<string | null>(null);
  const [copiedSlug, setCopiedSlug] = useState<string | null>(null);

  const fetchPublicListings = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ public: "true" });
    if (search) params.set("search", search);
    if (purpose) params.set("purpose", purpose);
    if (city) params.set("city", city);
    if (unitType) params.set("unitType", unitType);
    if (minBedrooms) params.set("minBedrooms", minBedrooms);
    if (maxPricePkr && Number(maxPricePkr) > 0) {
      params.set("maxPriceMinor", String(Math.round(Number(maxPricePkr) * 100)));
    }

    const res = await fetch(`/api/v1/listings?${params.toString()}`);
    if (res.ok) {
      const data = await res.json();
      setListings(data.listings || []);
      if (!selectedListing && data.listings?.length > 0) {
        setSelectedListing(data.listings[0]);
      }
    }
    setLoading(false);
  }, [search, purpose, city, unitType, minBedrooms, maxPricePkr, selectedListing]);

  useEffect(() => {
    fetchPublicListings();
  }, [fetchPublicListings]);

  async function handleSubmitLead(e: React.FormEvent) {
    e.preventDefault();
    setLeadSuccess(null);

    const budgetMinor = leadBudgetPkr
      ? Math.round(Number(leadBudgetPkr) * 100)
      : selectedListing?.askingPriceMinor || 0;

    const res = await fetch("/api/v1/public/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        listingId: selectedListing?.id,
        fullName: leadName,
        phone: leadPhone,
        email: leadEmail || undefined,
        source: leadSource,
        budgetMinor,
        requirementsText:
          leadMessage ||
          (selectedListing
            ? `Web inquiry for ${selectedListing.titleEn} (${selectedListing.unitNumber})`
            : "General portfolio inquiry"),
      }),
    });

    if (res.ok) {
      const data = await res.json();
      setLeadName("");
      setLeadPhone("");
      setLeadEmail("");
      setLeadMessage("");
      setLeadSuccess(
        `Thank you! Your inquiry has been registered in our CRM (Lead ID: ${data.lead.id}, Lead Score: ${data.lead.score}/100) and assigned to ${
          data.lead.assignedAgentName || "our Sales Team"
        }.`
      );
    }
  }

  function handleCopyShareLink(slug: string) {
    const url = `${window.location.origin}/listings/${slug}`;
    navigator.clipboard?.writeText(url).catch(() => {});
    setCopiedSlug(slug);
    setTimeout(() => setCopiedSlug(null), 2500);
  }

  const isRtl = locale === "ur";

  return (
    <div dir={isRtl ? "rtl" : "ltr"} className="min-h-screen bg-slate-50 flex flex-col">
      {/* Public Portal Header */}
      <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-30">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500 flex items-center justify-center text-slate-950">
              <Building2 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="font-bold text-lg tracking-tight">
                {isRtl ? "پاک لینڈ پراپرٹی پورٹل" : "PakLand Public Property Portal"}
              </h1>
              <p className="text-xs text-emerald-300/90">
                Fahad Garden • Abdullah City • Taj Commercial Center • VIP Block • University Centers
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            <a
              href="/api/v1/listings/feed?format=json"
              target="_blank"
              rel="noreferrer"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
            >
              <Download className="w-3.5 h-3.5 text-emerald-400" />
              <span>JSON Feed</span>
            </a>
            <a
              href="/api/v1/listings/feed?format=csv"
              target="_blank"
              rel="noreferrer"
              className="hidden md:inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200"
            >
              <Download className="w-3.5 h-3.5 text-amber-400" />
              <span>CSV Feed</span>
            </a>
            <button
              type="button"
              onClick={() => setLocale(locale === "en" ? "ur" : "en")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white"
            >
              <Globe className="w-3.5 h-3.5 text-emerald-400" />
              <span>{locale === "en" ? "اردو (RTL)" : "English (LTR)"}</span>
            </button>
            <Link
              href="/dashboard"
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-700 text-white"
            >
              <span>Staff / CRM Workspace</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Search & Filter Banner */}
      <section className="bg-gradient-to-r from-slate-900 via-emerald-950 to-slate-900 text-white py-8 border-b border-slate-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-5">
          <div>
            <h2 className="text-2xl sm:text-3xl font-bold">
              {isRtl
                ? "پاکستان کے بہترین رہائشی پلاٹس، ولاز اور کمرشل دکانیں تلاش کریں"
                : "Verified Plots, Luxury Villas & Commercial Showrooms"}
            </h2>
            <p className="text-sm text-slate-300 mt-1">
              {isRtl
                ? "لاہور، راولپنڈی اور اسلام آباد میں منظور شدہ پراجیکٹس — فوری آن لائن بکنگ اور وزٹ شیڈولنگ"
                : "Explore LDA, RDA & CDA approved inventory across Lahore, Rawalpindi & Islamabad with instant CRM inquiry."}
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-3 bg-white/10 backdrop-blur-md p-4 rounded-2xl border border-white/15">
            <div className="lg:col-span-2 relative">
              <Search className="w-4 h-4 text-slate-300 absolute left-3 top-3" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search project, title, city..."
                className="w-full pl-9 pr-3 py-2 rounded-xl bg-slate-900/90 border border-white/15 text-xs text-white placeholder-slate-400"
              />
            </div>

            <select
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-900/90 border border-white/15 text-xs text-white"
            >
              <option value="">All Purposes (Sale & Rent)</option>
              <option value="sale">For Sale</option>
              <option value="rent">For Rent</option>
            </select>

            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-900/90 border border-white/15 text-xs text-white"
            >
              <option value="">All Cities</option>
              <option value="Islamabad">Islamabad</option>
              <option value="Rawalpindi">Rawalpindi</option>
              <option value="Lahore">Lahore</option>
            </select>

            <select
              value={unitType}
              onChange={(e) => setUnitType(e.target.value)}
              className="px-3 py-2 rounded-xl bg-slate-900/90 border border-white/15 text-xs text-white"
            >
              <option value="">All Property Types</option>
              <option value="plot">Residential Plot</option>
              <option value="house">House / Villa</option>
              <option value="shop">Commercial Shop</option>
              <option value="office">Corporate Office</option>
              <option value="apartment">Apartment</option>
            </select>

            <input
              type="number"
              value={maxPricePkr}
              onChange={(e) => setMaxPricePkr(e.target.value)}
              placeholder="Max Price (PKR)"
              className="px-3 py-2 rounded-xl bg-slate-900/90 border border-white/15 text-xs text-white placeholder-slate-400"
            />
          </div>
        </div>
      </section>

      {/* Main Content: Listings Grid + Web Lead Capture Form */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 8 Columns: Published Listings */}
        <div className="lg:col-span-8 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-base font-bold text-slate-900">
              {loading ? "Loading listings..." : `${listings.length} Active Listings Available`}
            </h3>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span>Min Bedrooms:</span>
              {[0, 2, 3, 4].map((b) => (
                <button
                  key={b}
                  type="button"
                  onClick={() => setMinBedrooms(b === 0 ? "" : String(b))}
                  className={`px-2.5 py-1 rounded-lg font-semibold ${
                    (minBedrooms === "" && b === 0) || minBedrooms === String(b)
                      ? "bg-slate-900 text-white"
                      : "bg-slate-200 text-slate-700"
                  }`}
                >
                  {b === 0 ? "Any" : `${b}+`}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {listings.map((lst) => {
              const isSelected = selectedListing?.id === lst.id;
              return (
                <div
                  key={lst.id}
                  data-testid={`public-listing-card-${lst.id}`}
                  className={`bg-white rounded-2xl border transition shadow-sm flex flex-col justify-between p-5 ${
                    isSelected
                      ? "border-emerald-600 ring-2 ring-emerald-500/20"
                      : "border-slate-200 hover:border-slate-300"
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase ${
                          lst.purpose === "sale"
                            ? "bg-emerald-100 text-emerald-900"
                            : "bg-blue-100 text-blue-900"
                        }`}
                      >
                        For {lst.purpose}
                      </span>
                      <span className="text-xs font-mono font-semibold text-slate-500">
                        {lst.unitNumber} • {lst.status.replace("_", " ")}
                      </span>
                    </div>

                    <div>
                      <div className="text-xl font-bold text-emerald-700">
                        {lst.purpose === "sale"
                          ? formatCompactPkr(lst.askingPriceMinor)
                          : `${formatMinorCurrency(lst.askingPriceMinor)} / month`}
                      </div>
                      <Link
                        href={`/listings/${lst.slug}`}
                        className="font-bold text-base text-slate-900 hover:text-emerald-700 transition block mt-1"
                      >
                        {isRtl ? lst.titleUr : lst.titleEn}
                      </Link>
                      <div className="text-xs text-slate-500 flex items-center gap-1 mt-1">
                        <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>
                          {lst.propertyName} — {lst.city}
                        </span>
                      </div>
                    </div>

                    <p className="text-xs text-slate-600 line-clamp-3">
                      {isRtl ? lst.descriptionUr : lst.descriptionEn}
                    </p>

                    <div className="flex items-center gap-4 text-xs text-slate-700 pt-2 border-t border-slate-100">
                      <span className="inline-flex items-center gap-1 font-semibold">
                        <Maximize2 className="w-3.5 h-3.5 text-slate-400" />
                        {lst.areaDisplay}
                      </span>
                      {lst.bedrooms > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <BedDouble className="w-3.5 h-3.5 text-slate-400" />
                          {lst.bedrooms} Beds
                        </span>
                      )}
                      {lst.bathrooms > 0 && (
                        <span className="inline-flex items-center gap-1">
                          <Bath className="w-3.5 h-3.5 text-slate-400" />
                          {lst.bathrooms} Baths
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-200 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => setQrModalListing(lst)}
                        className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700"
                        title="Show QR Code"
                      >
                        <QrCode className="w-4 h-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleCopyShareLink(lst.slug)}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium inline-flex items-center gap-1"
                      >
                        <Share2 className="w-3.5 h-3.5" />
                        <span>{copiedSlug === lst.slug ? "Copied!" : "Share"}</span>
                      </button>
                      <Link
                        href={`/listings/${lst.slug}`}
                        className="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-medium inline-flex items-center gap-1"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                        <span>SEO Page</span>
                      </Link>
                    </div>

                    <button
                      type="button"
                      onClick={() => setSelectedListing(lst)}
                      className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold"
                    >
                      Inquire Now
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Right 4 Columns: Lead Capture Web Form */}
        <div className="lg:col-span-4 bg-white rounded-2xl border border-slate-200 shadow-lg p-6 sticky top-20 space-y-4">
          <div className="border-b border-slate-200 pb-3">
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-700">
              Instant CRM Lead Capture
            </span>
            <h3 className="text-lg font-bold text-slate-900 mt-0.5">
              Request Info or Book a Site Viewing
            </h3>
            {selectedListing && (
              <p className="text-xs text-slate-600 mt-1">
                Inquiring about:{" "}
                <strong className="text-slate-900">{selectedListing.titleEn}</strong> (
                {selectedListing.unitNumber})
              </p>
            )}
          </div>

          {leadSuccess && (
            <div
              role="status"
              data-testid="lead-capture-success"
              className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium space-y-1"
            >
              <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <span>Inquiry Sent to CRM Pipeline!</span>
              </div>
              <p>{leadSuccess}</p>
            </div>
          )}

          <form onSubmit={handleSubmitLead} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Your Full Name *
              </label>
              <input
                type="text"
                required
                value={leadName}
                onChange={(e) => setLeadName(e.target.value)}
                data-testid="public-lead-name"
                placeholder="e.g. Tariq Jamil"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Phone / WhatsApp Number *
              </label>
              <input
                type="text"
                required
                value={leadPhone}
                onChange={(e) => setLeadPhone(e.target.value)}
                data-testid="public-lead-phone"
                placeholder="+92-300-1234567"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={leadEmail}
                onChange={(e) => setLeadEmail(e.target.value)}
                placeholder="tariq@example.pk"
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Contact Channel
                </label>
                <select
                  value={leadSource}
                  onChange={(e) =>
                    setLeadSource(e.target.value as "web" | "whatsapp" | "phone")
                  }
                  className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                >
                  <option value="web">Web Inquiry</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="phone">Phone Call</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 mb-1">
                  Budget (PKR)
                </label>
                <input
                  type="number"
                  value={leadBudgetPkr}
                  onChange={(e) => setLeadBudgetPkr(e.target.value)}
                  placeholder="25000000"
                  className="w-full px-2.5 py-2 rounded-xl border border-slate-300 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-700 mb-1">
                Message / Viewing Preference
              </label>
              <textarea
                rows={3}
                value={leadMessage}
                onChange={(e) => setLeadMessage(e.target.value)}
                placeholder="I would like to schedule a site viewing this weekend..."
                className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs"
              />
            </div>

            <button
              type="submit"
              data-testid="public-lead-submit"
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs flex items-center justify-center gap-2 shadow-md shadow-emerald-600/20"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Submit Inquiry to Sales Agent</span>
            </button>
          </form>
        </div>
      </main>

      {/* QR Code Modal */}
      {qrModalListing && (
        <div className="fixed inset-0 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-sm w-full p-6 text-center space-y-4 shadow-2xl">
            <h4 className="font-bold text-base text-slate-900">{qrModalListing.titleEn}</h4>
            <p className="text-xs text-slate-500">
              Scan this QR code for instant mobile access to this SEO listing page
            </p>
            <div className="flex justify-center">
              <img
                src={qrModalListing.qrCodeSvgDataUri}
                alt={`QR Code for ${qrModalListing.slug}`}
                className="w-48 h-48 border border-slate-200 rounded-xl p-2"
              />
            </div>
            <div className="text-xs font-mono bg-slate-100 p-2 rounded-lg text-slate-700 break-all">
              {qrModalListing.shareableUrl}
            </div>
            <button
              type="button"
              onClick={() => setQrModalListing(null)}
              className="w-full py-2 rounded-xl bg-slate-900 text-white text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
