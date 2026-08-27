# Reservevia production performance worklog

This document tracks the production performance investigation and the fixes that are safe to verify against the same user journeys. It intentionally contains no account credentials, tokens, or credential-bearing URLs.

## Measurement protocol

- Baseline date: 2026-08-16
- Environment: production, clean Chrome tabs where noted, Chrome DevTools Performance/Network and Lighthouse 12.8.2
- Public routes: `/`, `/restaurants`, `/pricing`, `/docs`, `/docs/agents`, `/privacy`, `/terms`
- Authenticated routes: `/manage`, `/manage/reports`, `/manage/reservations`, `/manage/seating`, `/manage/restaurants`, `/manage/plan`, `/manage/team`, `/manage/pwa`, `/manage/domains`, `/manage/users`
- Authenticated flows: login, dashboard settlement, sidebar route transitions, open/close Add Reservation modal; no data mutation was performed.
- Lighthouse uses mobile throttling. Chrome DevTools cold-load values are reported separately because they describe different conditions.

## Baseline evidence

### Public

| Route | TTFB | FCP | DCL | Requests | Transferred | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| `/` | 60 ms | 484–499 ms cold trace | 434 ms | 46 | 1.39 MB | Lighthouse LCP 7.33 s under mobile throttling; CLS 0; TBT 155 ms |
| `/restaurants` | 66 ms | 520 ms | 3.25–4.82 s | 63 | 2.42 MB | 1.51 s trace task time; 894 style recalculations in the slower run |
| `/pricing` | 63 ms | 420 ms | 371 ms | 36 | 1.13 MB | 97 ms script time |
| `/docs` | 60 ms | 240 ms | 214 ms | 36 | 0.93 MB | 104 ms script time |
| `/docs/agents` | 66 ms | 312 ms | 280 ms | 39 | 0.93 MB | 130 ms script time |
| `/privacy` | 64 ms | 428 ms | 385 ms | 37 | 1.42 MB | 108 ms script time |
| `/terms` | 61 ms | 432 ms | 387 ms | 37 | 1.42 MB | 137 ms script time |

Home Lighthouse findings: 1.37 MB total transfer, 2.02 s main-thread work, 857 ms script evaluation, 508 ms style/layout, and 82.9 KB of unused CSS. The LCP element is the hero dashboard screenshot; 4.69 s of its Lighthouse LCP was render delay. Raw image opportunities were approximately 304 KB modern-format savings and 478 KB responsive-image savings.

### Authenticated

