# API usage — portals and plot maps

[`openapi.json`](openapi.json) is a route-complete OpenAPI 3.0.3 inventory of 62
implemented routes / 108 operations, with typed Phase 8 portal inputs/responses.
Legacy operation payloads/action variants are documented in Phases 3–7 guides;
the inventory deliberately does not invent strict complete schemas for old DTOs.
`npm run validate:api` checks every documented route/method against implementation,
coverage of all handlers, unique operation IDs and local schema references. This
is static consistency checking, not a third-party exhaustive OpenAPI conformance test.
Regenerate after route changes with `node scripts/generate-openapi.cjs`.

All calls use same-origin relative URLs. Credentials may be an HttpOnly cookie,
`Authorization: Bearer <signed access JWT>`, or the same signed JWT in
`X-REMS-Access-Token` for an embedded proxy. Fresh RBAC/profile/org checks apply to
all transports. Never put credentials in query strings; APIs are private/no-store.
Cookie mutations need a matching/explicitly trusted Origin. Error JSON has
`error.code`/`error.message`; production never returns raw SQL/filesystem details.

## Personal portal

- `GET /api/v1/portal`: current identity's summary/options. Staff domain writers
  receive bounded consent source options; administrators additionally get linking
  options. This is not an anonymous endpoint or an arbitrary user's dashboard.
- `GET /api/v1/portal?resource=invoices&page=1&limit=20`: current personal collection.
  Resources: leases, invoices, payments, tickets, notifications; owners additionally
  properties, units, statements, reviews. Documents use the separate protected vault
  endpoint. Default page/limit 1/20, hard cap 50, maximum page 10,000, stable source ID
  tie-breakers. Returns `{resource,page,limit,hasMore,items,currency:"PKR"}`.
  Unknown identity overrides are rejected for paged queries. Amounts ending `_minor`
  are exact paisa, not floating-point PKR.
- `POST /api/v1/portal` with an existing source owner: 

```json
{"action":"request_consent","ownerId":"<source owner ID>","entityType":"lease","entityId":"<source lease ID>","summary":"Review the unsigned proposal","proposedCostMinor":10001}
```

  Requires the source's staff write/triage permission and a different linked active
  property owner. Immutable request, audit and source hash; not a financial write.

```json
{"action":"decide_consent","id":"<returned request ID>","decision":"approved","note":"Reviewed as a nonbinding acknowledgement only"}
```

  Only the currently linked owner decides. Returns `binding:false` and
  `executesBusinessWrite:false`. A final or stale source returns 409. Never use the
  response as a bypass for the independent agent/domain approval queue.

```json
{"action":"link_profile","profileType":"tenant","profileId":"<existing business profile ID>","userId":"<active matching-role account ID>"}
```

  Requires administrator plus owners/tenants domain write permission. Same business,
  matching personal role, explicit identity verification; `userId:null` unlinks.
  No automatic linkage by email and no cross-business/account scope fallback.

## Reused workflows

- `POST /maintenance/tickets`, `PATCH /maintenance/tickets/{id}`: submit or confirm
  a linked tenant repair (Phase 4 schemas). Internal actions still need staff rights.
- `GET /leases/{id}/agreement`, `/billing/statements?format=pdf&id=...`: authorized
  source PDFs. Agreements are unsigned templates, not signed/legal evidence.
- `GET /documents`: authorized vault metadata only; no live S3 bytes/OCR promise.
- `POST /auth/login`, `/auth/refresh`, `/auth/logout`; `GET /auth/me`: short-lived
  session, atomic refresh, fresh identity summary and account-wide authenticated
  logout revocation. Refresh accepts an object with refreshToken or a bodyless cookie
  request; malformed/oversized bodies are not silently treated as cookie-only.
- `/admin/users`: privileged account management; 14+ character passwords and non-demo
  emails required in explicit production, not the shared demo password.

Body limit 1 MiB (agent routes 64 KB). 400 invalid, 401 no/revoked session, 403 denied
scope/origin, 404 authorized source absent, 409 final/stale consent, 413 oversized,
429 quota. `Retry-After:900` is a conservative fixed-window retry hint, not an exact
remaining-time meter. See [Phase 8 controls/limits](PHASE8.md).


## Plot Map Phase A

Admin-only raw SVG upload, version/diff queries, per-project pattern settings and
sandboxed sanitized download are documented in [the Phase A API/testing guide](PLOT_MAP_PHASE_A.md).
The dedicated SVG upload limit is 10 MiB; generic JSON limits remain unchanged.


## Plot Map Phase B

Revision-checked draft review/calibration/geometry repair, CSV exchange and validated
identity-preserving publication: [Phase B API and user guide](PLOT_MAP_PHASE_B.md).
All remain administrator-only; no public/booking API is implied.


## Plot Map Phase C

Administrator-only `GET /api/v1/properties/{projectId}/plot-maps/viewer` returns a
coherent published sanitized SVG and safe canonical plot snapshot. No draft/original
assets or booking/owner data. See [Phase C guide](PLOT_MAP_PHASE_C.md).


## Plot Map Phase D

Private admin plot details/options, transactional booking POST and revision-CAS
confirm/cancel/extend PATCH, scoped attachment download and separate billing token
register are documented in [Phase D](PLOT_MAP_PHASE_D.md). Five new routes/six
operations; no fake rental records or asserted payments. Booking POST alone allows
streamed 6 MiB JSON for two ≤2MiB private files; other routes retain 1MiB.
