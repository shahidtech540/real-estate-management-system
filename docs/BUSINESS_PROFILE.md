# Confirmed business profile — Fahad Real Estate

This correction overrides the original generic business/demo assumptions. It is
not Phase 5 work.

- Company and office: **Fahad Real Estate**.
- Only office location: **Rahim Yar Khan, Punjab, Pakistan**.
- Projects: **Fahad Garden Housing Scheme**, **Abdullah City**, **Taj Commercial
  Center**, **VIP Block**, **University Commercial Centers** — all in Rahim Yar Khan.
- Street addresses, exact coordinates, tax registration, approvals, phone and
  operational email/domain are unknown. General city-level addresses are used;
  old invented coordinates, tax registration and approval claims are removed.
- Six sample roles use `@fahadrealestate.test`; this reserved domain does not
  represent a real company mailbox. Passwords/identities remain demo credentials.

## Existing-database correction

`src/server/db/business-profile.ts` runs after the schema and seeds in the normal
runtime. A transaction and feature-migration marker make it one-time/idempotent.
It also runs on fresh installations before any application data is returned.

- Retain stable primary organization/user/unit IDs so existing foreign keys and
  primary-company sessions remain valid. The internal legacy `org_pakland` key is
  deliberately **not** the visible company identity.
- Create `br_ryk`; move primary-company user/property/lead branch references to it;
  archive the other offices. The dashboard exposes one disabled office selector
  and no “add regional branch” form. Underlying multi-tenancy/RBAC services remain
  intact for isolation and future explicitly authorized configuration.
- Correct the five named projects' city/address and clear fictional coordinates.
- Consolidate only the five known invented demo sub-projects:

| Invented demo record | Confirmed parent project |
|---|---|
| Fahad Garden Overseas Block | Fahad Garden Housing Scheme |
| Abdullah City Golf Villas | Abdullah City |
| Taj Trade Tower & Galleria | Taj Commercial Center |
| VIP Block Executive Villas | VIP Block |
| University IT & Corporate Plaza | University Commercial Centers |

Reparent buildings, units, listings, leases, invoices, tickets and property-linked
vault metadata; archive the old property/ownership records rather than delete
history. Keep unit numbers, money, transaction references, lease terms and payment
rows. Existing **paid statements, ledger entries and audit history are immutable**
and retain their original historical references. New operational statements use
the confirmed parent project's existing *demo* ownership allocations. These
allocations are sample data, not verified ownership transfers or legal claims;
replace them with actual ownership before using the system for real accounting.

The eight known seeded listings are relabeled as sample inventory against their
actual unit's parent project (the initial seed had mismatched property/unit links).
Their sample slugs are corrected; old seed-only listing URLs are not retained.
Known seeded legal/identity-document descriptions are marked unverified rather
than claiming authentic approvals. Actual uploaded records are not deleted.

The unrelated `org_indus` demo company and its user/branch/property are retired,
refresh sessions revoked, and old access tokens rejected by active-user/company
checks. Data is archived rather than erased. Login cards/switcher show only the six
primary demo roles. Old `@pakland.pk` aliases still sign in to the same demo users.

Before applying this change to the preserved preview database, a SQLite backup was
made at `data/before-fahad-profile.sqlite` (ignored local data, not a Git artifact).
Take equivalent backups of your own database before deploying a migration.

## Regression coverage

Unit/integration tests cover one company/office, the five project names, city and
null coordinates, migration idempotency, foreign keys, all six role sign-ins,
legacy aliases, retired-company token rejection, preserved invoice/payment/lease
values and immutable paid statements. Browser tests inspect the real production
profile, login cards, office/project controls, portal and listing detail content.
The original larger multi-company fixture remains **test-only** for generic RBAC
and isolation regressions. It is never the preview/production business setup.

## Boundaries

Do not treat remaining sample units, prices, tenants, vendors, KYC or financial
history as real business records. Do not add office addresses or claim regulatory
approval without supplied evidence. Phase 5 and merging PR #2 remain on hold.
