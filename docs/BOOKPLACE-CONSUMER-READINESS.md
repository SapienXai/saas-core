# BookPlace consumer readiness

The Core 2.7.0 candidate uses schema compatibility coordinate **2.0**. The
review started from main at
`8a879fb5554af1f2975ec533d777e8811adb8443` and reviewed the seven-commit Paddle
branch through `d3239435850915d0b7bddfa0bdf6e30fadeba2df`. The tested
implementation is commit `8532ccb39c886cafb16f32bc4d08c9257d902841`.

BookPlace can start with one Core Workspace per property. The product owns
the property profile, room and room-type inventory, guest identities, stays,
reservations, rates, availability, housekeeping, reports, folios, and guest
payments. Platform subscription payments are Core billing. Guest payments
belong to the BookPlace booking and folio workflows.

## Capability assessment

| Requirement | Status | Evidence | BookPlace work |
| --- | --- | --- | --- |
| Hotel registration | Verified locally | Auth integration and browser signup, confirmation delivery, sign-in and atomic onboarding | Add property setup after Workspace bootstrap and configure confirmation delivery |
| Hotel identity | Consumer implementation | Workspace bootstrap, authorized selection, tenant-owned schema and product home proof | Store property profile in a product table keyed by `workspace_id` |
| Employees | Verified locally | Core RLS, invitation redemption and replay denial, finite membership limits and staff mutation denial | Map staff roles to PMS operations and apply RLS to each product table |
| Free PMS plan | Verified locally | Default catalog bootstrap and browser Plan & Usage without billing credentials | Configure features and a finite employee limit in the product catalog |
| Ten active rooms | Consumer implementation | The disposable consumer's generic quota transaction serializes two writes competing for one slot | Count active rooms in the same database transaction that locks entitlement and consumes quota |
| Hotel subdomain | Verified locally | Unique platform claim, reserved label rules, canonical hostname and inactive or unknown routing tests | Configure wildcard DNS, TLS, and the correct Vercel project |
| Public booking website | Consumer implementation | Host-to-Site-to-Workspace resolution and a disposable consumer renderer that uses the resolved Workspace | Publish tenant-safe availability and booking endpoints with separate product authorization and abuse controls |
| Booking notifications | Consumer implementation | Shared delivery infrastructure and local Auth email capture | Add product templates, enqueue product events and verify provider delivery |
| Platform management | Verified locally | Platform table isolation and browser readiness surface | Configure an authorized platform owner and add product support views if needed |
| Upgrade to paid | Partially verified | Stripe regressions and mocked Paddle adapter and local Supabase reconciliation tests | Select one provider and certify its Sandbox checkout, renewal, portal and deployment |
| Product database | Verified locally | Flat product migration and tenant-linked fixture table with RLS and authenticated isolation | Define product schema, migrations and access policies |
| Future feature upgrades | Verified locally | Arbitrary catalog keys, explicit unlimited and missing-value behavior, provider-period and fallback tests | Define feature policy and authoritative product usage resolvers |
| Future custom domains | Partially verified | Local domain verification state, canonical mapping and cross-tenant checks | Configure and verify Vercel/DNS ownership and gate custom-domain requests in the catalog |

## Quotas and tenancy

The disposable product uses a flat migration and a service-only write RPC.
The RPC calls `lock_workspace_entitlement`, counts rows scoped to the
Workspace and inserts in one transaction. The product resolver uses the same
Workspace-owned resource table for display. Existing rows survive a downgrade
or cancellation. New resource creation is blocked when current usage reaches
the new ceiling. BookPlace must use the transactional path for room creation
and for any status change that increments the active count.

The product must enforce Workspace membership and the appropriate role on
every authenticated mutation. Tenant tables need a Workspace foreign key,
index, grants and RLS. Public handlers get the Workspace from the trusted
hostname and must apply the product's publication and reservation policies
to every query and write.

## Deployment

Attach `bookplace.app`, `app.bookplace.app`, and `*.bookplace.app` to the
intended projects. Configure the marketing/apex and application origins,
delegate wildcard DNS using the Vercel-required method, and verify TLS with
real assigned hostnames. Configure the app's Auth URLs and callback allowlist.
Core stores an exact platform hostname mapping per published site. Public
resolution uses the ingress Host and the persisted domain, site and Workspace.
A direct proxy must forward the intended Host. Forwarded-host opt-in requires
an ingress that replaces client-supplied values and blocks direct origin
access. See [Vercel wildcard domains](https://vercel.com/docs/domains/working-with-domains)
and [Vercel request headers](https://vercel.com/docs/headers/request-headers).

## Reproduction

```sh
pnpm install --frozen-lockfile
pnpm verify
pnpm db:start:ci
pnpm db:test:clean
pnpm db:test:schema
pnpm core:lifecycle
pnpm core:pack
pnpm release:packages
pnpm core:consumer-proof
pnpm auth:e2e
pnpm e2e:critical
SAAS_CORE_FULL_E2E=1 pnpm e2e:full
```

The lifecycle proof checks `init`, `doctor`, `diff`, dry-run and apply,
ownership preservation, managed conflicts, rollback and schema-coordinate
stability. The packed proof passed against a disposable registry and local Supabase
projects. It verified flat product migration execution after a separate
database command, then reinstalled and rebuilt the relocated consumer. See [the release verification record](./CORE-2.7.0-READINESS.md)
for command results and provider gaps.
