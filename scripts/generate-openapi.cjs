const fs = require("node:fs"),
  path = require("node:path");
const paths = {};
function scan(dir) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) scan(full);
    else if (name === "route.ts") {
      const url =
        "/api/v1/" +
        path
          .relative("src/app/api/v1", dir)
          .replaceAll(path.sep, "/")
          .replace(/\[([^\]]+)\]/g, "{$1}");
      const src = fs.readFileSync(full, "utf8"),
        ops = {};
      for (const match of src.matchAll(
        /export async function (GET|POST|PATCH|DELETE|PUT)\(/g,
      )) {
        const method = match[1].toLowerCase();
        ops[method] = {
          operationId: method + "_" + url.replace(/[^a-z0-9]+/gi, "_"),
          summary: `${match[1]} ${url}`,
          description:
            "Implemented handler. Legacy domain DTO details and action variants are in the linked phase guides. This inventory does not falsely claim strict schemas for every historical endpoint.",
          security: /\/public\/|\/health$|\/auth\/login$/.test(url)
            ? []
            : [{ bearerAuth: [] }, { previewHeader: [] }, { cookieAuth: [] }],
          parameters: [...url.matchAll(/\{([^}]+)\}/g)].map((x) => ({
            name: x[1],
            in: "path",
            required: true,
            schema: { type: "string" },
          })),
          responses: {
            200: {
              description:
                "Successful JSON response or protected export (per domain guide).",
            },
            400: {
              description: "Malformed/invalid or unsupported request.",
              content: {
                "application/json": {
                  schema: { $ref: "#/components/schemas/Error" },
                },
              },
            },
            401: { description: "Authentication missing, expired or revoked." },
            403: {
              description: "Permission, identity scope or origin denied.",
            },
            404: { description: "Authorized record not found." },
            413: { description: "Body exceeds 1 MiB (agent endpoints 64 KB)." },
            429: {
              description:
                "Fixed-window request quota exhausted; Retry-After: 900.",
            },
          },
        };
        if (method !== "get")
          ops[method].requestBody = {
            required: true,
            content: {
              "application/json": {
                schema: { type: "object", additionalProperties: true },
              },
            },
          };
      }
      paths[url] = ops;
    }
  }
}
scan("src/app/api/v1");
const portal = paths["/api/v1/portal"];
portal.get.description =
  "Authenticated personal scope is derived from current role and database-linked user profiles; no client identity override. Without resource returns summary/staff consent options; with resource returns paged minimized records. Staff cannot request personal collections.";
portal.get.parameters = [
  {
    name: "resource",
    in: "query",
    schema: {
      type: "string",
      enum: [
        "leases",
        "invoices",
        "payments",
        "tickets",
        "properties",
        "units",
        "statements",
        "reviews",
        "notifications",
      ],
    },
  },
  {
    name: "page",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
  },
  {
    name: "limit",
    in: "query",
    schema: { type: "integer", minimum: 1, maximum: 50, default: 20 },
  },
];
portal.get.responses["200"].content = {
  "application/json": {
    schema: {
      oneOf: [
        { $ref: "#/components/schemas/PortalPage" },
        { $ref: "#/components/schemas/PortalSummary" },
      ],
    },
  },
};
portal.post.description =
  "Administrator explicitly links/unlinks existing profiles and matching-role accounts after offline identity verification; changes are audited. Staff requests an immutable source-bound linked-owner acknowledgement. Only that owner decides; no automatic business/financial write or contract execution. Independent agent/staff approvals are still required.";
portal.post.requestBody.content["application/json"].schema = {
  oneOf: [
    { $ref: "#/components/schemas/ConsentRequest" },
    { $ref: "#/components/schemas/ConsentDecision" },
    { $ref: "#/components/schemas/ProfileLink" },
  ],
};
portal.post.responses["201"] = {
  description: "Created request or final nonbinding consent acknowledgement.",
};
portal.post.responses["409"] = {
  description: "Source changed or decision already final.",
};
const mapBase = paths["/api/v1/properties/{id}/plot-maps"];
mapBase.post.description =
  "Phase A: administrator + admin:manage + properties:write. Stream up to 10 MiB UTF-8 SVG; sanitize and detect draft geometry. Does not publish or change business plots/bookings.";
