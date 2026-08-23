# Authentication

Use a server-side Supabase adapter for signup, login, logout, confirmation,
PKCE and recovery. Browser code may initiate a flow but never resolves a user
or workspace from client-provided identity fields. `requireUser()` and
`safeAuthRedirect()` in the auth package provide the stable contract.

The account state resolver is intentionally generic: unauthenticated,
authenticated without a workspace, onboarding, active and suspended. Products
may add state after the core resolver without changing tenant authorization.
