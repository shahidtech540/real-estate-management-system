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
