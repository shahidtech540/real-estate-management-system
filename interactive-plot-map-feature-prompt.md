# Feature Spec: Interactive Plot Map from SVG

Add this feature to the existing Real Estate Management System. Read the current codebase first (stack, folder structure, DB schema, auth/RBAC, `DECISIONS.md`, `PROGRESS.md`) and follow its existing conventions. Do not rewrite unrelated modules.

Work in the phases at the bottom. Finish each phase completely (working code, tests, no placeholders), update `PROGRESS.md`, then stop and tell me how to run and test it.

---

## 1. GOAL

An admin uploads an **SVG layout/master plan** of a project. The system automatically detects every plot, extracts its plot number, and generates an **interactive map** in a new "Plot Map" section.

- **Hover** a plot: tooltip with plot number, size, dimensions, status, price (and other details).
- **Click an available plot:** opens a booking form.
- **Click a booked / sold / resale plot:** opens a details panel for that plot (what is shown depends on the viewer's role).

---

## 2. SVG UPLOAD AND AUTOMATIC PLOT DETECTION

### 2.1 Upload
- Admin screen: Project → "Plot Map" → Upload SVG (max 10 MB; validate it is a real SVG).
- **Security (mandatory):** sanitize every uploaded SVG server-side (remove `<script>`, event handlers like `onclick`, `<foreignObject>`, external `href`/`xlink:href` links, `javascript:` URLs, external CSS imports). Use a maintained sanitizer (e.g. DOMPurify with the SVG profile, or `svg-sanitize`). Store the original and the sanitized version; only ever render the sanitized one.
- Keep versions: re-uploading creates a new map version. Offer "keep existing plot data where plot numbers match" and show a diff (added / removed / changed plots) before confirming.

### 2.2 Detection strategy (try in this order, per element)
1. **Explicit attributes:** elements with `data-plot`, `data-plot-number`, or `id` matching patterns like `plot-12`, `plot_12`, `Plot12`, `P-12`, `12`, `A-12` (configurable regex per project).
2. **Grouped elements:** `<g id="plot-12">` containing shapes and a `<text>`; treat the group as one plot.
3. **Text-to-shape matching (fallback):** for SVGs with no ids, find all `<text>` elements that look like plot numbers, and match each to the closed shape (`path`, `polygon`, `rect`, `polyline`) whose area contains the text's position (use bounding box + point-in-polygon on the text anchor, accounting for `transform` attributes). If several shapes contain the point, choose the smallest.
4. **Ignore non-plot shapes:** roads, parks, boundary, legends, title blocks, compass. Detect them by large area outliers, ids/classes like `road`, `park`, `boundary`, `legend`, or by having no number. Allow the admin to override.

Handle `transform` (translate/scale/rotate/matrix) on shapes and parent groups, `viewBox`, and compound paths with curves (approximate with sampled points for geometry).

### 2.3 Automatic measurements
- For each detected plot compute: centroid, bounding box, polygon points, **area in SVG units**.
- Ask admin for a **scale calibration** once per map: either "1 SVG unit = X feet/meters" or "pick two points and enter the real distance". Then compute real **area** (sq ft / marla / kanal / sq m, configurable per organization) and **approximate side dimensions** (e.g. 30' x 60') from the polygon edges, and detect **corner plot** and **facing** (road side) when possible.
- Mark all auto-derived values as "calculated"; admin can override each with the **official** values from the approved layout. Show both when they differ.

### 2.4 Admin review screen (essential, the auto-detection will never be 100%)
- Shows the SVG with detected plots highlighted and a side table of plot number, detection method, area, confidence.
- Flags problems: duplicate plot numbers, plots with no number, numbers with no shape, overlapping shapes, suspiciously small or large areas.
- Admin can click a shape to assign/fix its plot number, merge or split, mark "not a plot", and bulk edit (block, phase, facing, price per unit area).
- Import/export plot data via CSV/Excel (plot number, block, size, dimensions, price, status) and match by plot number.
- "Publish map" only after validation passes (or admin accepts warnings).

---

## 3. DATA MODEL (extend the existing schema, use migrations)

- `project_maps`: id, organization_id, project_id, version, original_svg_path, sanitized_svg_path, view_box, scale_config (unit, ratio), status (draft/published), created_by, timestamps
- `plots`: id, organization_id, project_id, map_id, plot_number, block/phase/street, svg_element_id, polygon_points (JSON), centroid, area_calculated, area_official, dimensions_calculated, dimensions_official, facing, is_corner, category (residential/commercial), price_per_unit, total_price, status (`available`, `reserved`, `booked`, `sold`, `resale`, `blocked`), status_changed_at, timestamps. Unique (project_id, plot_number)
- `plot_bookings`: id, plot_id, client/lead_id, agent_id, token_amount, payment_plan, booking_date, expiry_date, status (pending/confirmed/cancelled/expired), notes
- `plot_sales`: id, plot_id, buyer_id, sale_price, sale_date, payment_status, documents, current_owner flag
- `plot_ownership_history`: plot_id, owner_id, from_date, to_date, transfer_type (sale/resale/inheritance), price
- `resale_listings`: id, plot_id, seller_id, asking_price, listed_date, status, notes, agent_id
- All money in integer minor units; every table carries `organization_id` and audit fields; every status change is written to the audit log.

---

## 4. INTERACTIVE MAP UI (new section: "Plot Map")

### 4.1 Rendering
- Render the sanitized SVG inline; attach interactions to the matched elements by `svg_element_id` (do not rely on the original ids being unique, generate stable internal ids).
- **Status colors** (colorblind-safe, with a legend; also show status by pattern or label, not color alone): Available = green, Reserved/Booked = amber, Sold = red, Resale = blue, Blocked = grey.
- Smooth **zoom and pan** (mouse wheel, drag, pinch on mobile, +/- buttons, "fit to screen"). Plot number labels scale or appear based on zoom level.
- **Search** by plot number (zooms to and highlights the plot), **filters** (status, block, size range, price range, facing, corner), live counts per status.
- Responsive: works on desktop, tablet, and phone (tap instead of hover).

### 4.2 Hover (desktop) / tap (mobile) tooltip
Show: plot number, block, size (official, with unit), dimensions, facing / corner flag, price (if the viewer's role may see it), and status badge. Follow the cursor, stay inside the viewport, appear instantly (under 100 ms), no flicker.

### 4.3 Click behavior by status
- **Available:** open the **Booking form** (side drawer or modal) prefilled with plot details.
- **Reserved / Booked:** show booking details (who, when, expiry) to authorized staff; public viewers see only "Reserved". Staff actions: confirm, cancel, extend hold, convert to sale.
- **Sold:** show sale details to authorized staff (owner name, contact, sale date, price, payment status, documents). Public viewers see only "Sold".
- **Resale:** show resale listing (asking price, seller/agent contact, listing date). Staff can edit, mark sold, or withdraw. Public viewers see the asking price and an "Inquire" button that creates a lead.
- **Blocked:** staff only; show the reason.
- Always include a link to the full plot page and its **ownership history / activity timeline**.

### 4.4 Booking form
Fields: client (search existing or create new: name, phone, CNIC/ID, email, address), plot (locked), booking type (reserve / book), token amount, payment plan (full / installment: down payment, number of installments, schedule preview), booking date, hold expiry, agent, notes, document upload (ID copy, payment receipt).
Behavior:
- Validate everything server-side and client-side.
- **Prevent double booking:** use a database transaction with row locking (or optimistic concurrency) on the plot; if two people submit at once, the second gets a clear "just booked" message and the map updates.
- On success: plot status changes, booking confirmation (PDF) is generated, token receipt/invoice is created in the existing billing module, a CRM deal/lead is linked, an audit entry is written, and notifications are sent.
- Expired holds automatically return the plot to Available via a scheduled job, with a notification.

### 4.5 Live updates
When any user changes a plot's status, other open map views update within seconds (WebSocket / SSE, with a polling fallback). Show a subtle toast when a plot changes while someone is viewing it.

---

## 5. ROLES AND PRIVACY

- **Public / portal visitors:** map with status, size, dimensions, and (if enabled) price; no buyer or owner personal data.
- **Agents:** can book available plots, see their own clients' bookings, and view resale listings.
- **Managers / admins / accountants:** full details, status overrides, sale and ownership records, exports.
- Enforce permissions in the **API**, not only the UI. Personal data (name, phone, ID) is never sent to the browser for roles that cannot see it.
- Organization-level toggle: show or hide prices on the public map.

---

## 6. OPTIONAL AI AGENT HOOKS (after the core works)

Register these as tools in the existing agent tool registry, with permissions and the approval queue:
- `search_plots(filters)`, `get_plot(plot_number)`, `create_booking_draft(plot, client)` (needs approval), `list_expiring_holds()`
- Lead Agent can suggest matching available plots to a lead's budget and size need and propose a viewing.
- Insights Agent can answer "which corner plots are still available under X?" through `search_plots`, never through raw SQL.

---

## 7. QUALITY REQUIREMENTS

- Performance: smooth with **1,000+ plots** per map (event delegation instead of per-plot listeners, avoid re-rendering the full SVG on every status change, lazy-load plot details on click).
- Accessibility: keyboard navigation between plots (Tab/arrow keys), Enter to open, ARIA labels (e.g. "Plot 12, 5 marla, available"), focus management in the drawer.
- Tests:
  - Unit: SVG sanitizer (including malicious samples), id/regex detection, text-to-shape matching, transform handling, area/dimension calculation, scale calibration.
  - Integration: upload → detect → review → publish; booking concurrency (two simultaneous bookings, one must fail); hold expiry job; permission checks per role.
  - E2E (Playwright): hover tooltip, click available → book, click sold → details, click resale → inquiry.
- Include **3 sample SVGs** in `/samples` (one with ids on plots, one with only text labels, one messy with transforms and curved boundaries) plus seed plots, so I can test immediately.
- Document: an "SVG preparation guide" for designers (recommended structure: each plot as one closed shape inside `<g id="plot-12">` with a text label, roads on a separate layer named `roads`), and update the user guide.

---

## 8. DELIVERY PHASES

| Phase | Scope | Done when |
|---|---|---|
| A | DB migrations, SVG upload + sanitizer, detection engine (all 4 strategies), unit tests | Sample SVGs detect correctly in tests |
| B | Scale calibration, measurements, admin review screen, CSV import/export, publish | I can upload, fix, and publish a map |
| C | Interactive map: render, colors, zoom/pan, search, filters, hover tooltip | Map works smoothly on desktop and phone |
| D | Click behaviors, booking form, double-booking protection, billing + CRM + audit + notifications | Full booking flow works end to end |
| E | Sold and resale details, ownership history, role-based privacy, live updates, hold-expiry job | Every status behaves per section 4.3 |
| F | Agent tools, E2E tests, performance pass, docs | Acceptance checklist below is complete |

**Start with Phase A: first summarize your plan (which files and modules you'll add, any conflicts with the existing schema), then implement.**

---

## 9. ACCEPTANCE CHECKLIST

- [ ] Uploading a sample SVG detects at least 95% of plots automatically; the rest are fixable in the review screen
- [ ] Malicious SVG content is stripped (tested)
- [ ] Hover shows number, size, dimensions, status; tap works on mobile
- [ ] Available plot → booking form → booking saved → plot turns amber/red instantly for all viewers
- [ ] Two simultaneous bookings of the same plot: exactly one succeeds
- [ ] Sold / resale / booked plots show the correct details by role, with no personal data leaking to public users
- [ ] Re-uploading an updated SVG keeps existing bookings and sales for matching plot numbers
- [ ] Smooth with 1,000+ plots; keyboard accessible; all tests green
