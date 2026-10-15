import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { resetDbForTesting } from "@/server/db";
import { DEMO_PASSWORD } from "@/server/db/seed";
import { HttpError } from "@/server/auth/guards";
import { loginWithPassword } from "@/server/modules/auth/auth.service";
import {
  listListings,
  getListingBySlugOrId,
  createListing,
  updateListingStatus,
  exportSyndicationFeed,
  generateListingQrSvg,
} from "@/server/modules/listings/listings.service";
import {
  capturePublicLead,
  createLead,
  listLeads,
  updateLeadStageOrActivity,
  scheduleViewing,
  listViewings,
  updateViewingStatus,
  createDealFromLead,
  listDeals,
} from "@/server/modules/crm/crm.service";

// Route handlers
import {
  GET as listingsGet,
  POST as listingsPost,
  PATCH as listingsPatch,
} from "@/app/api/v1/listings/route";
import { GET as feedGet } from "@/app/api/v1/listings/feed/route";
import { GET as listingSlugGet } from "@/app/api/v1/listings/[slug]/route";
import { POST as publicLeadPost } from "@/app/api/v1/public/leads/route";
import {
  GET as leadsGet,
  POST as leadsPost,
  PATCH as leadsPatch,
} from "@/app/api/v1/crm/leads/route";
import {
  GET as viewingsGet,
  POST as viewingsPost,
  PATCH as viewingsPatch,
} from "@/app/api/v1/crm/viewings/route";
import { GET as dealsGet, POST as dealsPost } from "@/app/api/v1/crm/deals/route";

