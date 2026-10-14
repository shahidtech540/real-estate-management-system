# Project Build Progress (`PROGRESS.md`)

## Phase Summary Matrix

| Phase | Scope | Status | Test Coverage | Checkpoint Deliverable |
|---|---|---|---|---|
| **Phase 0** | Plan, ERD, repo scaffold, Docker, CI, auth + RBAC + multi-tenancy | ✅ **COMPLETED** | **93.26%** (6/6 test suites passing) | Multi-role login (`admin`, `agent`, `accountant`, `maintenance_staff`, `owner`, `tenant`), TOTP 2FA, RBAC matrix, multi-tenant & branch isolation, 32-table ERD & seed dataset |
| **Phase 1** | Properties, units, owners, documents vault, CSV import | ⏳ Next | — | Portfolio CRUD, hierarchy (Property → Building → Unit), multi-owner splits, document vault, CSV import with validation report |
| **Phase 2** | Listings, public site, CRM (leads, viewings, deals) | ⏳ Pending | — | Public listing search/filter, SEO pages, QR codes, portal feeds, Lead pipeline, viewing scheduler, deal commissions |
| **Phase 3** | Tenants, leases, invoicing, payments, receipts, owner statements | ⏳ Pending | — | Tenant KYC, lease lifecycle & PDF generator, recurring rent invoices, partial payments, arrears aging, owner statements |
| **Phase 4** | Maintenance, vendors, notifications | ⏳ Pending | — | Maintenance ticket lifecycle, SLA timers, vendor directory & work orders, preventive schedules, multi-channel notifications |
| **Phase 5** | Accounting, dashboards, reports, exports | ⏳ Pending | — | Chart of accounts, double-entry ledger, budget vs actual, executive KPIs, CSV/PDF exports |
| **Phase 6** | Agent orchestration layer, approval queue, audit, kill switch | ⏳ Pending | — | Tool registry, multi-step agent runner, human-in-the-loop approval queue, cost budgets, kill switches |
| **Phase 7** | Lead, Listing, Rent, Maintenance, Lease & Insights agents + eval suite | ⏳ Pending | — | All 6 domain AI agents + 120+ scenario & adversarial prompt-injection evaluation tests |
| **Phase 8** | Tenant/owner portals, hardening, performance, docs, deployment guide | ⏳ Pending | — | Dedicated Owner & Tenant portals, OWASP security hardening, OpenAPI spec, runbook, user guides |

---

## Phase 0 Detailed Completion Log

### What Was Built
1. **Master Engineering Plan & Decisions (`docs/PLAN.md`, `DECISIONS.md`)**:
   - Mermaid system architecture diagram, stack justification, folder structure, risk register, and Pakistani real estate domain defaults (PKR integer minor units, English LTR + Urdu RTL bilingual support, 5 flagship projects + 5 sub-projects).
2. **Complete 32-Table Entity-Relationship Diagram & Schema (`docs/ERD.md`, `prisma/schema.prisma`, `src/server/db/schema.ts`)**:
   - Covers `Organization`, `Branch`, `Role`, `Permission`, `RolePermission`, `User`, `RefreshToken`, `Owner`, `Property`, `PropertyOwner`, `Building`, `Unit`, `Listing`, `Lead`, `Client`, `Viewing`, `Deal`, `Tenant`, `Lease`, `Invoice`, `Payment`, `Receipt`, `Account`, `LedgerEntry`, `Vendor`, `MaintenanceTicket`, `WorkOrder`, `Document`, `Notification`, `AuditLog`, `Agent`, `AgentRun`, `ToolCall`, and `ApprovalRequest`.
   - Every domain table enforces `organization_id`, `created_at`, `updated_at`, `created_by`, `deleted_at`, and integer minor-unit currency storage.
3. **Demo Seed Dataset (`src/server/db/seed.ts`)**:
   - **2 Organizations**: `PakLand Developers & Builders` (`org_pakland`) and `Indus Valley Estates` (`org_indus`).
   - **3 Branches**: Islamabad Head Office, Rawalpindi Regional Office, Lahore Gulberg Branch.
   - **6 Roles & 36 Granular Permissions**: `admin`, `agent`, `accountant`, `maintenance_staff`, `owner`, `tenant`.
   - **3 Owners**, **10 Properties** (including *Fahad Garden Housing Scheme*, *Abdullah City*, *Taj Commercial Center*, *VIP Block*, *University Commercial Centers*), **30 Units**, **20 Tenants**, **20 Active Leases**, **240 Invoices** (12 months), and **6 AI Agents**.
4. **Authentication, RBAC, Optional 2FA & Multi-Tenancy (`src/server/auth/`, `src/server/modules/`)**:
   - HMAC-SHA256 JWT Access Tokens + Stateful Refresh Token rotation & revocation.
   - Native RFC 6238 TOTP Two-Factor Authentication (`setup`, `verify`, `disable`, login challenge).
   - Server-side `requireAuth`, `requirePermission`, and `assertTenantIsolation` guards with automatic security audit logging.
5. **Responsive Bilingual UI (`src/app/login/page.tsx`, `src/app/dashboard/page.tsx`)**:
   - Multi-role login screen with one-click demo role cards and 2FA challenge support.
   - Role-aware workspace with live KPIs, Instant Role Switcher, Branch Switcher, English (`LTR`) / Urdu (`RTL`) toggle, interactive 36×6 RBAC Permission Matrix, User & Branch management, 2FA configuration, and live Audit Log viewer.
6. **Docker, CI & Automated Tests (`Dockerfile`, `docker-compose.yml`, `.github/workflows/ci.yml`, `tests/phase0.test.ts`)**:
   - All unit & integration tests passing with **93.26% statement coverage**.
