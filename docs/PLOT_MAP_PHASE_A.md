# Interactive Plot Map — Phase A

**Implemented:** additive schema, secured SVG ingestion, versioned private assets,
detection and draft geometry/diffs, API/CLI tests. **Not implemented in this phase:**
review/calibration/publish UI (B), interactive rendering (C), booking workflow (D),
sold/resale/live updates/expiry (E), agent hooks and end-to-end acceptance (F).
There is intentionally no new dashboard tab or booking button yet.

## Run and test on your PC

Use Node **22.22.3 or newer in the 22.x series** (new jsdom requires >=22.22.2),
then open a terminal in the project folder:

```text
npm ci
npm run test:plot-maps
npm run dev
```

In a second terminal, seed **draft detected plots** from each synthetic sample:

```text
npm run plot-maps:sample -- prop_1 samples/plots-explicit.svg
npm run plot-maps:sample -- prop_1 samples/plots-text-only.svg
npm run plot-maps:sample -- prop_1 samples/plots-messy.svg
```

Each command prints a new map ID/version, `status: "draft"`, `detectedPlots: 8`,
all eight candidates (numbers, internal SVG IDs, polygons, area/centroid/bounds),
validation warnings and a version diff. These are demo-only imports; they never
publish, create a live bookable plot, or change units, bookings, sales or finances.
**Use the same `SQLITE_DB_PATH` in app/CLI terminals** if you override the default
`./data/rems.sqlite`; plain tsx workers/CLI do not load Next's `.env.local` automatically.
The CLI refuses explicit production mode. For real accounts, use authenticated API.

A GitHub ZIP has code, not existing local or Arena history. Do not overwrite your
`data/` directory when updating. Back up existing databases before testing upgrades.
The Arena Phase A preview uses a fresh synthetic file at
`data/plot-map-phase-a-demo.sqlite`; it is not recovered business history.

## Upload through the API (Windows PowerShell)

Start the app, then run from the project folder:

```powershell
$base = "http://localhost:3000"
$login = Invoke-RestMethod -Method Post -Uri "$base/api/v1/auth/login" `
  -ContentType "application/json" `
  -Body '{"email":"admin@fahadrealestate.test","password":"Password123!"}'
$headers = @{ Authorization = "Bearer $($login.accessToken)" }
$map = Invoke-RestMethod -Method Post `
  -Uri "$base/api/v1/properties/prop_1/plot-maps" -Headers $headers `
  -ContentType "image/svg+xml" -InFile "samples/plots-explicit.svg"
$map | ConvertTo-Json -Depth 8

# Read the first page of detected geometry:
Invoke-RestMethod -Uri "$base/api/v1/properties/prop_1/plot-maps/$($map.id)?limit=50" `
  -Headers $headers | ConvertTo-Json -Depth 12

# Download ONLY the sanitized SVG (original is never served over HTTP):
Invoke-WebRequest -Uri "$base/api/v1/properties/prop_1/plot-maps/$($map.id)/svg" `
  -Headers $headers -OutFile "sanitized-map.svg"
```

The downloaded file is a static sanitized layout, **not yet interactive**. Tokens
expire in 15 minutes; repeat sign-in if necessary. For a different project, select
its existing ID from `GET /api/v1/properties`; do not create an alternate project table.
Do not expose demo credentials/service publicly.

## Endpoints

All new endpoints require the **current admin role** plus `admin:manage` and
`properties:write`, fresh organization membership and a same-organization project.
Anonymous, agents, owners, tenants and accountants cannot read drafts or upload.
Public map privacy/access will be introduced separately, not by exposing drafts.

| Method | Path | Behavior |
|---|---|---|
| GET | `/api/v1/properties/{projectId}/plot-maps` | Latest 50 versions + current detection pattern |
| POST | same | Raw `image/svg+xml` UTF-8 bytes, <=10 MiB; new draft and report/diff |
| PATCH | same | Strict JSON `{ "plotNumberPattern": "^LOT-([0-9]+)$" }`; future uploads only |
| GET | `.../plot-maps/{mapId}?page=1&limit=50` | Paged candidates (max 100), report/diff |
| GET | `.../plot-maps/{mapId}/svg` | Sanitized SVG attachment, private/no-store, sandbox CSP |

The original SVG has **no HTTP endpoint**. No multipart or base64 wrapper is needed;
the raw dedicated upload endpoint avoids increasing the existing 1 MiB JSON limit.
Upload quota: 20 per administrator/15 minutes. Body size is enforced while streaming,
not merely trusting Content-Length. Wrong type is 415, too large/complex 413,
invalid XML/pattern/viewBox 400, missing session 401, denied scope 403/404.

## Detection and geometry

1. Explicit `data-plot-number` / `data-plot` wins over ID.
2. Numbered groups own all descendant shape geometry, so children are not counted twice.
3. Otherwise IDs match the project RE2-compatible pattern. Default recognizes
   `plot-12`, `plot_12`, `Plot12`, `P-12`, `12`, `A-12` (case-insensitive).