mapBase.post.requestBody = {
  required: true,
  content: {
    "image/svg+xml": { schema: { type: "string", format: "binary" } },
  },
};
mapBase.post.responses["201"] = {
  description:
    "Draft map, version, detection report and added/removed/changed diff. Read paged candidates through the map detail operation.",
};
mapBase.post.responses["413"] = {
  description: "SVG exceeds 10 MiB or geometry/node/depth complexity budgets.",
};
mapBase.post.responses["415"] = {
  description: "Use raw image/svg+xml; multipart/JSON are not accepted.",
};
mapBase.patch.requestBody = {
  required: true,
  content: {
    "application/json": {
      schema: {
        type: "object",
        additionalProperties: false,
        required: ["plotNumberPattern"],
        properties: {
          plotNumberPattern: {
            type: "string",
            maxLength: 256,
            description:
              "RE2-compatible pattern; first capture group is the plot number. Applies to future versions only.",
          },
        },
      },
    },
  },
};
const mapDetail = paths["/api/v1/properties/{id}/plot-maps/{mapId}"].get;
mapDetail.parameters.push(
  {
    in: "query",
    name: "page",
    schema: { type: "integer", minimum: 1, maximum: 10000, default: 1 },
  },
  {
    in: "query",
    name: "limit",
    schema: { type: "integer", minimum: 1, maximum: 100, default: 50 },
  },
);
const mapSvg = paths["/api/v1/properties/{id}/plot-maps/{mapId}/svg"].get;
mapSvg.description =
  "Administrator-only sanitized SVG attachment, sandbox CSP/no-store. Original SVG assets have no HTTP serving endpoint.";
mapSvg.responses["200"] = {
  description: "Sanitized SVG attachment",
  content: { "image/svg+xml": { schema: { type: "string" } } },
};
// Phase B administrator review contract (separate from Phase C visitor map).
const reviewPath = paths["/api/v1/properties/{id}/plot-maps/{mapId}/review"];
reviewPath.get.description =
  "Admin-only full draft review: revision, scale/defaults, candidate geometry, official overrides, source shape inventory, validation and fresh published baseline diff.";
reviewPath.patch.description =
  "Revision-checked draft-only action: calibrate, assign, exclude, bulk, merge, split. No business records change until publish. Stale edits/read-only versions return 409.";
reviewPath.patch.responses["409"] = {
  description: "Stale revision or map is already published/archived.",
};
reviewPath.patch.requestBody.content["application/json"].schema = {
  type: "object",
  required: ["action", "revision"],
  properties: {
    revision: { type: "integer", minimum: 0 },
    action: {
      type: "string",
      enum: ["calibrate", "assign", "exclude", "bulk", "merge", "split"],
    },
  },
  additionalProperties: true,
  description:
    "Action fields and strict validated DTO examples in docs/PLOT_MAP_PHASE_B.md.",
};
const csvPath = paths["/api/v1/properties/{id}/plot-maps/{mapId}/csv"];
csvPath.get.responses["200"] = {
  description:
    "UTF-8 BOM CSV attachment; spreadsheet formula starts escaped, integer minor-unit prices.",
  content: { "text/csv": { schema: { type: "string" } } },
};
csvPath.post.requestBody.content["application/json"].schema = {
  type: "object",
  additionalProperties: false,
  required: ["revision", "csv"],
  properties: {
    revision: { type: "integer", minimum: 0 },
    csv: {
      type: "string",
      description:
        "UTF-8 CSV <=950 KB and <=5,000 rows; JSON envelope <=1 MiB. Match plot_number to exactly one active candidate. Atomic import.",
    },
  },
};
csvPath.post.responses["409"] = {
  description: "Stale revision or read-only map.",
};
const publishPath =
  paths["/api/v1/properties/{id}/plot-maps/{mapId}/publish"].post;
publishPath.description =
  "Atomic validated publish with explicit keep-data, warning acceptance, removal acknowledgment, revision and published-baseline checks. Preserves canonical identity/history; previous map archived. No booking/sale creation or financial writes.";
