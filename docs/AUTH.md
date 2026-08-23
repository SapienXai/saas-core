# Authentication

The generated application uses `@sapienx/saas-core-runtime` for browser and
server Supabase clients. It provides PKCE, SSR cookie refresh, server-side
`getUser()`/`requireUser()`, safe same-origin redirects and a service-role
constructor that refuses to run in browser code.

The generated routes cover signup, login, logout, confirmation, password
recovery and reset. Browser code may initiate a flow but never resolves a user
or workspace from client-provided identity fields. `safeRedirect()` and
`safeAuthRedirect()` provide stable redirect contracts.

The account state resolver is intentionally generic: unauthenticated,
authenticated without a workspace, onboarding, active and suspended. Products
may add state after the core resolver without changing tenant authorization.