4. Unassigned numeric text anchors are transformed into SVG user space and matched
   to the **smallest unclaimed closed containing shape**. Positioned tspans work.
5. Roads/parks/boundary/legend/title/compass layers, hidden/definition elements,
   unnumbered and excessive-area fallback candidates are excluded. Duplicate
   numbers, open/degenerate/invalid shapes, unmatched labels and area outliers are
   reported; suspicious data is not silently turned into bookable inventory.

Rect/polygon/closed-polyline and SVG path geometry are supported. Parent/local
translate/scale/rotate/matrix/skew transforms compose in SVG order. Curves, smooth
commands and arcs use polygon sampling (32 samples per normalized curve); evenodd
and nonzero compound fills/holes are considered. A valid viewBox or numeric
width/height is required. Geometry is in **SVG units**, not feet/marla: real areas,
side dimensions, corner/facing and official overrides remain uncalibrated/null until B.
Confidence is a detection heuristic, not survey accuracy or legal certification.

Budgets: 25,000 elements, 64 nesting levels (streaming XML preflight before DOM),
5,000 closed shapes, 100,000 total sampled points, 10,000 points per shape, 100,000
characters per path and 10 million fallback comparisons. Oversize attributes and
invalid transforms are flagged. RE2JS avoids native JS backtracking regex attacks.
Nested SVG viewports must be flattened. Rounded rectangles currently use their
rectangular footprint; complex overlapping/self-intersecting shapes need review.
Overlap/merge/split validation and manual exclusions are Phase B work, not certified
by the automatic draft detector. Accuracy on the three supplied fixtures is 8/8
per fixture; this does not establish 95% accuracy on arbitrary designer files.

## Versioning and schema compatibility

- Existing `properties` are projects; old `units` remain independent. No bulk import,
  rename, financial source mutation, or automatic map-to-unit linking occurs.
- `project_maps`: immutable-per-upload original/sanitized asset locators, version,
  viewBox, detection configuration snapshot, report and diff, draft status/audit.
- `project_map_assets`: private SQLite BLOBs for original and sanitized source.
  Locator columns use `sqlite:<map-id>/<kind>`, **not public filesystem paths**.
  Database backups include both assets atomically, with no orphaned filesystem writes.
- `plots`: stable `(project_id, plot_number)` business identity and official fields.
  `map_plot_geometries`: separate per-version candidates/geometry (duplicates allowed
  during draft review), nullable canonical plot link. This avoids deleting old map
  geometry or moving a booking to a newly created plot on upload.
- Future booking/sale/ownership/resale tables include org/actor/customer constraints,
  integer-minor-unit checks and status-change audit triggers. Partial unique indexes
  protect one active booking/current sale/resale; closed bookings can retain history.
  They are schema foundations, **not implemented booking/sale actions**.
- Uploads only insert drafts, assets and candidates. Matching numbers appear in a
  diff against the published map if present, otherwise latest draft. No “keep data”
  choice is silently applied. Confirm/publish/data-preservation UI is Phase B.
- New composite keys/FKs and cross-organization reference triggers enforce tenant
  boundaries. Existing financial rows are unchanged by additive/idempotent migration.
  Prisma additions describe PostgreSQL design; SQLite remains the implemented runtime.

## Security and recovery

DOMPurify with jsdom is the maintained sanitizer; strict XML preflight blocks DTDs,
external entities, malformed XML and complexity bombs. Scripts, events, foreignObject,
links/use/images, animations, style elements/attributes, CSS imports, URL-valued and
CSS-escaped attributes are stripped. All original IDs are replaced with unique
internal `pm-*` IDs; safe source IDs remain data for detection, not interaction keys.
SVG is never executed by the server, and jsdom has no script/resource loading enabled.
Only sanitized bytes are downloadable, with sandbox CSP; originals remain untrusted
private evidence. Do not manually copy originals into `public/` or render them inline.

Use `npm run db:backup -- <new-destination.sqlite>` for online verified backups,
including map assets. Retain database filesystem/backup encryption and access controls.
See `docs/DEPLOYMENT.md` for existing TLS/origin/worker/restore requirements.

## Checkpoint verification

Run `npm run test:plot-maps`, `npm run test:coverage`, `npm run typecheck`,
`npm run validate:api`, `npm run validate:design`, `npm run audit:production`,
and `npm run build`. Automated coverage includes hostile SVGs, all detection methods,
transforms/holes, all three fixtures, 1,000 plots, upload bounds, fresh permission and
organization scopes, idempotent migration/source preservation, stable business
records across versions, status audits and database constraints.

**Stop after Phase A.** Proceed to calibration/review/publishing only after user testing
and explicit authorization; do not merge the feature branch at this checkpoint.