publishPath.requestBody.content["application/json"].schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "revision",
    "baselineMapId",
    "keepExistingData",
    "acceptWarnings",
    "acknowledgeRemoved",
  ],
  properties: {
    revision: { type: "integer", minimum: 0 },
    baselineMapId: { type: "string", nullable: true },
    keepExistingData: { type: "boolean" },
    acceptWarnings: { type: "boolean" },
    warningReason: {
      type: "string",
      maxLength: 1000,
      description: "At least 3 trimmed characters when accepting warnings.",
    },
    acknowledgeRemoved: { type: "boolean" },
  },
};
publishPath.responses["409"] = {
  description: "Stale revision/published baseline or read-only map.",
};
const viewer = paths["/api/v1/properties/{id}/plot-maps/viewer"].get;
viewer.description =
  "Phase C admin-only published-map snapshot: sanitized SVG and allowlisted canonical plot geometry/status/official-or-calculated measurements/price. Never accepts a draft map ID or returns booking/buyer/owner details. Same existing fresh admin/manage/property-write scope until Phase E. Read-only business snapshot; quota 60/user/org/15min.";
viewer.responses["200"] = {
  description:
    "Coherent current published SVG/plot snapshot, private/no-store; loadedAt identifies refresh time.",
  content: {
    "application/json": {
      schema: {
        type: "object",
        required: [
          "id",
          "version",
          "projectId",
          "projectName",
          "viewBox",
          "svg",
          "areaUnit",
          "plots",
          "loadedAt",
        ],
        properties: {
          id: { type: "string" },
          version: { type: "integer" },
          projectId: { type: "string" },
          projectName: { type: "string" },
          publishedAt: { type: "string" },
          loadedAt: { type: "string", format: "date-time" },
          areaUnit: { type: "string", enum: ["sqft", "sqm", "marla", "kanal"] },
          viewBox: {
            type: "array",
            items: { type: "number" },
            minItems: 4,
            maxItems: 4,
          },
          svg: {
            type: "string",
            description:
              "Server-sanitized SVG only; never the source original.",
          },
          plots: {
            type: "array",
            description:
              "Allowlisted DTO documented in docs/PLOT_MAP_PHASE_C.md; stable plot/element IDs, rings, bounds, centroid, status, size/dimensions/source, official facing/corner, total price/currency. No PII or transaction histories.",
            items: { type: "object" },
          },
        },
      },
    },
  },
};
viewer.responses["404"] = {
  description:
    "Project absent/out of organization or no published map. Drafts and archived versions are never served.",
};
viewer.responses["409"] = {
  description:
    "Legacy published map is uncalibrated; publish a calibrated version.",
};
// Phase D: human admin booking writes; never fake rental leases/units or auto-receive cash.
const bookings = paths["/api/v1/plots/{id}/bookings"];
bookings.post.description =
  "Phase D admin-only atomic booking. Requires existing admin/manage/property-write plus leads/invoices/documents read+write. Strict structural/temporal validation shared with browser; published active available plot, exact expected map/price/currency, same-org client/agent. UUID requestKey scoped to org+actor provides exact-input replay; BEGIN IMMEDIATE + conditional status update + unique active booking prevent races. CRM client/lead, unpaid token invoice, actual private PDFs/uploads, actor audit and in-app notifications commit/roll back together. No payment, receipt, sale or ledger posting. See docs/PLOT_MAP_PHASE_D.md.";
