# Interactive Plot Map — Phase B: review and publish

> Phase B checkpoint guide. Phase C is now implemented; see
> [the published-map viewer guide](PLOT_MAP_PHASE_C.md) for current viewing controls.

Phase B adds an **administrator-only Plot Map workspace** to the dashboard. It is
an editing/review tool, not the Phase C interactive visitor map. Booking, sales,
live status updates and agent hooks remain later phases.

## Run locally (Windows included)

Use Node 22.22.3 or newer in the 22.x series. From the repository folder:

```text
npm ci
npm run test:plot-maps
npm run dev
```

Open `http://localhost:3000/login`, sign in as the demo administrator
`admin@fahadrealestate.test` / `Password123!`, then select **Plot Map** in the desktop
workspace tabs or the mobile workspace dropdown. Real installations use their own
administrator credentials; demo credentials are not production accounts.

Existing databases upgrade automatically and additively on startup. Back up before
upgrading: `npm run db:backup -- backups/before-plot-map-b.sqlite` (use a new destination).
Never replace `data/` with a fresh ZIP. The Arena preview remains a synthetic demo,
not recovered historical business data. Its file is `data/plot-map-phase-a-demo.sqlite`;
local default remains `data/rems.sqlite` unless `SQLITE_DB_PATH` is set.

## End-to-end manual test

1. Choose an existing **Project**. Projects reuse the original property records;
   this does not create a second project list or modify the existing unit portfolio.
2. Upload `samples/plots-explicit.svg`. Expect **8 active plots** and a new draft
   version. Repeat with the text-only and messy samples after testing the first.
   Only the server-sanitized SVG is shown; the original is never rendered/served.
3. Under **Scale calibration**, choose one of:
   - **Ratio:** e.g. 1 SVG unit = 1 foot or 0.3048 meters.
   - **Two points:** click “Pick two points on preview”, select two points, enter
     the known real distance and choose feet/meters. Pointer placement is approximate;
     use a precise ratio for an approved/surveyed scale.
   Choose sqft, sqm, marla or kanal. Default marla is **272.25 sq ft**; change it to
   the local approved convention (e.g. 225) if appropriate. **1 kanal = 20 marla**.
   Apply calibration. The preferences become org defaults for future maps; old map
   calibration snapshots do not change. Physical ratio is per-map, never inferred
   from a new version's prior scale.
4. Click a blue plot overlay or its number in the table. The official-data card
   shows both calculated and official area/dimensions. Assign/fix its number, or use
   the shape selector to choose an unassigned outline and assign it a number.
   “Mark not a plot” excludes selected geometry; it does not erase the original SVG.
   To restore, select the excluded outline and assign its number again.
5. Set **official** area/dimensions/facing/corner where the approved layout differs.
   Select multiple table checkboxes for bulk block/phase/street/category/prices.
   Empty fields mean no change; “Clear official value” removes an override.
   Corner “Use calculated / unknown” clears its override. These changes remain draft.
   Official area and price-per-area units bind when first entered; recalibrating
   display units does not relabel a previously entered official value. Explicitly
   changing the official unit relabels the entered value; enter the correct number.
6. Optional geometry repair:
   - **Merge:** select 2–50 plots, enter the resulting number, merge. Boolean union
     removes double-counted overlaps and preserves holes. Set merged official data
     after merging; incompatible official values are not guessed.
   - **Split:** select one plot; choose vertical X/horizontal Y and an SVG coordinate
     inside its bounds, then enter two different numbers. Both halves get actual
     internal SVG path IDs. Block/phase/per-area price may carry over, but official
     area/dimensions/total price/facing/corner/status are cleared for re-review.
   Axis-aligned cuts are in SVG coordinates (not screen pixels or feet). Arbitrary
   polygon drawing is not offered. A previously booked/sold plot cannot be split or
   merged away under a new number through this screen.