describe("Phase 2: Listings, Public Site, Portal Syndication & CRM (Leads -> Viewings -> Deals)", () => {
  beforeEach(() => {
    resetDbForTesting();
  });

  it("filters public and internal listings, generates QR codes/SEO metadata, and exports JSON/CSV portal feeds", () => {
    const publicListings = listListings({
      organizationId: "org_pakland",
      onlyPublished: true,
    });
    // Seeded: 5 published + 1 under_offer = 6 public listings (draft & closed excluded)
    expect(publicListings.length).toBe(6);

    const lahoreSale = listListings({
      organizationId: "org_pakland",
      onlyPublished: true,
      city: "Lahore",
      purpose: "sale",
    });
    expect(lahoreSale.length).toBe(2);

    const detail = getListingBySlugOrId("fahad-garden-10-marla-corner-plot-lahore");
    expect(detail.propertyCode).toBe("FGHS-01");
    expect(detail.qrCodeSvgDataUri).toContain("data:image/svg+xml");
    expect(detail.seo.metaTitle).toContain("Fahad Garden");

    const qr = generateListingQrSvg("https://pakland.rems.pk/listings/test");
    expect(qr).toContain("svg");

    // Create a draft listing and transition it through workflow: draft -> published -> under_offer -> closed
    const created = createListing("org_pakland", "usr_agent", {
      propertyId: "prop_10",
      unitId: "unit_28",
      titleEn: "Abdullah City Commercial Corner Plot",
      titleUr: "عبداللہ سٹی کمرشل کارنر پلاٹ",
      descriptionEn: "Prime commercial plot near main gate of Abdullah City.",
      purpose: "sale",
      askingPriceMinor: 35000000 * 100,
      status: "draft",
      syndicatePortals: true,
    });
    expect(created.status).toBe("draft");

    const pub = updateListingStatus("org_pakland", "usr_agent", created.id, {
      status: "published",
    });
    expect(pub.status).toBe("published");
    expect(pub.publishedAt).toBeTruthy();

    const offer = updateListingStatus("org_pakland", "usr_agent", created.id, {
      status: "under_offer",
      askingPriceMinor: 34500000 * 100,
    });
    expect(offer.status).toBe("under_offer");
    expect(offer.askingPriceMinor).toBe(34500000 * 100);

    // Export JSON and CSV syndication feeds
    const jsonFeed = exportSyndicationFeed("org_pakland", "json");
    expect(jsonFeed.count).toBeGreaterThanOrEqual(6);
    expect(jsonFeed.body).toContain("Abdullah City Commercial Corner Plot");

    const csvFeed = exportSyndicationFeed("org_pakland", "csv");
    expect(csvFeed.contentType).toContain("text/csv");
    expect(csvFeed.body).toContain("listing_id,slug,url");
  });

  it("executes the complete Lead-to-Closed-Deal flow with Viewing Scheduler and Multi-Agent Commission Splits", () => {
    // Step 1: Prospect submits public web form on listing lst_1
    const capturedLead = capturePublicLead({
      listingId: "lst_1",
      fullName: "Engr. Kamran Akmal",
      phone: "+92-300-7788991",
      email: "kamran.akmal@engineering.pk",
      source: "web",
      budgetMinor: 24500000 * 100,
      requirementsText: "Ready cash buyer for 10 Marla Corner Plot in Fahad Garden.",
    });
    expect(capturedLead.stage).toBe("new");
    expect(capturedLead.score).toBeGreaterThanOrEqual(60);
    expect(capturedLead.assignedAgentId).toBe("usr_agent");

    // Step 2: Agent contacts lead, adds qualification note & task
    const contactedLead = updateLeadStageOrActivity("org_pakland", "usr_agent", capturedLead.id, {
      stage: "contacted",
      noteText: "Spoke with Engr. Kamran; verified funds and sent plot map.",
      taskText: "Prepare token money receipt draft",
      taskDueDate: "2026-10-19",
    });
    expect(contactedLead.stage).toBe("contacted");
    expect(contactedLead.score).toBeGreaterThan(capturedLead.score);
    const addedTask = contactedLead.timeline.find((t) => t.type === "task")!;
    expect(addedTask).toBeDefined();

    // Toggle task completion
    const toggledTaskLead = updateLeadStageOrActivity("org_pakland", "usr_agent", capturedLead.id, {
      toggleTaskId: addedTask.id,
    });
    expect(
      toggledTaskLead.timeline.find((t) => t.id === addedTask.id)?.completed
    ).toBe(true);

    // Step 3: Schedule site viewing -> automatically advances lead to 'viewing_scheduled'
    const viewing = scheduleViewing("org_pakland", "usr_agent", {
      leadId: capturedLead.id,
      unitId: "unit_21",
      scheduledAt: "2026-10-18T10:30:00.000Z",
      feedback: "Client visiting with family.",
    });
    expect(viewing.status).toBe("scheduled");
    expect(viewing.googleCalendarUrl).toContain("https://calendar.google.com/calendar/render");

    const afterViewingSchedule = listLeads({ organizationId: "org_pakland" }).find(
      (l) => l.id === capturedLead.id
    )!;
    expect(afterViewingSchedule.stage).toBe("viewing_scheduled");

    // Step 4: Complete viewing and move to negotiation
    const completedViewing = updateViewingStatus("org_pakland", "usr_agent", viewing.id, {
      status: "completed",
      feedback: "Client loved the park-facing corner plot and made an offer.",
    });
    expect(completedViewing.status).toBe("completed");

    updateLeadStageOrActivity("org_pakland", "usr_agent", capturedLead.id, {
      stage: "negotiation",
    });

    // Step 5: Verify invalid commission split is rejected
    expect(() =>
      createDealFromLead("org_pakland", "usr_agent", {
        leadId: capturedLead.id,
        unitId: "unit_21",
        dealType: "sale",
        dealValueMinor: 24000000 * 100,
        commissionPct: 2.0,
        agentSplits: [
          { agentId: "usr_agent", splitPct: 50 },
          { agentId: "usr_admin", splitPct: 30 }, // sums to 80% != 100%
        ],
      })
    ).toThrowError(HttpError);

    // Step 6: Close Won Deal with 60% / 40% commission split between two agents
    const deal = createDealFromLead("org_pakland", "usr_agent", {
      leadId: capturedLead.id,
      unitId: "unit_21",
      dealType: "sale",
      dealValueMinor: 24000000 * 100, // 24,000,000 PKR
      commissionPct: 2.0, // 480,000 PKR total commission
      clientCnic: "35202-5566778-1",
      agentSplits: [
        { agentId: "usr_agent", agentName: "Bilal Ahmed", splitPct: 60 },
        { agentId: "usr_admin", agentName: "Tariq Mahmood", splitPct: 40 },
      ],
    });

    expect(deal.status).toBe("closed_won");
    expect(deal.commissionMinor).toBe(480000 * 100);
    expect(deal.agentSplits.length).toBe(2);
    expect(deal.agentSplits[0].amountMinor).toBe(288000 * 100); // 60% of 480,000 PKR
    expect(deal.agentSplits[1].amountMinor).toBe(192000 * 100); // 40% of 480,000 PKR

    // Verify Lead is now 'won', Listing is 'closed', and Unit is 'sold'
    const finalLead = listLeads({ organizationId: "org_pakland" }).find(
      (l) => l.id === capturedLead.id
    )!;
    expect(finalLead.stage).toBe("won");
    expect(finalLead.score).toBe(99);

    const closedListing = getListingBySlugOrId("lst_1", "org_pakland");
    expect(closedListing.status).toBe("closed");
    expect(closedListing.unitStatus).toBe("sold");
  });

  it("exposes all Phase 2 REST API route handlers for public and authenticated CRM workflows", async () => {
    // 1. Public GET /api/v1/listings?public=true
    const pubListRes = await listingsGet(
      new NextRequest("http://localhost:3000/api/v1/listings?public=true&purpose=rent")
    );
    expect(pubListRes.status).toBe(200);
    const pubListData = await pubListRes.json();
    expect(pubListData.listings.length).toBeGreaterThanOrEqual(2);

    // 2. Public GET /api/v1/listings/feed?format=csv & json
    const csvFeedRes = await feedGet(
      new NextRequest("http://localhost:3000/api/v1/listings/feed?format=csv")
    );
    expect(csvFeedRes.status).toBe(200);
    expect(csvFeedRes.headers.get("content-type")).toContain("text/csv");

    // 3. Public GET /api/v1/listings/[slug]
    const slugRes = await listingSlugGet(
      new NextRequest(
        "http://localhost:3000/api/v1/listings/fahad-garden-10-marla-corner-plot-lahore"
      ),
      { params: Promise.resolve({ slug: "fahad-garden-10-marla-corner-plot-lahore" }) }
    );
    expect(slugRes.status).toBe(200);

    // 4. Public POST /api/v1/public/leads
    const pubLeadRes = await publicLeadPost(
      new NextRequest("http://localhost:3000/api/v1/public/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          listingId: "lst_2",
          fullName: "Asad Umar",
          phone: "+92-300-5554433",
          email: "asad@investor.pk",
          source: "web",
          budgetMinor: 25000000 * 100,
        }),
      })
    );
    expect(pubLeadRes.status).toBe(201);
    const pubLeadJson = await pubLeadRes.json();

    // 5. Authenticate as Sales Agent ('agent@fahadrealestate.test')
    const agentLogin = loginWithPassword({
      email: "agent@fahadrealestate.test",
      password: DEMO_PASSWORD,
    });
    const headers = {
      authorization: `Bearer ${agentLogin.accessToken}`,
      "content-type": "application/json",
    };

    // POST & PATCH /api/v1/listings
    const createLstRes = await listingsPost(
      new NextRequest("http://localhost:3000/api/v1/listings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          propertyId: "prop_10",
          unitId: "unit_29",
          titleEn: "Taj Commercial Center Mezzanine Office",
          descriptionEn: "Mezzanine office space in Satellite Town Rawalpindi.",
          purpose: "rent",
          askingPriceMinor: 95000 * 100,
        }),
      })
    );
    expect(createLstRes.status).toBe(201);
    const createdLstJson = await createLstRes.json();

    const patchLstRes = await listingsPatch(
      new NextRequest("http://localhost:3000/api/v1/listings", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          listingId: createdLstJson.listing.id,
          status: "under_offer",
        }),
      })
    );
    expect(patchLstRes.status).toBe(200);

    // GET, POST & PATCH /api/v1/crm/leads
    const getLeadsRes = await leadsGet(
      new NextRequest("http://localhost:3000/api/v1/crm/leads?stage=new", { headers })
    );
    expect(getLeadsRes.status).toBe(200);

    const postLeadRes = await leadsPost(
      new NextRequest("http://localhost:3000/api/v1/crm/leads", {
        method: "POST",
        headers,
        body: JSON.stringify({
          fullName: "Walk-in Investor",
          phone: "+92-321-1112233",
          source: "walk_in",
          budgetMinor: 18000000 * 100,
        }),
      })
    );
    expect(postLeadRes.status).toBe(201);

    const patchLeadRes = await leadsPatch(
      new NextRequest("http://localhost:3000/api/v1/crm/leads", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          leadId: pubLeadJson.lead.id,
          stage: "contacted",
          noteText: "Called client via WhatsApp.",
        }),
      })
    );
    expect(patchLeadRes.status).toBe(200);

    // GET, POST & PATCH /api/v1/crm/viewings
    const postViewingRes = await viewingsPost(
      new NextRequest("http://localhost:3000/api/v1/crm/viewings", {
        method: "POST",
        headers,
        body: JSON.stringify({
          leadId: pubLeadJson.lead.id,
          unitId: "unit_22",
          scheduledAt: "2026-10-20T14:00:00.000Z",
        }),
      })
    );
    expect(postViewingRes.status).toBe(201);
    const createdViewingJson = await postViewingRes.json();

    const patchViewingRes = await viewingsPatch(
      new NextRequest("http://localhost:3000/api/v1/crm/viewings", {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          viewingId: createdViewingJson.viewing.id,
          status: "completed",
          feedback: "Ready to sign deal.",
        }),
      })
    );
    expect(patchViewingRes.status).toBe(200);

    const getViewingsRes = await viewingsGet(
      new NextRequest("http://localhost:3000/api/v1/crm/viewings", { headers })
    );
    expect(getViewingsRes.status).toBe(200);

    // GET & POST /api/v1/crm/deals
    const postDealRes = await dealsPost(
      new NextRequest("http://localhost:3000/api/v1/crm/deals", {
        method: "POST",
        headers,
        body: JSON.stringify({
          leadId: pubLeadJson.lead.id,
          unitId: "unit_22",
          dealType: "sale",
          dealValueMinor: 25000000 * 100,
          commissionPct: 2.0,
          agentSplits: [{ agentId: "usr_agent", splitPct: 100 }],
        }),
      })
    );
    expect(postDealRes.status).toBe(201);

    const getDealsRes = await dealsGet(
      new NextRequest("http://localhost:3000/api/v1/crm/deals", { headers })
    );
    expect(getDealsRes.status).toBe(200);
  });
});
