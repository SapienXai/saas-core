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

## Workspace isolation

`workspace_members` is the tenancy boundary. `lib/authorization.ts` rechecks
membership and role for every protected server action. Public Core tables use
RLS predicates based on `auth.uid()`, active Workspace status, and membership.
Owner/admin operations use explicit role checks. Viewer/read-only roles cannot
mutate membership or Workspace settings.

Product records must reference `workspaces(id)` and use their own policies.
Cross-Workspace reads, writes, invitation acceptance, and domain changes must
be denied even if a caller knows another Workspace UUID.

## Platform and service roles

Platform Control is a separate membership plane. Platform tables revoke access
from `anon` and `authenticated`; the server-only service role is used only
after `requirePlatformRole()` succeeds. Delivery and provider tables follow
the same server-only pattern.

The repository has no `NEXT_PUBLIC_*` service-role value. `SUPABASE_SERVICE_ROLE_KEY`
is read only from server-only modules and never imported by client components.
The catalog synchronization command is a server-only Node process and rejects
public/anonymous keys; provider price mappings are not changed by plan catalog
upserts.
Environment diagnostics expose presence/length metadata only to an authorized
development operator and never return secret values.

## Billing and providers

Paddle webhook requests require signature validation. Provider events are
idempotent and ordered before local subscription state changes. Entitlements
come from the local subscription projection, not a browser callback. Live
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
