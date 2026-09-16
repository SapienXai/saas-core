# Billing parity: ReserveVia to SaaS Core

This is the concise extraction audit for the reusable subscription boundary.
ReserveVia and PlaceDJ were read-only references; neither consumer is changed
by Phase 1.

| Capability | ReserveVia reference behavior | SaaS Core Phase 1 result | Status / note |
| --- | --- | --- | --- |
| Plan model | Product-defined Free, Starter, Pro, and Business catalog with prices and feature/limit copy. | `ProductCatalog` accepts arbitrary product plan keys, descriptions, ordering, recommendation metadata, month/year prices, boolean features, numeric limits, and explicit `null` unlimited limits. | Extracted generically; commercial values stay product-owned. |
| Current plan | Workspace-scoped current subscription and visible scheduled change. | `workspace_subscriptions` remains workspace-owned; `getEffectivePlan`/`getEntitlements` expose current and scheduled plan state. | Parity retained. |
| Plan comparison | Responsive feature/limit comparison and selected-plan preview. | Managed plan UI renders configured plan order, comparison rows, feature labels, and every configured limit. | Extracted and configuration-driven. |
| Upgrade | Owner-only Paddle preview, immediate/prorated provider change, access after verified sync. | Existing server actions keep owner authorization, server price mapping, preview, durable transition, and webhook-confirmed projection. | Preserved; no client-supplied plan or price is trusted. |
| Downgrade | Next-period change; current access remains until the effective boundary; undo is supported. | Scheduled target/effective timestamp remains in the local projection. Existing resources are retained and new over-limit consumption is rejected. | Safe over-limit behavior documented and enforced. |
| Downgrade eligibility | A lower plan must be able to accommodate current usage before a scheduled change is confirmed. | Provider-neutral target-plan eligibility compares authoritative Core/product usage with finite target limits; preview and confirmation both check it, while `null` remains unlimited. | Added as a reusable server/public contract; ineligible changes never call the provider mutation. |
| Cancellation | Scheduled for period end; service remains active until the provider boundary; resume clears it. | Cancellation and resume use the existing Paddle lifecycle and local scheduled state. Effective entitlements fall back after cancellation. | Preserved and fail-closed. |
| Usage | Authoritative workspace/member and product-domain usage; calendar-period counters where appropriate. | Core resolves workspace/member usage and composes the product-owned `src/product/usage.ts` resolver registry; persisted generic metrics remain keyed by capability. | Core owns public hostname-domain queries and writes; consumers own domain-specific usage queries and writes. Missing or failed product usage is unavailable, never zero. |
| Feature gating | Central `can`, `getLimit`, `getUsage`, and assertion helpers. | `hasFeature`, `getLimit`, `getUsage`, `getEntitlement`, `getUsageSnapshot`, and `canConsume` share one normalized evaluator. | Extracted as a provider-neutral API. |
| Limits | Finite quotas, unavailable capabilities, and explicit unlimited capabilities. | Missing is unavailable, `null` is unlimited, and malformed values are omitted/fail closed. | P0 safety rule covered by tests. |
| Server enforcement | Domain mutations guard quota inside the authoritative transaction. | `assertCanConsume` is reusable for server actions; `lock_workspace_entitlement` gives product RPCs an advisory transaction lock before count-and-insert. | Core owns policy; products own domain mutation SQL. |
| Paddle sync | Raw signature verification, normalized local subscription, event uniqueness/order, retries, and unknown-price safety. | Existing Paddle boundary remains local and normalized; duplicate, stale, delayed, unknown, and failed states do not grant premium access. | Provider is not called for ordinary entitlement reads. |
| Mobile UX | Responsive billing cards, dialogs, cancellation, usage, and plan comparison. | Managed plan page and billing actions retain the Core visual system and responsive dialog/card behavior; reusable usage and limit-notice primitives are also exported. | Extracted without ReserveVia domain copy. |

## Ownership decision

Subscriptions, effective plans, Core workspace/member usage, provider
normalization, billing actions, and enforcement policy are workspace-scoped in
SaaS Core. Product resources remain in the consumer database. A user may be a
member of multiple workspaces; a quota is evaluated against the workspace
passed to the server guard. The Core workspace quota is account-derived from
the owner membership when that metric is requested, while product metrics are
workspace-specific unless a consumer resolver deliberately defines another
scope.

The important fallback rule is: a missing or non-paid subscription resolves to
the configured catalog fallback plan. No customer, no subscription, expired
paid state, paused state, canceled state, unknown price, and invalid plan
mapping never mean unlimited access.

ReserveVia-specific restaurant/reservation names, commercial limits, and
legacy provider custom-data remain outside Core. PlaceDJ venue enforcement is
the Phase 2 consumer task; this phase only supplies the generic contract and
transaction boundary it needs.
