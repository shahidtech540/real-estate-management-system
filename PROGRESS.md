# Project Build Progress (`PROGRESS.md`)

## Phase Summary Matrix

| Phase | Scope | Status | Test Coverage | Checkpoint Deliverable |
|---|---|---|---|---|
| **Phase 0** | Plan, ERD, repo scaffold, Docker, CI, auth + RBAC + multi-tenancy | ✅ **COMPLETED** | **93.26%** | Multi-role login (`admin`, `agent`, `accountant`, `maintenance_staff`, `owner`, `tenant`), TOTP 2FA, RBAC matrix, multi-tenant & branch isolation, 32-table ERD & seed dataset |
| **Phase 1** | Properties, units, owners, documents vault, CSV import | ✅ **COMPLETED** | **91.44%** (12/12 tests passing) | Portfolio CRUD, hierarchy (`Property → Building → Unit`), multi-owner percentage splits (`<=100%`), Central Document Vault (`v1→v2` versioning, expiry alerts, view/download audit logs), Bulk CSV import with dry-run & row-by-row validation error report |
| **Phase 2** | Listings, public site, CRM (leads, viewings, deals) | ⏳ Next | — | Public listing search/filter, SEO pages, QR codes, portal feeds, Lead pipeline, viewing scheduler, deal commissions |
| **Phase 3** | Tenants, leases, invoicing, payments, receipts, owner statements | ⏳ Pending | — | Tenant KYC, lease lifecycle & PDF generator, recurring rent invoices, partial payments, arrears aging, owner statements |
| **Phase 4** | Maintenance, vendors, notifications | ⏳ Pending | — | Maintenance ticket lifecycle, SLA timers, vendor directory & work orders, preventive schedules, multi-channel notifications |
| **Phase 5** | Accounting, dashboards, reports, exports | ⏳ Pending | — | Chart of accounts, double-entry ledger, budget vs actual, executive KPIs, CSV/PDF exports |
| **Phase 6** | Agent orchestration layer, approval queue, audit, kill switch | ⏳ Pending | — | Tool registry, multi-step agent runner, human-in-the-loop approval queue, cost budgets, kill switches |
| **Phase 7** | Lead, Listing, Rent, Maintenance, Lease & Insights agents + eval suite | ⏳ Pending | — | All 6 domain AI agents + 120+ scenario & adversarial prompt-injection evaluation tests |
| **Phase 8** | Tenant/owner portals, hardening, performance, docs, deployment guide | ⏳ Pending | — | Dedicated Owner & Tenant portals, OWASP security hardening, OpenAPI spec, runbook, user guides |

---

## Phase 1 Detailed Completion Log

### What Was Built
1. **Property, Building & Unit Hierarchy (`src/server/modules/portfolio/portfolio.service.ts`, `/api/v1/properties`, `/api/v1/buildings`, `/api/v1/units`)**:
   - Full hierarchy (`Property → Building → Unit`) with unit status breakdown (`available`, `rented`, `sold`, `under_maintenance`), search/type/city filtering, and live status updates.
   - Supports residential plots, houses, commercial shops, apartments, and offices with area stored in `area_sqft` and `area_display` (`10 Marla`, `1 Kanal`, `450 Sq.Ft.`) and prices in integer PKR minor units.
2. **Multi-Owner Records & Ownership Percentage Splits (`/api/v1/owners`)**:
   - Properties support multiple co-owners (`property_owners` table with `ownership_pct` and `is_primary`).
   - Seeded co-ownership splits on *Fahad Garden Housing Scheme* (`70%` Malik Fahad Nawaz / `30%` Chaudhry Abdullah Khan) and *Taj Commercial Center* (`60%` Begum Samina Taj / `40%` Malik Fahad Nawaz).
   - Server-side validation prevents total ownership percentages on any property from exceeding `100%`.
3. **Bulk CSV Import with Validation & Error Report (`/api/v1/portfolio/import-csv`)**:
   - Supports both **Dry-Run Validation** (`dryRun: true`) and **Commit Import** (`dryRun: false`).
   - Validates required headers, property codes, duplicate unit numbers, unit types, status enums, positive area, and PKR values, returning a structured `{ totalRows, validCount, importedCount, failedCount, errors: [{ rowNumber, field, message, rawRow }] }` report.
4. **Central Document Vault (`src/server/modules/documents/documents.service.ts`, `/api/v1/documents`, `/api/v1/documents/[id]/access`)**:
   - Seeded with 6 realistic Pakistani real estate documents (LDA/RDA/CDA NOCs, Trade Licences, Floor Plans, Title Deeds, Insurance Policies, and FBR KYC dossiers).
   - Automatic version increment (`v1 → v2 → v3`) when uploading a newer version of a document for the same entity and title.
   - Computed expiry alerts (`valid`, `expiring_soon` <= 60 days, `expired`, `no_expiry`).
   - Every view or download generates a signed URL and logs `document.viewed` or `document.downloaded` in `audit_logs`.
5. **Interactive Phase 1 Dashboard Tabs (`src/app/dashboard/page.tsx`)**:
   - **Portfolio & Units**: Filter properties, click any property to filter its units, create properties/units, and update unit statuses inline.
   - **Owners & Splits**: View owner holdings, register new owners, and configure multi-owner property splits.
   - **Document Vault**: Search/filter documents by category and expiry status, upload new documents/versions, and trigger audited View/Download actions.
   - **Bulk CSV Import Studio**: One-click sample valid CSV and sample mixed-error CSV loaders with Dry-Run and Commit buttons and a live error table.

---

## Phase 0 Detailed Completion Log

### What Was Built
1. **Master Engineering Plan & Decisions (`docs/PLAN.md`, `DECISIONS.md`)**
2. **Complete 32-Table Entity-Relationship Diagram & Schema (`docs/ERD.md`, `prisma/schema.prisma`, `src/server/db/schema.ts`)**
3. **Demo Seed Dataset (`src/server/db/seed.ts`)**
4. **Authentication, RBAC, Optional 2FA & Multi-Tenancy (`src/server/auth/`, `src/server/modules/`)**
5. **Responsive Bilingual UI (`src/app/login/page.tsx`, `src/app/dashboard/page.tsx`)**
6. **Docker, CI & Automated Tests (`Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `tests/phase0.test.ts`)**
