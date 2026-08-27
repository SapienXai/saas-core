# Reservevia plans, entitlements, and usage

Phase 3 establishes the product rules. Phase 4 connects Paddle as the payment and financial subscription provider without moving entitlement authority out of Reservevia.

## Source of truth

`public.plans` is authoritative for plan names, prices, limits, and feature capabilities. The forward migration `20260809155804_plans_subscriptions_and_usage.sql` seeds exactly four active keys:

| Plan | Price | Restaurants | Users | Reservations/period | History |
| --- | ---: | ---: | ---: | ---: | ---: |
| Free | $0 | 1 | 1 | 100 | 30 days |
| Starter | $19 | 1 | 3 | 500 | 365 days |
| Pro | $49 | 1 | 10 | Unlimited | Unlimited |
| Business | $99 | 3 | 20 | Unlimited | Unlimited |

Feature booleans are stored in the same plan row. The keys are `hostedRestaurantPage`, `emailNotifications`, `removeReserveviaBranding`, `customDomain`, `basicAnalytics`, `csvExport`, `guestHistory`, `automatedNotifications`, `advancedReports`, `customPWA`, `pushNotifications`, and `multiRestaurant`.

## Workspace state

`workspace_subscriptions` belongs to the workspace, not a user or restaurant. New workspaces receive Free automatically. The Felix Restaurants development workspace is assigned Business by migration data as a non-destructive grandfathered compatibility state; its four existing restaurants are retained even though Business allows only three new restaurants.

## Usage and quota integrity

`workspace_usage_periods` stores `(workspace_id, period_start, period_end)` and `reservations_created`. Every plan uses UTC calendar-month buckets. When a paid workspace becomes Free because of cancellation or an expired payment recovery window, its current-month usage remains in the same bucket; it is not reset or hidden.

Every successful reservation insert increments the current usage row in the same PostgreSQL transaction. The private trigger locks the usage row before checking the limit, so concurrent requests cannot produce usage 101 on Free or 501 on Starter. Failed inserts roll back the increment. Cancellation, no-show, completion, and deletion do not refund usage. Unlimited plans still record usage.

Quota errors are translated to a management message about the current period. Public guests receive a neutral temporary-unavailability message and never see plan or billing information.

## Application API

`lib/entitlements.ts` is the single server-side boundary:

```ts
can(workspaceId, feature)
getLimit(workspaceId, limit)
getUsage(workspaceId, metric)
getRemaining(workspaceId, metric)
getHistoryCutoff(workspaceId)
assertFeature(workspaceId, feature)
assertWithinLimit(workspaceId, limit)
```

Restaurant and member creation use centralized limit checks plus database triggers. Reservation email delivery is available on every current plan, including Free. Push calls remain entitlement-controlled; notification failure never rolls back a reservation. Hosted pages show subtle Reservevia credit only when `removeReserveviaBranding` is false.

Team seats use the existing `users` limit; there is no separate invitation entitlement. Active workspace members plus valid pending, non-expired, non-revoked invitations consume seats. Invitation creation and acceptance lock the workspace subscription row and recheck this sum, so parallel invitations cannot exceed the plan. Revoked/expired invitations free the reserved seat, while accepted invitations move a pending seat to an active member without double counting.

## History access

Reservation data is never physically deleted for a plan. Management reservation and report reads apply `getHistoryCutoff`; future reservations are always visible. RLS continues to enforce tenant ownership, while the service-role management actions apply commercial history visibility explicitly because they are privileged reads.

The inherited `/manage/reports` screen remains the compatibility/basic analytics surface in this phase. The `advancedReports` capability is already part of the catalog and entitlement API, but there is not yet a separate advanced-report module to gate without redesigning the existing report experience. Future advanced report surfaces must call `assertFeature(workspaceId, "advancedReports")` server-side.

## Development plan changes

Use only against the isolated local project:

```bash
npm run dev:set-plan -- test-restaurant-group starter
npm run dev:set-plan -- test-restaurant-group pro
npm run dev:set-plan -- test-restaurant-group business
npm run dev:set-plan -- test-restaurant-group free
```

The script refuses production mode and non-local Supabase URLs. It is not a user-facing plan-change API.

## Paddle synchronization boundary

Starter, Pro, and Business have monthly Paddle mappings in `billing_provider_prices`, separated by `sandbox` and `live`. Free has no Paddle price or normal Paddle API dependency. The server derives the workspace and approved mapping for checkout; the browser cannot submit a price ID or grant itself a plan.

The webhook route `POST /api/billing/paddle/webhook` verifies the exact raw body, writes a minimal durable inbox row to `billing_webhook_events`, and synchronizes `workspace_subscriptions`. The unique provider event ID makes delivery idempotent. `last_provider_event_at` prevents an older event from overwriting a newer one. Unknown prices, workspaces, subscriptions, or environments fail closed and leave local entitlements unchanged.

State behavior:

- `active` and `trialing`: purchased paid plan remains effective
- `past_due`: purchased paid plan remains effective during the 14-day recovery window; the owner sees the recovery deadline and can update payment details through Paddle
- expired payment recovery: effective entitlements move to Free, while reservations, usage, and provider history remain intact; a recovered payment restores the paid plan through the verified webhook
- `paused`: effective plan falls back to Free non-destructively
- scheduled `cancel`: paid plan remains effective until the period ends
- `canceled`: effective plan becomes Free; data and provider history remain intact

Owner-only server actions create checkout transactions, create temporary Customer Portal sessions, preview/submit paid-to-paid changes with Paddle's proration modes, and schedule cancellation. Checkout completion events never grant access. Application features continue reading `workspace_subscriptions` through `lib/entitlements.ts`; they never query Paddle directly.
