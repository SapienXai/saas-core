# @sapienx/saas-core-ui

Current package release: `2.6.0`; Core schema compatibility coordinate remains
`2.0`. The coordinated release also delivers the additive, Core-managed
billing sources through the application template and CLI; this UI package does
not execute SQL.

This is the reusable UI package extracted from the production ReserveVia
surface. It contains the actual Radix/shadcn-style primitives, theme provider,
language context, loading surfaces, toast helpers, and utility implementation;
it is not a marker package.

The integrated management shell remains in the application template because it
adapts server-backed workspace context, navigation, PWA, and auth data. The UI
package must not import Supabase, Paddle, or server credentials.

Billing plan cards and confirmed transition feedback stay in that managed app
shell so they can read the product catalog and server-confirmed entitlements.
This package supplies the reusable presentation primitives used by those
surfaces, including `BillingUsageMeter` and `EntitlementLimitNotice`; it does
not own checkout, webhook, or provider state.
