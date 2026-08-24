# Changelog

## 1.0.0

- Added the first-class Supabase runtime with browser, SSR, service-role and
  authenticated Core repository boundaries.
- Hardened workspace, membership, invitation, entitlement and usage mutations
  with database RPCs, owner safety, effective-plan resolution and row locking.
- Added durable Paddle lifecycle helpers, hostname/provider reconciliation,
  Resend/Web Push retry boundaries, PWA cache revision support and reusable UI
  shell primitives.
- Replaced the scaffold-only CLI with a runnable Next.js App Router generator,
  ownership-aware manifest, conflict-safe update, doctor, diff and test flows.
- Replaced static Core Lab scenario text with executable deterministic scenarios
  that return actual operations, outcomes, timings and error codes.
- Added CI jobs for local Supabase integration, generated packed-app build,
  Chromium auth smoke and Core Lab execution.
- Final P0 hardening adds secure persistent workspace switching, generated
  invitation acceptance and delivery, advisory-lock seat serialization, 20
  authenticated database checks, generated billing lifecycle routes, real
  Platform Control health surfaces, fresh Supabase project files and tested
  v0.9-to-current CLI update fixtures.

Provider credentials and cloud-service verification remain environment-specific;
deterministic mock/provider-boundary tests do not represent live Paddle,
Resend, Vercel, Web Push or cloud Supabase operations.
