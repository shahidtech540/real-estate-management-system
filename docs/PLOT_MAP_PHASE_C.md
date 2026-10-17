# Interactive Plot Map — Phase C: published-map viewer

> Phase C checkpoint guide. Phase D is now implemented: [booking guide](PLOT_MAP_PHASE_D.md).
> Hover remains catalogue-only; click/tap/Enter now opens the D booking/details modal.

**Phase C is complete:** published sanitized SVG rendering, status colors/patterns,
zoom/pan, plot search, filters, counts and hover/tap information. It is currently
**administrator-only**, retaining the existing A/B API permission boundary. Public/
portal/agent read access and its pricing/privacy rules are Phase E, not silently
introduced here. No booking, sale, resale, ownership or live-update workflow is added.

## Run and test

Use Node 22.22.3+ in the 22.x series. On the feature branch:

```text
npm ci
npm run test:plot-maps
npm run dev
```

1. Open `http://localhost:3000/login`; sign in as the demo administrator
   `admin@fahadrealestate.test` / `Password123!`. Real deployments use their own admin.
2. In the dashboard, choose **Plot Map** (workspace dropdown on phone/tablet).
3. If you have no published map, stay in **Review & publish**. Select an existing
   project, upload any `samples/plots-*.svg`, calibrate, review, resolve errors/accept
   warnings and publish. See [the Phase B guide](PLOT_MAP_PHASE_B.md).
4. Select **Published map** at the top of the workspace. The selected project carries
   between review and viewer. If this project has only drafts, a clear “No published
   map” message appears; it never falls back to displaying unapproved drafts.
5. Hover a plot on desktop, or tap it on a phone. See number, block/phase, official
   size/unit (or explicitly calculated size), dimensions, facing, corner flag, price
   and status. Unknown official values remain “Not set”/“Unknown”, never fabricated.
6. Enter an exact plot number such as `A-3` and click **Find plot**. Matching is case-
   insensitive; it centers/zooms/highlights/focuses the plot. A filtered-out plot is
   reported as hidden rather than silently clearing your filters. Unknown numbers
   give a message. Search uses current canonical plot numbers, not designer IDs.
7. Apply status, block, size, price, facing and corner filters. Counts update with
   the filtered visible set. Clear filters to restore all plots. Invalid/reversed
   ranges are explained and do not accidentally match all inventory.
8. Use **Refresh published map** to load the latest publication/current canonical
   statuses and prices. Changes in another browser are **not** automatically pushed
   or polled yet; cross-user live updates are Phase E. Draft edits remain invisible
   until published through B. Read-only viewing never changes business records.

To see a grey blocked plot using the currently available workflows, change an
unencumbered plot to **Blocked** in a new review draft and publish it. Reserved,
Booked, Sold and Resale render correctly when those canonical states exist; their
creation/transaction actions are later phases. Do not manufacture business history
or run ad hoc SQL against real data just to populate the color legend.

The Arena preview remains the same explicitly synthetic database upgraded in place;
no historical business data is claimed recovered. Local default DB is
`data/rems.sqlite`; the preview uses `data/plot-map-phase-a-demo.sqlite`. Preserve and
back up your `data/` directory before code updates, never overwrite it with a ZIP.

## Interaction reference

| Action | Desktop / keyboard | Phone / tablet |
|---|---|---|
| Read information | Hover for instant following tooltip | Tap to pin information |
| Pin information | Click or Enter/Space on focused plot | Tap |
| Close | Escape or pinned close button; hover closes on leave | Pinned close button or tap background |
| Zoom | Wheel, double-click, +/− buttons; +/− keys on focused plot | Two-finger pinch, +/− buttons |
| Pan | Drag inside map | One-finger drag inside map |
| Reset view | Fit to screen; Home on focused plot | Fit to screen |
| Move focus | Tab enters one plot; arrows choose spatial neighbor; Tab exits | Accessible plot buttons and regular controls |

Zoom is pointer-anchored, bounded at 100%–3200% of the fitted viewport, with bounded
panning and a reset control. This visual zoom never edits the physical calibration.
Labels scale with zoom; non-color status abbreviations appear at 200% and above.
Search/fit animations respect reduced-motion preferences. Resizing refits the map.
Gestures are handled inside the canvas; the rest of the page scrolls normally.
The viewer uses modern Pointer Events, ResizeObserver, SVG and CSS dynamic viewport
support; browser checks cover Chromium desktop and mobile emulation, not a certified
matrix of every physical browser/device.

Hover has no artificial delay or data fetch, follows the mouse via animation frames,
and clamps to the browser viewport. Pinning creates a nonmodal read-only information
panel with a close control; Escape/close restores focus to the plot. Decorative text
is hidden from screen readers; plot buttons have number, size/source and status ARIA
labels. Filtered plots are neither drawn nor keyboard-focusable. Compound holes remain
non-clickable holes; original background markup is inert and not a second focus tree.

