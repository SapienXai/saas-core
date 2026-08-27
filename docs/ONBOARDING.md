# Reservevia self-service onboarding

Phase 5 gives a new restaurant owner a complete local-to-live journey without manual database setup:

```text
Visitor
  ↓
/signup → confirmation email → /auth/confirm
  ↓
/onboarding
  ↓
workspace + owner + Free + first restaurant
  ↓
profile/assets/links → publish
  ↓
/r/[slug] and /manage
```

## Authentication

Reservevia uses Supabase Auth email/password signup with the current `@supabase/ssr` package:

- `lib/supabase/client.ts` owns the browser client and PKCE flow.
- `lib/supabase/server.ts` owns Server Component, Server Action, and Route Handler clients.
- `middleware.ts` refreshes cookies and validates sessions with `auth.getUser()`.
- `/auth/confirm` verifies the server-side `token_hash` from the local/hosted SSR email templates. It retains a one-time PKCE code exchange as a compatibility fallback. Recovery links continue to `/reset-password`; signup confirmation continues to the account-state resolver.
- `/auth/continue` centralizes the post-auth decision between `/onboarding` and `/manage`.

The old `@supabase/auth-helpers-nextjs` dependency and custom JWT-cookie parser are not used. Service-role credentials remain server-only.

Canonical routes are `/signup`, `/login`, `/forgot-password`, `/reset-password`, `/auth/confirm`, `/onboarding`, and `/manage`. `/manage/login` remains a compatibility redirect. Auth messages are neutral so signup and recovery do not disclose whether an email exists.

## Local email testing

Start local Supabase and reset the database:

```bash
npm run db:start
npm run db:reset
npm run dev:local
```

Open [Mailpit](http://127.0.0.1:54524) and use the captured confirmation or password-reset link. Local `supabase/config.toml` enables email confirmations and uses checked-in token-hash templates that point to `/auth/confirm`; no SMTP credentials are required. `npm run db:test` also exercises the real local authenticated bootstrap RPC; it never uses FelixRez infrastructure.

## Account email design

Reservevia keeps the confirmation and password-recovery templates in `supabase/templates/confirmation.html` and `supabase/templates/recovery.html`. They use Supabase's supported server-side callback pattern with `{{ .RedirectTo }}` and `{{ .TokenHash }}`, a mobile-friendly inline layout, a visible Reservevia brand header, a primary CTA, and a copyable fallback link. The `/auth/confirm` route verifies the one-time token and continues to route recovery links to `/reset-password`.

For a hosted Supabase project, copy these two HTML files into the corresponding Auth → Email Templates entries for Confirm signup and Reset password. Local `config.toml` changes affect the local Supabase stack only; hosted projects use the Supabase dashboard or Management API. Disable SMTP link tracking/rewrite for these single-use links. Reservevia application emails such as workspace invitations are sent separately through the server-only Resend client and use the same visual system from `lib/email-template.ts`.

With the local app running, the reproducible auth journey is:

```bash
npm run auth:e2e
```

It creates a disposable local account, reads only its Mailpit message, follows the token-hash confirmation callback, verifies the SSR session and onboarding route, calls the authenticated bootstrap RPC, checks the Free subscription/restaurant, creates one authenticated test reservation and verifies usage is `1/100`, checks password recovery, and removes the test user/workspace. It refuses non-local Supabase URLs.

Production must configure the Reservevia Supabase project separately with:

- Site URL and allowed redirect URLs for the production app
- custom SMTP for confirmation, recovery, and email-change verification
- auth rate limits and abuse monitoring
- CAPTCHA protection if public signup volume requires it

No SMTP password or provider secret belongs in `.env.example` or Git.

## Account state and workspace rule

`lib/account-state.ts` is the single account-state resolver. A user with no workspace membership enters onboarding. An incomplete self-created workspace returns to onboarding. A completed self-created workspace or an inherited/invited workspace member enters management.

Self-service creates at most one customer workspace per creator. This prevents creating unlimited Free workspaces to bypass quotas. It does not impose a permanent one-user/one-workspace model: future invitations may add memberships to other workspaces.

## Atomic bootstrap

`public.bootstrap_initial_workspace` is a SECURITY DEFINER PostgreSQL function with an explicit `search_path`. It uses `auth.uid()` and a per-user advisory lock. In one transaction it creates:

1. a workspace owned by the authenticated creator
2. an `owner` membership
3. the first unpublished restaurant
4. the minimum `admin_profiles` compatibility row

The existing workspace trigger assigns the Free subscription. The function does not call Paddle. A unique partial index on `workspaces.created_by` blocks a second self-created workspace. Repeating the same bootstrap request returns the existing workspace/restaurant; changing the initial restaurant after bootstrap is rejected. Browser input cannot choose the owner or another workspace.

## Resumable onboarding

The wizard has three small steps:

1. Restaurant name, optional workspace/brand name, and stable slug.
2. Existing restaurant profile fields, with one logo and one primary image.
3. Optional Menu/Location/Events links, preview, and publish.

The wizard writes directly to the `restaurants` profile used by the management editor, `RestaurantCard`, and `/r/[slug]`. It does not create onboarding-only JSON, a CMS, a gallery, or duplicate landing-page fields. Optional description, links, contact fields, and images can be skipped. Refreshing or returning later derives progress from the saved workspace/restaurant and never creates another tenant row.

Uploads use the existing tenant-safe `restaurant-assets` bucket and paths:

```text
workspace-id/restaurant-id/logo/file.ext
workspace-id/restaurant-id/primary/file.ext
```

The browser validates image MIME type and a 5 MB limit, uploads with the authenticated browser client, and removes replaced objects after the profile update succeeds. A failed profile save removes newly uploaded objects so an incomplete retry does not leak assets.

## Publishing and route behavior

Draft restaurants remain unpublished and are not returned by the public resolver. Publish updates the restaurant to `published` and records `workspaces.onboarding_completed_at`. The success state links to the canonical `/r/[slug]` page and `/manage`.

The current reservation engine is reused without changing availability semantics. The page keeps Reserve Table as its primary action and uses the existing `/reserve?restaurantSlug=...` path; legacy `/reserve?restaurant=...` links remain supported. Free pages retain subtle Reservevia branding and immediately use the existing 100-reservation entitlement.

## Security boundaries

RLS and server authorization protect the bootstrap and profile operations. A caller cannot create a workspace for another user, add themselves to another workspace, update a restaurant outside their membership, or change a subscription. Initial setup does not expose a service-role key to the browser. The owner membership is authoritative; the compatibility profile row is not a second tenant authorization system.

## Future work

Team invitations, social login, MFA, CAPTCHA enforcement, custom PWA branding, and marketing remain separate phases. Phase 6 now provides the code-level hosted-subdomain/custom-domain architecture; production Vercel project, wildcard DNS, and customer-domain activation remain infrastructure rollout work.
