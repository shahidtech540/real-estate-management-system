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
      cookieAuth: {type:"apiKey",in:"cookie",name:"rems_access_token",description:"HttpOnly session transport; fresh identical validation and Origin defense for mutations."},
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
