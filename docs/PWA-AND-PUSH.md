# Reservevia PWA and Web Push

Phase 8 makes `app.reservevia.com` an installable management application. It is not the guest booking site: `restaurant-slug.reservevia.com` and customer-owned domains remain public restaurant origins and do not register the management service worker.

## Workspace PWA model

There is one management PWA per workspace. A Business workspace uses the same installed app for every restaurant the member can access; the existing workspace and restaurant context controls remain the authorization boundary.

`workspace_pwa_settings` stores only the optional workspace branding override:

- `workspace_id` — primary key and workspace foreign key
- `app_name` — optional 1–60 character label
- `icon_url` — optional public-safe icon URL
- `theme_color`, `background_color` — validated `#RRGGBB` values
- `updated_by`, timestamps

Effective defaults are deliberately automatic:

```text
app name = custom name → single restaurant name → workspace name → Reservevia
icon     = custom icon → restaurant logo → primary restaurant image → Reservevia fallback
```

Single-restaurant workspaces therefore feel restaurant-branded without configuration. If the restaurant has no separate logo, its uploaded primary image is used as the icon fallback. Multi-restaurant workspaces still use one workspace-level installed app; Owner/Admin can choose an explicit workspace icon when a single restaurant logo should not represent all locations. Only Owner/Admin members with the `customPWA` entitlement can change settings. The same settings remain stored during a downgrade, but the effective app falls back to platform/default branding until the entitlement is restored.

The icon upload is one tenant-scoped image under `workspace-id/pwa/icon/`, validated for image MIME/signature and limited to 2 MB. The manifest advertises the same safe source at 192px and 512px sizes so the browser/platform can scale it; Reservevia does not require separate splash, maskable, favicon, or Apple icon uploads.

## Manifest and origin

`GET /manifest.webmanifest` is dynamic and is accepted only on the application host, local application development, or a Vercel preview. It returns:

- stable `id`: `/pwa/{workspace-id}` with an optional restaurant suffix when a restaurant context is active
- safe `start_url`: `/manage?pwa=1&workspace={workspace-id}` with an optional restaurant query
- `scope: /`
- standalone display mode
- effective workspace branding

The workspace query is only a preference. `selectWorkspace` validates membership server-side and stores the preference in an HttpOnly cookie before the client removes the query. It never grants access. Because some browsers fetch a manifest without sending the management session cookie, the manifest route may resolve only the public-safe workspace branding from that query; the `start_url` remains authenticated.

The management layout emits a workspace-scoped manifest URL (`/manifest.webmanifest?workspace={workspace-id}`), optionally including the active restaurant. An authenticated request still validates workspace and restaurant membership before using the management context; a cookie-less manifest request is limited to public-safe install metadata. Current theme metadata and Apple touch icon metadata use the same effective branding. Public restaurant hosts do not receive a management manifest or service-worker registration. The app remains available through normal `/login`, `/onboarding`, and `/manage` compatibility routes during the domain rollout.

## Service worker and offline policy

`public/sw.js` is a conservative management worker:

- registers only from the management origin, localhost, or Vercel preview
- caches versioned static build assets and safe `/assets` files only
- fetches `/manage` navigation network-first with a generic no-tenant offline response
- never caches reservation HTML, management/API JSON, Server Actions, Supabase responses, auth routes, reports, billing, domains, members, or guest data
- removes old `reservevia-manage-*` and legacy `manage-offline-*` caches during activation
- validates notification-click URLs as same-origin `/manage` paths

The former management offline helpers remain as compatibility no-ops; they no longer persist reservation/customer data in localStorage. Logout clears old local keys, asks the worker to delete its caches, clears Supabase browser auth state, revokes the user’s server push subscriptions, and unsubscribes the current browser endpoint where possible.

No offline reservation writes, queues, background sync, or tenant-data cache are implemented.

## Push subscriptions

`workspace_push_subscriptions` is the current device model:

- `workspace_id`, `user_id`
- endpoint and Web Push encryption keys
- user-agent/platform metadata
- active/revoked state and timestamps
- unique `(workspace_id, user_id, endpoint)`

Legacy `admin_push_subscriptions` rows are migrated when their restaurant and workspace member can be resolved. The legacy table remains temporarily for compatibility, but new registration and delivery use the workspace table.

Registration is explicit and client-triggered from the PWA settings page, the management header notification dropdown, or the sidebar user card. The server derives the authenticated user and current workspace, checks `pushNotifications`, validates the subscription payload, and stores it with the service-role boundary. Subscription writes reject a mismatched `Origin`; the browser cannot provide a user, workspace, plan, role, or restaurant scope. Push endpoints and keys are never shown in the UI or logged.

The plan boundary is:

```text
All plans, including Free: pushNotifications true
```

The endpoint `/api/push-notifications/public-key` returns only the public VAPID key after entitlement and full server configuration checks. `WEB_PUSH_PRIVATE_KEY` never reaches browser code.

## Recipient authorization

`getPushRecipientsForRestaurant(restaurantId)` is the single delivery resolver. It loads the restaurant workspace, checks the local entitlement, then joins active device rows to current `workspace_members` and selected `workspace_member_restaurants` assignments:

- Owner/Admin: all workspace restaurants
- Manager/Staff with `all`: all workspace restaurants
- Manager/Staff with `selected`: only assigned restaurants
- removed members, readonly users, revoked devices, and no-longer-entitled workspaces: no recipient

Restaurant access is evaluated at delivery time; it is not copied into a device row. Removing a member or assignment therefore stops future push immediately. Multiple matching rows are endpoint-deduplicated. A 404/410 provider response revokes the dead subscription. Other provider failures are logged with safe IDs and never roll back the reservation.

Payloads are operational and intentionally small: workspace/restaurant context, reservation date/time, party size, event type, and a same-origin internal management URL. Guest phone, email, private notes, billing data, and secrets are excluded. Notification clicks open `/manage/reservations?...` only after the browser/app and server re-check the user’s current authorization.

## Install and browser behavior

Chromium’s `beforeinstallprompt` is captured and shown only after explicit user interaction is possible. The prompt is never called automatically. Installed/standalone state is an enhancement, not an authorization or functionality requirement.

On iOS/iPadOS, where install prompting is not exposed and Web Push requires a Home Screen web app, `/manage/pwa` gives concise Share → Add to Home Screen guidance. The user must launch the installed app and explicitly enable notifications. Unsupported browsers continue to provide the full management web app and show a non-blocking capability message.

## Environment and production checklist

`.env.example` documents:

- `NEXT_PUBLIC_RESERVEVIA_APP_DOMAIN`
- `WEB_PUSH_PUBLIC_KEY`
- `WEB_PUSH_PRIVATE_KEY`
- `WEB_PUSH_SUBJECT`

Production requires HTTPS, the real `app.reservevia.com` origin, a production VAPID key pair and contact subject, manifest/icon availability, service-worker scope validation, and real Chromium/Android/iOS manual tests. No production VAPID credentials are generated or changed by this phase.

## Type generation and validation

`npm run db:types` runs `supabase gen types --local --schema public` and writes `types/supabase.ts`; it refuses to target a remote project by using the local CLI mode. Compatibility aliases used by the existing application are appended deterministically.

Automated coverage includes management-origin and cache-policy unit tests, PWA/push RLS checks, and local recipient-scope integration tests. Browser installation, real provider delivery, Android, and iOS device checks remain manual validation items unless explicitly executed; mocked/provider-boundary tests must not be described as real browser or Web Push delivery.
