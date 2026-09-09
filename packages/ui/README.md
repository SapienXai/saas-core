# @sapienx/saas-core-ui

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
surfaces; it does not own checkout, webhook, or provider state.