## Status legend and measurements

- Available: green, dots, **A**.
- Reserved: amber, diagonal lines, **R**.
- Booked: amber, diagonal cross lines, **B**.
- Sold: vermillion/red-orange, horizontal lines, **S**.
- Resale: blue, vertical lines, **RS**.
- Blocked: grey, cross lines, **X**.

The palette is chosen for colorblind distinguishability; patterns, text abbreviations,
labels and tooltip status make color nonessential. Layout shapes without a published
plot match remain background, not bookable inventory. Matched original outlines/labels
are suppressed underneath the canonical plot layer to avoid duplicate/old numbers.

Official area/dimensions take precedence in tooltips and carry their unit and source.
Calculated fallback is explicitly labeled and remains approximate, not a legal survey.
Facing/corner filters use the saved official classifications; unknown is not “noncorner”.
Size ranges convert official values into the current map's calibrated display unit,
using that map's saved marla convention. Price ranges use displayed major currency
units (e.g. PKR rupees); DB/DTO prices stay integer minor units. No currency conversion
is invented, so on mixed-currency maps numeric price ranges apply to each displayed
currency. Missing prices do not match a numeric range. All Phase C users are authorized
admins, so catalogue prices are visible; public price toggles are explicitly Phase E.
No buyer/seller/agent contacts or booking/sale/ownership records appear in this viewer.

## Read API

```text
GET /api/v1/properties/{projectId}/plot-maps/viewer
```

Fresh current admin role + `admin:manage` + `properties:write`, same organization and
existing project. No new public API, permission grant or auth transport is introduced.
Quota: 60 calls per user/org per 15 minutes; auth/rate tables may update as usual,
but reading this snapshot does not write plots, maps, units or financial data.

The response is a coherent transaction snapshot of the current published map and its
canonical, nondeleted linked plots:

- Map ID/version/project name/viewBox, publication and load timestamps, area unit.
- **Sanitized SVG only**, loaded from the matching private asset in that snapshot.
- Plot allowlist: canonical ID, generated `elementId`, number, status, block/phase/
  street/category, rings/fill rule/centroid/bounds, preferred area/source and converted
  filter size, preferred dimension/source, official facing/corner, total price/currency.
- No original SVG, original asset locator, draft review JSON/report, creator user
  IDs, booking notes/client IDs, ownership, sale or resale contact/history joins.

This API never accepts a draft version as an alternative. The single response avoids
SVG/metadata races during publication. It is private/no-store/nosniff. HTTP 401 for no
session, 403 for missing role/capability, 404 for absent/cross-org project or no published
map, 409 for an uncalibrated legacy publication, 429 for quota. A newer draft does not
hide the last publication. A manual refresh shows the new published map if it changed.
Only server-sanitized SVG reaches the client rendering sink, never uploaded file text.

## Implementation and verification

- Separate read service/API, browser-safe typed DTO and pure camera/filter/geometry
  navigation helpers. No database migration or financial/workflow changes in C.
- Static memoized SVG scene. Event delegation on the viewport/SVG layer, not a listener
  per plot; filtered/focused attributes and camera transforms update existing nodes.
  Hover movement positions only the tooltip, not a full SVG React rerender. Details
  are safe catalogue fields already in the authorized snapshot, not fetched on hover.
- Camera/tooltip updates use requestAnimationFrame; separate portal keeps tooltips
  from clipping against the panning canvas. Per-map source IDs, not designer IDs,
  bind geometry and interaction; source data attributes cannot spoof overlay handlers.

```text
npm run test:plot-maps
npm run test:coverage
npm run typecheck
npm run validate:api
npm run validate:design
npm run audit:production
npm run build
npx playwright install chromium
npx playwright test e2e/plot-map-viewer.spec.ts
```

Browser tests must use an isolated seeded demo, not a running real business database.
For Windows PowerShell, set `$env:E2E_PORT="3001"` to an unused port and `$env:CI="1"`
to require a new server, then run the browser command. Full regression:
`npm run test:e2e`; production-policy smoke: `npm run test:e2e:production`.

Tests cover published-only data, redaction/role/org scoping, canonical status/price
refresh, official/calculated unit conversion, read-only domain rows, filters/search/
count math, camera/viewBox/tooltip bounds, keyboard focus, actual touch pinch, desktop
pan/wheel and a 1,000-plot browser map. The latter checks stable SVG node identity,
no hover detail fetches and a local median tooltip render under 100 ms. This is not
a universal hardware performance claim or the final Phase F performance pass.
A six-status browser render test uses synthetic DTO states without inventing booking,
sale or resale creation APIs; server tests separately read actual canonical states.

**Stop after C for user testing.** D booking/click workflows, E privacy/public roles/
ownership/live updates/expiry and F agent hooks remain unimplemented and unauthorized.