bookings.post.responses["201"] = {
  description:
    "New booking and all side effects committed. Contains bookingId, replayed:false and private plot details.",
};
bookings.post.responses["200"] = {
  description:
    "Exact same-actor/request-key replay; replayed:true with original bookingId, current plot details and issued files. No duplicate side effects.",
};
bookings.post.responses["409"] = {
  description:
    "Plot just booked/nonavailable, stale publication/price/currency, encumbrance, changed client, or key reused with different terms. No partial business writes; refresh details/map.",
};
bookings.post.responses["413"] = {
  description:
    "Streamed JSON body exceeds 6 MiB. Maximum 2 base64 attachments, each decoded <=2 MiB; PDF/PNG/JPEG signature required.",
};
bookings.post.requestBody.content["application/json"].schema = {
  type: "object",
  additionalProperties: false,
  required: [
    "requestKey",
    "expectedMapId",
    "expectedPriceMinor",
    "currency",
    "agentId",
    "bookingType",
    "tokenAmountMinor",
    "bookingDate",
    "expiryDate",
    "paymentPlan",
  ],
  properties: {
    requestKey: { type: "string", format: "uuid" },
    expectedMapId: { type: "string" },
    expectedPriceMinor: { type: "integer", minimum: 1, maximum: 1000000000000 },
    currency: { type: "string", pattern: "^[A-Z]{3}$" },
    clientId: {
      type: "string",
      description: "Exactly one of clientId/newClient.",
    },
    newClient: {
      type: "object",
      additionalProperties: false,
      required: ["fullName", "phone"],
      properties: {
        fullName: { type: "string", minLength: 2, maxLength: 150 },
        phone: { type: "string", maxLength: 30 },
        cnic: { type: "string", maxLength: 40 },
        email: { type: "string", maxLength: 254 },
        address: { type: "string", maxLength: 500 },
      },
    },
    agentId: { type: "string" },
    bookingType: { type: "string", enum: ["reserve", "book"] },
    tokenAmountMinor: { type: "integer", minimum: 0, maximum: 1000000000000 },
    bookingDate: {
      type: "string",
      format: "date",
      description: "Today in Asia/Karachi; no backdating/future booking.",
    },
    expiryDate: {
      type: "string",
      format: "date-time",
      nullable: true,
      description: "Future within 90 days for reserve; null for book.",
    },
    paymentPlan: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "downPaymentMinor", "installments", "firstDueDate"],
      properties: {
        kind: { type: "string", enum: ["full", "installment"] },
        downPaymentMinor: {
          type: "integer",
          minimum: 0,
          maximum: 1000000000000,
        },
        installments: { type: "integer", minimum: 0, maximum: 120 },
        firstDueDate: {
          type: "string",
          description:
            "Empty for full; valid date after booking for installment.",
        },
      },
    },
    notes: { type: "string", maxLength: 4000 },
    files: {
      type: "array",
      maxItems: 2,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["name", "category", "mimeType", "base64"],
        properties: {
          name: { type: "string", maxLength: 150 },
          category: { type: "string", enum: ["id_copy", "payment_receipt"] },
          mimeType: {
            type: "string",
            enum: ["application/pdf", "image/png", "image/jpeg"],
          },
          base64: { type: "string", maxLength: 2796204 },
        },
      },
    },
  },
};
bookings.patch.description =
  "Same fresh Phase D permissions. Revision-CAS confirm/cancel/extend with required reason. Only the active source-linked D booking can mutate; legacy records read-only. Pending holds can confirm before expiry or extend forward within 90 days; explicit cancel releases plot and cancels unpaid token invoice without deleting client/CRM/history/files or asserting refunds. No automatic expiry or sale conversion.";
bookings.patch.requestBody.content["application/json"].schema = {
  type: "object",
  additionalProperties: false,
  required: ["bookingId", "revision", "action", "reason"],
  properties: {
    bookingId: { type: "string" },
    revision: { type: "integer", minimum: 0 },
    action: { type: "string", enum: ["confirm", "cancel", "extend"] },
    reason: { type: "string", minLength: 3, maxLength: 500 },
    expiryDate: {
      type: "string",
      format: "date-time",
      description: "Only for extend.",
    },
  },
};
bookings.patch.responses["409"] = {
  description:
    "Stale/closed/legacy booking, invalid plot state, elapsed hold on confirm, or ownership/sale/resale encumbrance.",
};
paths["/api/v1/plots/{id}"].get.description =
  "Phase D private admin-only plot record: canonical catalogue, latest 50 booking records with authorized client identity, invoice/file metadata, latest 100 safe plot/booking activity events. No SVG bytes, source originals, sale/ownership records or file contents. No public/agent access until Phase E; private/no-store.";
const options = paths["/api/v1/plots/{id}/booking-options"].get;
options.description =
  "Same fresh admin/read scope. At least 2 search characters; max 100. Literal bounded name/phone match returns <=30 client IDs/names/phones, never ID/address; <=200 active same-org admin/agent assignees and current default ID.";
