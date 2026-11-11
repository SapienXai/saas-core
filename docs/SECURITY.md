# Security

SaaS Core keeps authorization at the server and database boundaries. The
browser may request an action, but it does not decide whether that action is
allowed.

## Identity and redirects

Supabase SSR cookies are managed in server-only clients. Signup confirmation,
recovery, invitation acceptance, and session redirects accept only validated
internal destinations. The current user is derived from the verified session;
owner IDs, Workspace IDs, roles, and plan state are not trusted from browser
input.

## Content Security Policy

The canonical Next.js config sets the response security headers and the
default Content Security Policy. Products can add exact HTTPS `frame-src`
origins in the product-owned `src/product/security-config.json` extension;
all other directives remain Core-owned. The build validates each origin and
fails on malformed values rather than accepting arbitrary CSP fragments.

## Workspace isolation

`workspace_members` is the tenancy boundary. `lib/authorization.ts` rechecks
membership and role for every protected server action. Public Core tables use
RLS predicates based on `auth.uid()`, active Workspace status, and membership.
Owner/admin operations use explicit role checks. Viewer/read-only roles cannot
mutate membership or Workspace settings.

Product records must reference `workspaces(id)` and use their own policies.
Cross-Workspace reads, writes, invitation acceptance, and domain changes must
be denied even if a caller knows another Workspace UUID.

## Public Workspace routing

The shared extractor uses the ingress `Host` by default and validates its
shape before the proxy or resolver selects a public Workspace. A deployment
can opt into the first `X-Forwarded-Host` value with
`SAAS_CORE_TRUST_FORWARDED_HOST=true` when the ingress replaces that header and
blocks direct access to the origin. Query parameters, cookies, form fields,
and client-supplied Workspace IDs have no authority over public tenant selection.

All public hosts resolve through the exact persisted chain
`workspace_domains → public_sites → workspaces`. Platform rows must be active
`platform_subdomain` mappings; custom rows additionally require the existing
production/provider verification flags and `verified_at`. The result includes
the Workspace, public-site ID, and `product_key`; it never treats a product as
the domain owner or a hostname slug as a tenant identifier. Any unknown,
pending, failed, or non-public mapping returns `not_found` and fails closed. A
persistence or service failure returns the generic `unavailable` result
instead of being misreported as tenant absence; raw database/provider details
are never sent to the public client. The resolver performs no provider or DNS
calls during public page resolution.

Canonical app ownership is separate from reserved public/system ownership.
Tenant/custom hosts redirect `/app/*`, `/manage`, `/platform`, Paddle checkout, and Core auth or
onboarding paths to the canonical app domain; product-owned public paths stay
on their public hostname. Standard URL pathname normalization is performed
before route ownership checks, preventing dot-segment bypasses. `/api`,
`/_next`, manifest, PWA, and static asset paths remain protected system
surfaces.

Development nip.io trust is narrow and environment-gated. Only a dotted
loopback/private IPv4 with at most one leading app, reserved, or Workspace
label is accepted; unsupported `*.nip.io` hosts are rejected from the trusted
request-host boundary. In development, a supported Workspace alias is
normalized and must still match a canonical platform-domain row; the root and
app aliases use the same platform route model. In production, all nip.io
aliases are untrusted and cannot masquerade as platform hosts or become
persisted customer domains. Raw private LAN addresses are converted to nip.io
only for reachable development Auth/origin targets; the active port is
retained.

## Platform and service roles

Platform Control is a separate membership plane. Platform tables revoke access
from `anon` and `authenticated`; the server-only service role is used only
after `requirePlatformRole()` succeeds. Delivery and provider tables follow
the same server-only pattern.

`PLATFORM_OWNER_EMAIL` is a server-side bootstrap hint, not a browser role or
authorization input. A matching authenticated account can receive the initial
`platform_owner` membership through the server resolver. Production readiness
views expose only role/access state to ordinary users; the configured email is
shown only to trusted development or already-authorized platform operators.
Workspace roles remain independent, so platform authority never silently
becomes Workspace ownership.

The repository has no `NEXT_PUBLIC_*` service-role value. `SUPABASE_SERVICE_ROLE_KEY`
is read only from server-only modules and never imported by client components.
The catalog synchronization command is a server-only Node process and rejects
public/anonymous keys; provider price mappings are not changed by plan catalog
upserts.
Environment diagnostics expose presence/length metadata only to an authorized
development operator and never return secret values.

## Billing and providers

Stripe and Paddle webhook requests require signature validation against the
raw request body. Core stores provider- and environment-scoped receipts with
leases and retry limits. The worker re-reads the authoritative subscription
under a Workspace projection lease and retains the newest event marker. The
verified local subscription projection controls entitlement grants. Live
provider mutations and reconciliation require explicit environment guards.
Vercel domain operations are isolated behind a server-only provider module;
provider verification cannot be marked complete by the browser.

## Email, push, and PWA

Email delivery stores bounded payloads, leases, attempts, and provider event
ordering. Webhook signatures are verified before delivery state changes.
Push subscription writes derive user and Workspace from the session, validate
the payload, check entitlement, and reject mismatched origins.

The service worker caches only safe static/application-shell resources. It does
not persist session, billing, membership, or product-domain data. Logout asks
the worker to clear its cache and revokes the current push subscription.

The Core schema version is stored in `private.core_schema_metadata`. Normal
clients have no table access and no execute permission for the metadata RPC;
the tooling doctor uses the service-role key only from its server-side process.
The product default plan is likewise stored in the private Core settings table
and can only be changed through the service-role-only catalog synchronization
RPC. A public or anonymous key is rejected.

The generated starter catalog requires an explicit `core.workspaces` limit on
its default plan. Workspace bootstrap checks the effective plan and returns a
clear limit/configuration error; it does not depend on a `created_by` unique
index or select an arbitrary plan by sort order.

## Verification

Run the clean database and security checks locally:

```bash
pnpm db:reset
pnpm db:test:schema
pnpm db:test:clean
pnpm core:scan
```

The integration suite proves owner bootstrap, cross-Workspace denial, one-use
invitation acceptance/replay rejection, and platform table protection. A
product adding a domain must add equivalent positive and negative tests.
