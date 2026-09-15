# SaaS Core 2.5.0 coordinated release boundary

The tagged coordinated release uses runtime/package coordinate `2.5.0` and
Core schema compatibility coordinate `2.0`. The tag is the release anchor;
the checked-out `main` branch may contain post-tag fixes and developer
experience changes that are not part of the immutable tag. Confirm the exact
package, source and registry identity before calling a build a public release.

## Highlights

- The provider-neutral Core package exports the typed
  `PlanChangeEligibility` contract and `evaluatePlanChangeEligibility()`.
- The managed server entitlement layer resolves target-plan limits against
  authoritative Core and product usage. Missing configuration and unavailable
  usage fail closed; only explicit `null` is unlimited.
- Paddle downgrade preview checks eligibility and confirmation revalidates it
  immediately before scheduling or calling the provider mutation. Upgrades
  remain unaffected, and cancellation remains available when usage exceeds a
  fallback limit.
- The managed billing UI reports dynamic target-plan violations without
  turning an ineligible downgrade into a confirmable provider action.
- An explicit pending downgrade keeps the current plan and features active but
  immediately caps new finite-quota consumption at the stricter target limit;
  scheduled cancellation retains current-plan limits until its boundary.
- The canonical template and CLI continue to carry the additive Core-managed
  migration sources, including
  `20260914110000_fix_renew_workspace_invitation.sql` and
  `20260914185445_scheduled_downgrade_consumption_ceiling.sql`.
- The current root/template source set also mirrors the platform-owner lockout
  guard and the additive fail-closed scheduled-downgrade replacement:
  `20260830150000_saas_core_platform_user_guards.sql` and
  `20260915090000_fix_invalid_scheduled_downgrade_fail_closed.sql`.

## Package versions

| Package | Version |
| --- | --- |
| `@sapienx/saas-core` | `2.5.0` |
| `@sapienx/saas-core-config` | `2.5.0` |
| `@sapienx/saas-core-ui` | `2.5.0` |
| `@sapienx/saas-core-app` | `2.5.0` |
| `@sapienx/saas-core-cli` | `2.5.0` |

## Schema and consumer delivery

The release remains additive and keeps schema compatibility coordinate `2.0`.
Core packages and the CLI deliver migration source only; they never execute a
consumer migration. The managed set includes:

- `supabase/migrations/20260909094344_reusable_billing_persistence.sql`
- `supabase/migrations/20260912100000_reusable_entitlement_enforcement.sql`
- `supabase/migrations/20260914100000_reusable_plan_catalog_management.sql`
- `supabase/migrations/20260914110000_fix_renew_workspace_invitation.sql`
- `supabase/migrations/20260914185445_scheduled_downgrade_consumption_ceiling.sql`
- `supabase/migrations/20260915090000_fix_invalid_scheduled_downgrade_fail_closed.sql`

The baseline, deferred-onboarding and platform-owner guard migrations are also
direct Core sources in the canonical template. The full current list is
checked by `pnpm core:source-parity`; this release note retains the billing
focus of the `2.5.0` boundary.

Products define their own commercial limits and product usage resolvers. A
consumer must apply and verify these sources through its controlled database
workflow, preserve product-owned files, and use the server-side eligibility
contract before offering an explicit downgrade.

## Scope

This document describes the coordinated `2.5.0` release boundary; it does not
publish, push, tag, deploy, or modify PlaceDJ or ReserveVia. The checked-out
`main` branch contains post-tag source-parity and fail-closed fixes that remain
unreleased until a new coordinated tag is created. This document does not
define consumer commercial limits or apply consumer migrations.