options.parameters.push({
  name: "q",
  in: "query",
  schema: { type: "string", maxLength: 100 },
});
paths["/api/v1/plots/{id}/files/{fileId}"].get.description =
  "Same fresh admin/read scope. Actual private booking PDF/PNG/JPEG bytes after org+plot+booking+document binding. Attachment-only, sandbox CSP, nosniff, private/no-store and audited. No storage credentials/public original locators. 120/user/org/15min.";
paths["/api/v1/billing/plot-invoices"].get.description =
  "Admin/manage/property-write + invoices:read. Latest 200 same-org plot token invoice references and non-PII plot/project labels. Separate from rent invoices and ledger revenue; amounts requested, never received. Pending/not_due/cancelled. 120/user/org/15min.";

const spec = {
  openapi: "3.0.3",
  info: {
    title: "Fahad Real Estate API",
    version: "0.8.0",
    description:
      "Route-complete operation inventory; detailed typed Phase 8 personal-portal contracts. Local SQLite, rules/retrieval and mock-provider scope. Credentials are never URL parameters.",
  },
  servers: [{ url: "/" }],
  paths,
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "rems_access_token",
        description:
          "HttpOnly session transport; fresh identical validation and Origin defense for mutations.",
      },
      bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
      previewHeader: {
        type: "apiKey",
        in: "header",
        name: "X-REMS-Access-Token",
        description:
          "Same signed JWT, identical validation; no privileged fallback.",
      },
    },
    schemas: {
      ProfileLink: {
        type: "object",
        additionalProperties: false,
        required: ["action", "profileType", "profileId", "userId"],
        properties: {
          action: { type: "string", enum: ["link_profile"] },
          profileType: { type: "string", enum: ["owner", "tenant"] },
          profileId: { type: "string" },
          userId: {
            type: "string",
            nullable: true,
            description:
              "Active same-organization matching-role account; null explicitly unlinks. Requires admin:manage plus the domain profile write permission.",
          },
        },
      },
      Error: {
        type: "object",
        required: ["error"],
        properties: {
          error: {
            type: "object",
            required: ["code", "message"],
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
          },
        },
      },
      PortalPage: {
        type: "object",
        required: ["resource", "page", "limit", "hasMore", "items", "currency"],
        properties: {
          resource: { type: "string" },
          page: { type: "integer" },
          limit: { type: "integer", maximum: 50 },
          hasMore: { type: "boolean" },
          items: {
            type: "array",
            maxItems: 50,
            items: {
              type: "object",
              description:
                "Minimized role-scoped source DTO; schema depends on selected collection.",
            },
          },
          currency: { type: "string", enum: ["PKR"] },
        },
      },
      PortalSummary: {
        type: "object",
        required: [
          "role",
          "company",
          "linkedProfiles",
          "outstandingMinor",
          "options",
        ],
        properties: {
          role: { type: "string", enum: ["owner", "tenant", "staff"] },
          company: { type: "string" },
          linkedProfiles: { type: "integer" },
          outstandingMinor: {
            type: "integer",
            description:
              "Recorded invoice balances. Owner value is whole-property balance, not pro-rata payout.",
          },
          options: { type: "object" },
        },
      },
      ConsentRequest: {
        type: "object",
        additionalProperties: false,
        required: ["action", "ownerId", "entityType", "entityId", "summary"],
        properties: {
          action: { type: "string", enum: ["request_consent"] },
          ownerId: { type: "string" },
          entityType: { type: "string", enum: ["lease", "maintenance"] },
          entityId: { type: "string" },
          summary: { type: "string", minLength: 5, maxLength: 1200 },
          proposedCostMinor: {
            type: "integer",
            minimum: 0,
            maximum: 1000000000000,
            default: 0,
          },
        },
      },
      ConsentDecision: {
        type: "object",
        additionalProperties: false,
        required: ["action", "id", "decision", "note"],
        properties: {
          action: { type: "string", enum: ["decide_consent"] },
          id: { type: "string" },
          decision: { type: "string", enum: ["approved", "rejected"] },
          note: { type: "string", minLength: 3, maxLength: 1000 },
        },
      },
    },
  },
};
fs.writeFileSync("docs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
console.log(
  "Generated",
  Object.keys(paths).length,
  "implemented route contracts.",
);
