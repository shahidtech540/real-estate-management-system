import React from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  Building2,
  MapPin,
  BedDouble,
  Bath,
  Maximize2,
  ArrowLeft,
  CheckCircle2,
  QrCode,
} from "lucide-react";
import { getListingBySlugOrId } from "@/server/modules/listings/listings.service";
import { formatCompactPkr, formatMinorCurrency } from "@/lib/format";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  try {
    const { slug } = await params;
    const listing = getListingBySlugOrId(slug);
    return {
      title: listing.seo.metaTitle,
      description: listing.seo.metaDescription,
      openGraph: {
        title: listing.seo.metaTitle,
        description: listing.seo.metaDescription,
        type: "website",
      },
    };
  } catch {
    return {
      title: "Property Listing | Fahad Real Estate REMS",
    };
  }
}

export default async function ListingSeoDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  let listing;
  try {
    listing = getListingBySlugOrId(slug);
  } catch {
    notFound();
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-slate-900 text-white border-b border-slate-800">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/listings"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-400 hover:text-emerald-300"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to All Listings</span>
            </Link>
          </div>
          <Link
            href="/dashboard"
            className="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-xs font-semibold text-white"
          >
            Open CRM / Staff Workspace
          </Link>
        </div>
      </header>

      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 grid grid-cols-1 lg:grid-cols-12 gap-8">
        <div className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 shadow-sm p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="px-3 py-1 rounded-full text-xs font-bold uppercase bg-emerald-100 text-emerald-900">
                For {listing.purpose}
              </span>
              <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-800 capitalize">
                Status: {listing.status.replace("_", " ")}
              </span>
            </div>
            <span className="font-mono text-xs text-slate-500">
              Unit: {listing.unitNumber} • Code: {listing.propertyCode}
            </span>
          </div>

          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">{listing.titleEn}</h1>
            <h2 dir="rtl" className="text-xl font-bold text-emerald-800 mt-2">
              {listing.titleUr}
            </h2>
            <p className="text-sm text-slate-600 flex items-center gap-1.5 mt-2">
              <MapPin className="w-4 h-4 text-emerald-600" />
              <span>
                {listing.propertyName} — {listing.address}, {listing.city}
              </span>
            </p>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900 text-white flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-xs uppercase text-emerald-400 font-bold">Asking Price</div>
              <div className="text-2xl sm:text-3xl font-bold mt-0.5">
                {listing.purpose === "sale"
                  ? formatCompactPkr(listing.askingPriceMinor)
                  : `${formatMinorCurrency(listing.askingPriceMinor)} / month`}
              </div>
              <div className="text-xs text-slate-400 mt-0.5">
                ({formatMinorCurrency(listing.askingPriceMinor)})
              </div>
            </div>

            <div className="flex items-center gap-6 text-sm">
              <div>
                <div className="text-xs text-slate-400">Area</div>
                <div className="font-bold flex items-center gap-1">
                  <Maximize2 className="w-4 h-4 text-emerald-400" />
                  <span>
                    {listing.areaDisplay} ({listing.areaSqft} Sq.Ft.)
                  </span>
                </div>
              </div>
              {listing.bedrooms > 0 && (
                <div>
                  <div className="text-xs text-slate-400">Bedrooms</div>
                  <div className="font-bold flex items-center gap-1">
                    <BedDouble className="w-4 h-4 text-emerald-400" />
                    <span>{listing.bedrooms}</span>
                  </div>
                </div>
              )}
              {listing.bathrooms > 0 && (
                <div>
                  <div className="text-xs text-slate-400">Bathrooms</div>
                  <div className="font-bold flex items-center gap-1">
                    <Bath className="w-4 h-4 text-emerald-400" />
                    <span>{listing.bathrooms}</span>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500 mb-1.5">
                Property Description (English)
              </h3>
              <p className="text-sm text-slate-700 leading-relaxed">{listing.descriptionEn}</p>
            </div>

            <div dir="rtl" className="p-4 rounded-xl bg-emerald-50/70 border border-emerald-200">
              <h3 className="text-xs font-bold text-emerald-900 mb-1">تفصیلات (اردو)</h3>
              <p className="text-sm text-slate-800 leading-relaxed">{listing.descriptionUr}</p>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-200 flex items-center justify-between text-xs text-slate-500">
            <span>Canonical SEO Slug: /listings/{listing.slug}</span>
            <span>Coordinates: {listing.latitude}, {listing.longitude}</span>
          </div>
        </div>

        {/* Right 4 Columns: QR Code & Instant Inquiry Card */}
        <div className="lg:col-span-4 space-y-6">
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 text-center space-y-4">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-emerald-50 text-emerald-800 text-xs font-semibold">
              <QrCode className="w-3.5 h-3.5" />
              <span>Shareable QR Code</span>
            </div>
            <div className="flex justify-center">
              <img
                src={listing.qrCodeSvgDataUri}
                alt={`QR code for ${listing.slug}`}
                className="w-44 h-44 border border-slate-200 rounded-xl p-2"
              />
            </div>
            <p className="text-xs text-slate-500">
              Scan to open <code className="font-mono">{listing.shareableUrl}</code> on mobile or
              print on brochure flyers.
            </p>
            <Link
              href="/listings"
              className="w-full py-2.5 px-4 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-semibold text-xs block"
            >
              Inquire / Book Site Viewing
            </Link>
          </div>

          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-6 space-y-2">
            <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
              <Building2 className="w-4 h-4 text-emerald-600" />
              <span>Contact Fahad Real Estate to verify details</span>
            </div>
            <p className="text-xs text-slate-600">
              Sample inventory is shown for demonstration. Verify ownership, approvals, price and
              availability with Fahad Real Estate before making a commitment.
            </p>
            <div className="flex items-center gap-1.5 text-xs text-emerald-700 font-semibold pt-1">
              <CheckCircle2 className="w-4 h-4" />
              <span>Portal Syndication Ready (JSON / CSV)</span>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