7. **Export CSV for Excel**, edit its documented columns, save as **CSV UTF-8**, then
   import. Match each `plot_number` to exactly one active candidate. A failed row
   rolls back the entire import. Direct `.xlsx/.xls` uploads are not supported;
   Excel's CSV UTF-8 exchange is the supported workflow.
8. Read **Validation, version diff & publish**. Fix blocking errors (including
   duplicates/missing numbers/calibration/protected removals). Resolve warnings or
   explicitly accept them with an audited explanation. Inspect added/removed/
   changed/unchanged numbers against the **currently published** baseline.
9. Leave **Keep existing plot data** checked for re-uploads. Unmentioned official
   fields, canonical plot IDs, bookings, sales and history remain unchanged.
   Explicit draft overrides apply on publish. If unchecked, only unencumbered plot
   metadata can be replaced; any plot with business history requires preservation.
   Removed unused plots require explicit acknowledgment and are soft-archived,
   never deleted. Any plot with business history or protected status must remain.
10. Click **Publish map**, confirm, and expect a read-only published version. The
    previous published version becomes archived. Upload again for subsequent edits.
    Changing an open draft from another browser produces a helpful stale-revision
    error: reload review, recheck the diff and retry rather than overwriting it.

Publishing links detected geometry to stable plot records and updates inventory
metadata **only**. It does not generate fake bookings, client records, invoices,
ledger entries, ownership transfers or notifications. “Available” and “Blocked” are
the only new status choices here; other statuses use their future dedicated workflows.

## Measurements and validation

- Area: SVG units² → calibrated sqft/sqm/marla/kanal. Approximate dimensions use the
  longest boundary edge as orientation and projected extent, with an edge-length
  breakdown. This works for rotated rectangles; curves/irregular plots are **not**
  guaranteed to have survey-grade frontage/depth or a 30×60 rectangular shape.
- Approved official values remain separate from calculation. No price is required
  to publish. Prices are integer minor units; `12500000` = PKR 125,000.00.
- If per-area price exists and total is empty, publish computes rounded total using
  official area (if set) or calculated area in that price's unit. Explicit total
  wins. Retained existing totals are not silently recomputed; clear total if desired.
  Overflow fails atomically instead of truncating or writing fractional money.
- Optional road-side estimates use nearby parallel road/plot edges, a 16% short-side
  proximity threshold and an explicit **SVG top is north** checkbox for facing.
  Two adjacent road directions suggest a corner; opposite roads alone do not.
  Missing/ambiguous road data stays unknown, not invented. Expensive road inference
  is skipped with an explanation; official overrides remain available.
- Intersections are evaluated with polygon boolean clipping, preserving holes;
  touching edges are not overlaps. Suspicious areas and source unmatched numbers/
  outlines remain diagnostics. Assignment/exclusion resolves the corresponding
  shape warning. Other warnings can be explicitly accepted with a reason.
- Complexity: Phase A upload limits still apply; edits cap at 5,000 active plots,
  100,000 sampled points, 10,000 total candidates, 10,000 points/edited shape and
  100,000 characters/edited path. Over 2,000 potentially overlapping pairs blocks
  publish pending simplification. At most 100 individual overlaps/500 warnings are
  displayed with a summary when truncated. This is not arbitrary-file survey or
  end-to-end interactive performance certification.

## CSV columns and rules

```csv
plot_number,block,phase,street,area_official,area_unit,dimensions_official,facing,is_corner,category,price_per_unit_minor,total_price_minor,currency,status
1,A,One,Main,5,marla,30 x 45 ft,North,1,residential,2500000,12500000,PKR,available
```

