# Reservevia Platform Administration

Reservevia has two authorization layers:

1. Workspace membership controls a customer's access to their restaurants (`owner`, `admin`, `manager`, `staff`, `readonly`).
2. Platform membership controls Reservevia staff access to the `/platform` control plane.

Workspace ownership does not grant platform access.

## Platform roles

| Role | Scope |
| --- | --- |
| `platform_owner` | Full platform access, platform team and settings |
| `platform_admin` | Users, workspaces and restaurants; no billing or platform team management |
| `billing_admin` | Plan catalog and manual entitlement overrides |
| `support` | Read-only operational access |
| `auditor` | Read-only access, including audit history |

The server resolves the role from `platform_members` with the service-role client. Browser payloads, user metadata and workspace roles are never trusted for platform authorization.

## Bootstrap

Set the server-only `PLATFORM_OWNER_EMAIL` deployment variable to the verified Supabase Auth email of the initial operator. On that user's first authenticated request after the migration, Reservevia creates an idempotent `platform_owner` membership. The value is not returned to the browser and does not automatically promote existing workspace administrators.

## `/platform`

The platform panel is intentionally a separate path rather than a workspace view. It includes:

- overview metrics and plan distribution;
- searchable users, workspaces and restaurants;
- suspend/reactivate controls with required reasons;
- plan catalog editing and time-bounded subscription overrides;
- platform audit history;
- non-secret operational settings;
- platform staff role management for the owner.

The Restaurants area also powers the claimable-restaurant acquisition workflow. Platform owners and platform admins can add a live, unclaimed restaurant, download the XLSX template, validate and preview a server-parsed import, and confirm a row-level idempotent batch. Restaurant detail pages show private business-contact and claim data only inside the platform control plane. Support and auditor remain read-only. See [CLAIMABLE-RESTAURANTS.md](./CLAIMABLE-RESTAURANTS.md) for the ownership, privacy, reservation, and recovery rules.

The Excel dialog has two explicit modes. `Create new restaurants` provisions new workspaces and claimable restaurants. `Update existing restaurants` matches only platform-created restaurants by public slug or unique private business email, previews the match, and updates the existing restaurant in place. It never changes `restaurants.workspace_id` or the public slug, and blank cells in update mode leave the existing value unchanged. Duplicate workbook rows that target the same restaurant are rejected before confirmation.

All mutations write `platform_audit_logs`. User/workspace/restaurant suspension is a platform moderation state and does not delete data. Restaurant publishing remains controlled by the existing `restaurants.status` field, while platform suspension blocks public restaurant rendering and public reservation edits/creation.

## Billing boundary

`plans` remains the entitlement catalog and `workspace_subscriptions` remains the current commercial state. `subscription_overrides` is checked first for an active effective interval. Platform billing actions change only that local override or catalog; they do not mutate Paddle subscriptions. Existing data is preserved when a plan is reduced, and the existing quota checks prevent new writes beyond the effective limit.

## Operational requirements

- Apply `20260810214013_platform_admin_foundation.sql` before using `/platform`.
- Apply `20260813130000_claimable_restaurants.sql` before using claimable restaurant creation, import, claim, or reservation-management flows.
- Apply `20260813141006_platform_restaurant_import_updates.sql` before using the Excel update mode. Regenerate local Supabase types and the production bootstrap schema after applying migrations.
- Keep `SUPABASE_SERVICE_ROLE_KEY` and all provider secrets server-only.
- Require a reason for suspensions, plan changes, overrides and role changes.
- Review the audit log for every privileged action.
- MFA/re-authentication should be enforced at the deployment/identity layer before granting production platform-owner access; v1 deliberately does not add impersonation.