| Route | TTFB | FCP | DCL | Requests | Resource bodies | Trace script |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/manage` | 78 ms | 2.71 s | 2.67 s | 53 | 1.01 MB | 107 ms |
| `/manage/reports` | 74 ms | 2.55 s | 2.50 s | 52 | 1.07 MB | 354 ms |
| `/manage/reservations` | 70 ms | 1.98 s | 1.94 s | 49 | 0.88 MB | 492 ms |
| `/manage/seating` | 68 ms | 2.34 s | 2.30 s | 54 | 1.06 MB | 82 ms |
| `/manage/restaurants` | 67 ms | 2.41 s | 2.36 s | 74 | 1.01 MB | 744 ms |
| `/manage/plan` | 72 ms | 1.99 s | 1.97 s | 63 | 1.06 MB | 76 ms |
| `/manage/team` | 72 ms | 2.14 s | 2.08 s | 60 | 0.86 MB | 83 ms |
| `/manage/pwa` | 74 ms | 2.01 s | 1.95 s | 63 | 1.05 MB | 64 ms |
| `/manage/domains` | 79 ms | 2.01 s | 1.95 s | 63 | 1.06 MB | 85 ms |

The first observed authenticated login flow kept the dashboard in a loading state for roughly 17 seconds before all workspace data settled. A subsequent clean dashboard reload settled at roughly 2.7 seconds DCL. Route transitions initiated from actual DOM links completed in about 280–330 ms; the Add Reservation dialog opened in about 350 ms without saving.

## Tracked tasks

### PERF-01 — Re-enable Next image optimization (P1, Done in Round 1)

- Problem: production sends full-size local marketing images and logos even when rendered at small dimensions.
- Evidence: Lighthouse identified a 223 KB logo rendered at 31×31 px, raw hero screenshots, and roughly 304–478 KB of avoidable image transfer.
- Root cause: `images.unoptimized` was globally enabled; marketing logo dimensions were declared as 1024×1024 despite a 32 px visual mark.
- Solution: remove the global bypass, declare accurate logo dimensions, and keep explicitly dynamic remote management images unoptimized until their host allowlist is independently verified.
- Expected gain: materially lower image bytes and hero LCP load/render pressure, especially on mobile and slower networks.

### PERF-02 — Split below-the-fold marketing interactions (P1, Done in Round 1)

- Problem: the homepage hydrates feature tabs, steps, and pricing interactions in the initial client bundle.
- Evidence: Lighthouse measured 857 ms script evaluation, 2.02 s main-thread work, and an unused JavaScript chunk opportunity.
- Root cause: `MarketingHome` statically imported three interactive sections that are not needed to paint the hero.
- Solution: retain server-rendered output while code-splitting those interactive components with `next/dynamic`.
- Expected gain: less initial JavaScript execution and less contention with the hero image render.

### PERF-03 — Prevent credential leakage during delayed hydration (P1, Done in Round 1)

- Problem: a login form without an explicit method can fall back to a browser GET submission if hydration has not attached the React handler.
- Evidence: the direct configured auth alias exhibited a prolonged document-loading/unhydrated state; a pre-hydration submission was observed as a credential-bearing query and was immediately abandoned. No credential-bearing URL is retained here.
- Root cause: the form relied on the client-side `onSubmit` handler and browser default method behavior.
- Solution: set the login form method explicitly to POST as defense in depth; continue investigating the auth alias loading problem separately.
- Expected gain: prevents accidental credential exposure during an auth-origin loading failure; no UI change.

### PERF-04 — Keep management service-worker caching out of auth entry (P1, Done in Round 2)

- Problem: the configured app auth origin did not finish loading CSS/HTML in the observed Chrome session, while the canonical root login route was styled and usable.
- Evidence: the alias remained in `loading` state with zero loaded stylesheets; the canonical login route completed with stylesheets loaded.
- Root cause: the management service worker intercepted same-origin Next static assets for non-management pages; a stale/empty cache state could leave auth CSS/JS waiting indefinitely. Unregistering the worker in an isolated test tab restored `complete` state and all stylesheets.
- Solution: version the management worker cache and only use cache-first handling when the asset request belongs to a `/manage` client. Auth and public entry pages explicitly pass through to the network.
- Expected gain: prevents stale/offline management caching from delaying login hydration and first paint on the configured auth origin.

### PERF-05 — Reduce authenticated route settlement and shared client work (P1, Open)

- Problem: important management pages show 2.0–2.7 s FCP/DCL on warm authenticated reloads, with `/manage/restaurants` especially heavy.
- Evidence: `/manage/restaurants` had 74 requests and 744 ms trace script time; reports and reservations had 354 ms and 492 ms respectively. The first dashboard flow showed a much longer data-settlement period.
- Root cause: requires request-level trace correlation and source audit before changing data fetching or client boundaries.
- Solution: capture API waterfall and component/data dependencies per route; then remove only verified duplicate or non-critical initial work.
- Expected gain: faster usable dashboard state and lower route CPU without changing management behavior.

### PERF-06 — Audit global CSS and route-level loading (P2, Open)

- Problem: public Lighthouse reported 82.9 KB unused CSS and roughly 450 ms opportunity.
- Evidence: multiple global marketing and legacy stylesheets are imported from the root layout.
- Root cause: route-specific CSS is loaded for routes that do not use it.
- Solution: map selectors/imports and split only verified route-local styles; validate all public and authenticated visual flows at desktop and narrow mobile widths.
- Expected gain: lower CSS transfer and parse/recalc work, with no visual regression.

### PERF-08 — Reduce restaurant-directory hydration and style recalculation (P1, Open)

- Problem: the directory paints early but its document-ready milestone remains slow after the visible cards are already on screen.
- Evidence: final Chrome trace reached FCP in about 544 ms but DCL in about 3.89 s, with 1,497 style recalculations and 3.42 s task time. The value stayed in the baseline 3.25–4.82 s range after the image work.
- Root cause: the results tree is hydrated through a client `RestaurantGrid` and client restaurant cards, including repeated recent-reservation islands; the exact contribution of each island needs a route-level trace.
- Solution: isolate the filter-sheet interaction and defer only verified non-critical card islands, while preserving server-rendered card content and narrow-screen layout.
- Expected gain: faster directory readiness and lower recalculation/CPU cost without delaying the first visible restaurant cards.

### PERF-07 — Prioritize the actual LCP image (P1, Done in Round 3)

- Problem: the hero screenshot was visible early but Lighthouse did not see a high fetch priority hint.
- Evidence: post-Round-1 Lighthouse LCP was 5.43 s; LCP discovery reported `fetchpriority=high` as missing, with 319 ms resource load delay and 1.66 s element render delay.
- Root cause: the component still used the deprecated Next 16 `priority` prop, which did not emit the desired fetch-priority signal in the production HTML.
- Solution: use `fetchPriority="high"` for the public hero screenshot and the visible desktop auth artwork.
- Expected gain: earlier LCP resource scheduling and lower perceived first-view delay without changing layout or image content.

## Round status

- Round 0 baseline: complete.
- Round 1 implementation: PERF-01, PERF-02, PERF-03 deployed in `f3a1d97`; public verification complete.
- Round 2 implementation: PERF-04 deployed in `40ce15b`; app-origin propagation and worker verification are in progress.
- Round 3 implementation: PERF-07 deployed in `44a03a6`; final Lighthouse and Chrome verification complete.

## Post-deploy comparison

### Public Lighthouse, same mobile-throttled run

| Metric | Baseline | Round 1 (`f3a1d97`) | Final Round 3 (`44a03a6`) | Change vs baseline |
| --- | ---: | ---: | ---: | ---: |
| Performance score | 0.72 | 0.77 | 0.89 | +0.17 |
| FCP | 1.60 s | 1.47 s | 1.54 s | -0.06 s |
| LCP | 7.33 s | 5.43 s | 3.64 s | -3.69 s |
| TBT | 155 ms | 65 ms | 25 ms | -130 ms |
| CLS | 0 | 0 | 0 | stable |
| Main-thread work | 2.02 s | 1.27 s | 1.44 s | -0.58 s |
| Total bytes | 1.37 MB | 0.93 MB | 0.93 MB | -0.45 MB |

Final LCP discovery now reports `fetchPriority=high`; LCP element render delay fell from 1.66 s in Round 1 to 34 ms. Remaining Lighthouse opportunities are mostly global CSS (82.9 KB estimated unused) and a small shared JavaScript chunk; these are tracked but not changed blindly because the same styles serve multiple route families.

### Final Chrome route and flow checks

- Public: `/` FCP/DCL about 536/436 ms; `/pricing` 564/441 ms; `/docs` 428/389 ms; `/docs/agents` 248/211 ms; `/privacy` 384/349 ms; `/terms` 608/557 ms. `/restaurants` FCP was about 544 ms but DCL about 3.89 s, tracked as PERF-08.
- Authenticated: final clean reloads were generally about 1.84–3.13 s DCL; `/manage/restaurants` was about 1.84 s, `/manage/reports` 2.08 s, `/manage/plan` 1.93 s, and `/manage/domains` 1.95 s. Dashboard data settlement remains variable and was 3.79 s in the final sample.
- Real transitions: Reports, Reservations, Seating, and Dashboard navigated in about 136–382 ms. Add Reservation opened in about 628 ms and was closed without saving.
- Auth entry: both canonical and configured app-origin login pages ended `complete` with six stylesheets and `method=post` in a clean final test tab. The app-origin stale-worker case was isolated and addressed by PERF-04; no credentials are retained in this worklog.