`plot_number` must be first and is required. Remaining columns are optional but
must be from that exact list, without duplicates. Unknown headers/plot numbers,
duplicate imported numbers, ambiguous candidate matches, invalid money, values
or status transitions fail the whole import. Blank cells mean **no change**, not
clear; use the official-data clear controls for removal. No automatic plot creation
from a CSV with no SVG outline. Supports quoted commas/quotes, multiline fields,
CRLF and UTF-8 BOM. Export prefixes spreadsheet-formula-like strings with an apostrophe;
that protective apostrophe may remain if re-imported. No formulas execute server-side.
Limits: 5,000 rows, 950 KB CSV, and the unchanged 1 MiB JSON envelope cap. Highly
escaped CSV may hit the envelope cap first. Split imports if necessary.

## API contract

All operations require a freshly authorized admin with `admin:manage` and
`properties:write`, scoped to the same organization/project/map. Non-admin roles
are denied by the API, not just hidden by navigation. No public map API is added.

Base: `/api/v1/properties/{projectId}/plot-maps/{mapId}`.

| Method | Suffix | Purpose |
|---|---|---|
| GET | `/review` | Full review, scale/defaults, shapes/candidates, validation and fresh diff |
| PATCH | `/review` | Revision-checked draft calibration/assignment/exclusion/bulk/merge/split |
| GET | `/csv` | Private CSV attachment |
| POST | `/csv` | `{revision, csv}` atomic draft import |
| POST | `/publish` | Validated atomic publish and identity-preserving linking |

Use the Phase A guide for sign-in, raw upload and sanitized download. Example JSON
bodies below (get current revision from `/review` first):

```json
{"action":"calibrate","revision":0,"calibration":{"unit":"ft","ratio":1,"areaUnit":"marla","marlaSqFt":272.25,"northUp":true}}
```
```json
{"action":"calibrate","revision":1,"calibration":{"unit":"m","points":[[0,0],[100,0]],"distance":30.48,"areaUnit":"sqm"}}
```
```json
{"action":"assign","revision":2,"elementId":"pm-5","plotNumber":"A-12"}
```
```json
{"action":"bulk","revision":3,"elementIds":["pm-5"],"data":{"block":"A","area_official":5,"area_unit":"marla","is_corner":1,"price_per_unit_minor":2500000}}
```
```json
{"action":"exclude","revision":4,"elementIds":["pm-9"]}
```
```json
{"action":"merge","revision":5,"elementIds":["pm-5","pm-7"],"plotNumber":"A-12"}
```
```json
{"action":"split","revision":6,"elementId":"pm-edit-...","axis":"x","at":50,"numbers":["12A","12B"]}
```
```json
{"revision":7,"baselineMapId":null,"keepExistingData":true,"acceptWarnings":true,"warningReason":"Compared with approved layout","acknowledgeRemoved":true}
```

Each successful draft edit increments revision. IDs/coordinates above are examples,
not IDs for the sample; select real values from your review response. Publish uses
both revision **and** current `diff.baselineMapId` to prevent stale-map publication.
HTTP 400 for invalid actions/values/validation; 409 for stale revision/baseline or a
read-only published/archived map; 401/403/404 for session/permission/scope failures;
429 with Retry-After for quotas (60 per operation/user/org per 15 minutes). Existing
SVG uploads remain 20 per 15 minutes. All reads are private/no-store.

## Automated verification

```text
npm run test:plot-maps
npm run test:coverage
npm run typecheck
npm run validate:api
npm run validate:design
npm run audit:production
npm run build
npx playwright install chromium
npx playwright test e2e/plot-map-review.spec.ts
```

Browser tests change demo data. Use a separate port/database, never a running real
business instance. The existing Playwright configuration starts a fresh demo DB if
no server exists at its port. In Windows PowerShell use `$env:E2E_PORT="3001"` for
an unused port (and `$env:CI="1"` to disallow reusing a running instance), then run
the test command. Full regression: `npm run test:e2e`.

**Phase B checkpoint:** upload → fix/review → calibrate → CSV → publish works.
Stop here for user testing. Phase C (visitor map, status colors, zoom/pan/search/
filters/tooltips) is not implemented or implicitly authorized by publishing a map.
