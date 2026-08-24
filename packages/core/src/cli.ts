#!/usr/bin/env node
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, realpathSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { stdin as input, stdout as output } from "node:process"
import { CORE_SCHEMA_VERSION, CORE_VERSION, configFromManifest, evaluateCompatibility, modulesForConfig, parseCliFlags, resolveCliConfig, type CliFlags, type ResolvedCliConfig } from "./cli-config.js"
import { inspectProviderConfiguration } from "./provider-config.js"

const VERSION = CORE_VERSION
const SCHEMA_VERSION = CORE_SCHEMA_VERSION
const FRAMEWORK_GENERATED_FILES = new Set(["next-env.d.ts"])
const cyan = (value: string) => `\u001b[36m${value}\u001b[0m`
const green = (value: string) => `\u001b[32m${value}\u001b[0m`
const yellow = (value: string) => `\u001b[33m${value}\u001b[0m`
const red = (value: string) => `\u001b[31m${value}\u001b[0m`
const dim = (value: string) => `\u001b[2m${value}\u001b[0m`
const hash = (value: string) => createHash("sha256").update(value).digest("hex")

type ManagedFile = { hash: string; ownership: "managed" | "mergeable" }
type Manifest = {
  projectName?: string
  coreVersion: string
  schemaVersion: string
  installedModules: string[]
  providers: Record<string, string>
  managedFiles: Record<string, ManagedFile | string>
  generatedFiles: Record<string, { ownership: "user-owned" | "mergeable" }>
  installedAt: string
  updatedAt: string
  configuration?: Partial<ResolvedCliConfig>
  version?: string
  modules?: string[]
}
type ProjectPackage = { dependencies?: Record<string, string>; devDependencies?: Record<string, string>; scripts?: Record<string, string> }

const packageNameToTarball = (name: string) => `${name.replace(/^@/, "").replaceAll("/", "-")}-${VERSION}.tgz`
function packageSpec(name: string): string {
  const directory = process.env.SAAS_CORE_TARBALL_DIR
  return directory ? `file:${join(directory, packageNameToTarball(name))}` : `^${VERSION}`
}

const projectKey = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "saas-product"
const json = (value: unknown) => JSON.stringify(value, null, 2) + "\n"
function coreMigrationSql(filename = "20260824000000_saas_core_v1.sql"): string {
  const candidates = [
    join(dirname(fileURLToPath(import.meta.url)), "../../supabase/migrations", filename),
    join(dirname(fileURLToPath(import.meta.url)), "../migrations", filename),
    join(process.cwd(), "supabase/migrations", filename),
  ]
  const source = candidates.find((candidate) => existsSync(candidate))
  return source ? readFileSync(source, "utf8") : `-- SaaS Core migration ${VERSION}\n-- Install the package migration from the published distribution before running supabase db reset.\n`
}

function generatedFiles(projectName: string, config = resolveCliConfig()): Map<string, string> {
  const key = projectKey(projectName)
  const coreDeps = {
    "@sapienx/saas-core": packageSpec("@sapienx/saas-core"),
    "@sapienx/saas-core-auth": packageSpec("@sapienx/saas-core-auth"),
    "@sapienx/saas-core-config": packageSpec("@sapienx/saas-core-config"),
    "@sapienx/saas-core-runtime": packageSpec("@sapienx/saas-core-runtime"),
    "@sapienx/saas-core-billing": packageSpec("@sapienx/saas-core-billing"),
    "@sapienx/saas-core-notifications": packageSpec("@sapienx/saas-core-notifications"),
    "@sapienx/saas-core-ui": packageSpec("@sapienx/saas-core-ui"),
    ...(config.domains ? { "@sapienx/saas-core-domains": packageSpec("@sapienx/saas-core-domains") } : {}),
  }
  const localOverrides = process.env.SAAS_CORE_TARBALL_DIR ? { pnpm: { overrides: { ...coreDeps } } } : {}
  const files = new Map([
    ["package.json", json({ name: key, private: true, version: "0.1.0", type: "module", scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint", typecheck: "tsc --noEmit", test: "vitest run", "saas-core": "saas-core" }, dependencies: { next: "16.3.0", react: "^19.2.8", "react-dom": "^19.2.8", "@supabase/ssr": "^0.12.4", "@supabase/supabase-js": "^2.112.3", ...coreDeps }, devDependencies: { "@types/node": "^24.0.0", "@types/react": "^19.2.0", "@types/react-dom": "^19.2.0", typescript: "^5.9.0", vitest: "^3.2.0", "@playwright/test": "^1.62.0" }, ...localOverrides })],
    ["next.config.mjs", `/** @type {import('next').NextConfig} */\nexport default { reactStrictMode: true, poweredByHeader: false, allowedDevOrigins: ["127.0.0.1", "localhost"] }\n`],
    ["tsconfig.json", json({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: false, skipLibCheck: true, strict: true, noEmit: true, incremental: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", plugins: [{ name: "next" }], paths: { "@/*": ["./src/*"] } }, include: ["next-env.d.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "src/**/*.ts", "src/**/*.tsx", "proxy.ts"], exclude: ["node_modules"] })],
    ["next-env.d.ts", "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n\n// NOTE: This file should not be edited\n"],
    ["core.config.ts", `import { defineSaaSCore } from "@sapienx/saas-core-config"\n\nexport default defineSaaSCore({\n  version: "${VERSION}",\n  product: { key: ${JSON.stringify(key)}, name: ${JSON.stringify(projectName)} },\n  auth: { provider: "supabase", requireEmailConfirmation: true },\n  workspace: { slugSource: "user_input", defaultTimezone: "UTC" },\n  permissions: { custom: {} },\n  billing: { provider: "paddle", environment: "sandbox" },\n  entitlements: { features: [], metrics: [] },\n  usage: { enabled: true },\n  notifications: { email: { name: "resend", enabled: false }, push: { name: "web-push", enabled: false } },\n  domains: { enabled: false },\n  pwa: { enabled: false },\n  platform: { enabled: true, supportReadOnly: true },\n})\n`],
    [".env.example", `# SaaS Core generated environment. Copy to .env.local. Secret values stay server-side.\nAPP_URL=http://localhost:3000\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_ANON_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\nPADDLE_ENVIRONMENT=sandbox\nPADDLE_API_KEY=\nPADDLE_WEBHOOK_SECRET=\nPADDLE_CRON_SECRET=\nVERCEL_TOKEN=\nVERCEL_PROJECT_ID=\nVERCEL_TEAM_ID=\nRESEND_API_KEY=\nRESEND_FROM_EMAIL=\nVAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=mailto:ops@example.com\n`],
    [".gitignore", `node_modules/\n.next/\nout/\n.env*\n!.env.example\n`],
    ["proxy.ts", `import { NextResponse, type NextRequest } from "next/server"\nimport { createServerSupabaseClient } from "@sapienx/saas-core-runtime"\n\nexport async function proxy(request: NextRequest) {\n  const protectedRoute = request.nextUrl.pathname.startsWith("/app") || request.nextUrl.pathname.startsWith("/onboarding") || request.nextUrl.pathname.startsWith("/platform")\n  if (!protectedRoute) return NextResponse.next()\n  let response = NextResponse.next({ request })\n  const client = createServerSupabaseClient({ cookies: {\n    getAll: () => request.cookies.getAll().map(({ name, value }) => ({ name, value })),\n    setAll: (cookiesToSet) => { for (const cookie of cookiesToSet) response.cookies.set(cookie.name, cookie.value, cookie.options) },\n  } })\n  const { data } = await client.auth.getUser()\n  if (!data.user) {\n    const redirect = new URL("/login", request.url)\n    redirect.searchParams.set("next", request.nextUrl.pathname)\n    return NextResponse.redirect(redirect)\n  }\n  return response\n}\n\nexport const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|css|js)$).*)"] }\n`],
    ["src/lib/supabase.ts", `import { cookies } from "next/headers"\nimport { createNextServerSupabaseClient } from "@sapienx/saas-core-runtime"\n\nexport async function createServerClient() {\n  const cookieStore = await cookies()\n  return createNextServerSupabaseClient(cookieStore as any)\n}\n`],
    ["src/lib/core.ts", `import { createCoreRepositories } from "@sapienx/saas-core-runtime"\nimport { createServerClient } from "./supabase"\n\nexport async function coreRepositories() { return createCoreRepositories(await createServerClient()) }\n`],
    ["src/app/globals.css", `:root { --ink:#101827; --muted:#637087; --line:#e2e8f0; --surface:#fff; --canvas:#f6f8fb; --brand:#315cf6; --good:#14845a; --warn:#b66a00; font-family: Inter, ui-sans-serif, system-ui, sans-serif; color:var(--ink); background:var(--canvas); }\n* { box-sizing:border-box; } body { margin:0; background:var(--canvas); } a { color:inherit; text-decoration:none; } button, input, select { font:inherit; } .saas-shell { min-height:100vh; display:grid; grid-template-columns:248px minmax(0,1fr); } .saas-sidebar { background:#0e1729; color:#dbe6ff; padding:24px 16px; display:flex; flex-direction:column; gap:28px; } .saas-brand { display:flex; gap:10px; align-items:center; font-size:15px; } .saas-brand small { display:block; color:#91a2c4; font-size:11px; margin-top:3px; } .saas-brand-mark { width:32px; height:32px; display:grid; place-items:center; border-radius:10px; background:#7ce1ba; color:#091322; font-weight:800; } .saas-nav { display:grid; gap:6px; } .saas-nav a { padding:10px 12px; border-radius:9px; color:#9eacc6; } .saas-nav a:hover, .saas-nav a.active { color:white; background:#1c2b48; } .saas-sidebar-footer { margin-top:auto; border-top:1px solid #293752; padding-top:14px; display:grid; gap:8px; color:#91a2c4; font-size:12px; } .saas-sidebar-footer a { color:#c6d4ee; } .saas-main { min-width:0; padding:32px clamp(18px,5vw,72px) 72px; } .saas-mobile-header { display:none; } .saas-content { max-width:1120px; margin:auto; } .saas-eyebrow { color:var(--brand); text-transform:uppercase; letter-spacing:.12em; font-size:11px; font-weight:800; } h1 { font-size:clamp(30px,4vw,48px); letter-spacing:-.045em; margin:8px 0 12px; } h2 { letter-spacing:-.025em; margin:0 0 8px; } h3 { margin:0 0 8px; } p { color:var(--muted); line-height:1.6; } .saas-grid { display:grid; gap:16px; } .saas-grid.two { grid-template-columns:repeat(2,minmax(0,1fr)); } .saas-grid.three { grid-template-columns:repeat(3,minmax(0,1fr)); } .saas-card, .saas-plan-card, .saas-empty, .saas-state { background:var(--surface); border:1px solid var(--line); border-radius:16px; padding:20px; box-shadow:0 14px 38px rgba(15,23,42,.05); } .saas-card-kicker { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.1em; font-weight:800; } .saas-button { display:inline-flex; justify-content:center; border:0; border-radius:9px; background:var(--brand); color:white; padding:11px 15px; cursor:pointer; font-weight:700; } .saas-button.secondary { background:#edf2ff; color:#2847ae; } .saas-button:disabled { opacity:.55; cursor:not-allowed; } .saas-form { display:grid; gap:13px; max-width:460px; } .saas-form label { display:grid; gap:6px; font-size:13px; font-weight:700; } .saas-form input, .saas-form select, .saas-switcher select { border:1px solid #ccd5e4; border-radius:9px; padding:11px 12px; background:white; color:var(--ink); } .saas-table { width:100%; border-collapse:collapse; } .saas-table th, .saas-table td { text-align:left; padding:13px 9px; border-bottom:1px solid var(--line); font-size:13px; } .saas-table th { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.08em; } .saas-badge { display:inline-flex; border-radius:999px; padding:5px 9px; font-size:11px; text-transform:capitalize; background:#edf1f6; color:#526074; } .saas-badge.success { background:#e6f7ef; color:var(--good); } .saas-badge.warning { background:#fff3dd; color:var(--warn); } .saas-badge.danger { background:#ffebee; color:#b4233d; } .saas-badge.info { background:#e7efff; color:#3155b7; } .saas-switcher { display:grid; gap:5px; max-width:340px; color:var(--muted); font-size:12px; } .saas-plan-price { display:block; font-size:28px; margin:10px 0; } .saas-plan-card ul { padding-left:19px; color:var(--muted); min-height:90px; line-height:1.9; } .saas-plan-card button { border:1px solid #cbd5e1; border-radius:8px; padding:9px 12px; background:white; } .saas-plan-card.current { border-color:#8ba4ff; box-shadow:0 0 0 3px #e8edff; } .saas-billing-status { display:grid; gap:8px; } .saas-billing-status span { color:var(--muted); font-size:12px; } .saas-usage { display:grid; gap:8px; } .saas-usage > div:first-child { display:flex; justify-content:space-between; gap:12px; font-size:13px; } .saas-progress { height:8px; background:#e7edf6; border-radius:99px; overflow:hidden; } .saas-progress span { display:block; height:100%; background:var(--brand); border-radius:inherit; } .saas-empty, .saas-state { text-align:center; padding:48px 20px; } .saas-empty p, .saas-state p { max-width:520px; margin:8px auto 18px; } .saas-state.error { border-color:#f3b3be; color:#9d2037; } .auth-page { min-height:100vh; display:grid; place-items:center; padding:22px; } .auth-card { width:min(100%,440px); background:white; border:1px solid var(--line); border-radius:20px; padding:30px; box-shadow:0 24px 80px rgba(15,23,42,.1); } .auth-card .saas-brand { margin-bottom:30px; } .form-error { color:#b4233d; background:#fff0f2; padding:10px 12px; border-radius:8px; font-size:13px; } .notice { color:var(--good); background:#e9f8f0; padding:10px 12px; border-radius:8px; font-size:13px; } @media(max-width:800px) { .saas-shell { display:block; } .saas-sidebar { display:none; } .saas-mobile-header { display:flex; align-items:center; justify-content:space-between; gap:16px; background:#0e1729; color:white; padding:13px 16px; } .saas-main { padding:24px 16px 52px; } .saas-grid.two, .saas-grid.three { grid-template-columns:1fr; } .saas-table { min-width:620px; } .table-scroll { overflow:auto; } }\n`],
    ["src/app/layout.tsx", `import type { ReactNode } from "react"\nimport type { Metadata } from "next"\nimport "./globals.css"\n\nexport const metadata: Metadata = { title: "${projectName}", description: "SaaS Core application foundation" }\nexport default function RootLayout({ children }: { children: ReactNode }) { return <html lang="en"><body>{children}</body></html> }\n`],
    ["src/app/page.tsx", `import Link from "next/link"\nexport default function Home() { return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>${projectName}</strong></div><div className="saas-eyebrow">SaaS Core foundation</div><h1>Start with the product domain.</h1><p>Auth, workspaces, team permissions, plans, usage, billing and operator controls are ready as a reusable platform layer.</p><div style={{display:"flex",gap:10,flexWrap:"wrap"}}><Link className="saas-button" href="/signup">Create account</Link><Link className="saas-button secondary" href="/login">Sign in</Link></div></div></main> }\n`],
    ["src/app/(auth)/login/page.tsx", authPage("Sign in", "/api/auth/signin", "New here?", "/signup", "Sign up")],
    ["src/app/(auth)/signup/page.tsx", authPage("Create account", "/api/auth/signup", "Already have an account?", "/login", "Sign in")],
    ["src/app/(auth)/forgot-password/page.tsx", `export default function ForgotPassword() { return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>Password recovery</strong></div><h1>Reset your password.</h1><p>We will send a safe, same-origin recovery link.</p><form className="saas-form" action="/api/auth/forgot-password" method="post"><label>Email<input name="email" type="email" required autoComplete="email" /></label><button className="saas-button" type="submit">Send recovery link</button></form><p><a href="/login">Back to sign in</a></p></div></main> }\n`],
    ["src/app/(auth)/reset-password/page.tsx", `export default function ResetPassword() { return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>Password recovery</strong></div><h1>Choose a new password.</h1><form className="saas-form" action="/api/auth/reset-password" method="post"><label>New password<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label><button className="saas-button" type="submit">Update password</button></form></div></main> }\n`],
    ["src/app/auth/confirm/route.ts", `import { NextResponse } from "next/server"\nimport { createServerClient } from "@/lib/supabase"\nexport async function GET(request: Request) { const url = new URL(request.url); const tokenHash = url.searchParams.get("token_hash"); const type = url.searchParams.get("type") as "email" | "recovery" | null; const client = await createServerClient(); const result = tokenHash && type ? await client.auth.verifyOtp({ token_hash: tokenHash, type }) : { error: new Error("Invalid confirmation") }; if (result.error) return NextResponse.redirect(new URL("/login?error=invalid_confirmation", url)); return NextResponse.redirect(new URL(type === "recovery" ? "/reset-password" : "/app", url)); }\n`],
    ["src/app/api/auth/signin/route.ts", authRoute("signInWithPassword", "/app")],
    ["src/app/api/auth/signup/route.ts", `import { NextResponse } from "next/server"\nimport { createServerClient } from "@/lib/supabase"\nexport async function POST(request: Request) { const body = await request.formData(); const email = String(body.get("email") ?? "").trim(); const password = String(body.get("password") ?? ""); const client = await createServerClient(); const result = await client.auth.signUp({ email, password, options: { emailRedirectTo: new URL("/auth/confirm?type=email", request.url).toString() } }); if (result.error) return NextResponse.redirect(new URL("/signup?error=signup_failed", request.url)); return NextResponse.redirect(new URL(result.data.user ? "/app" : "/signup?confirmation=sent", request.url)); }\n`],
    ["src/app/api/auth/forgot-password/route.ts", `import { NextResponse } from "next/server"\nimport { createServerClient } from "@/lib/supabase"\nexport async function POST(request: Request) { const body = await request.formData(); const email = String(body.get("email") ?? "").trim(); const client = await createServerClient(); await client.auth.resetPasswordForEmail(email, { redirectTo: new URL("/auth/confirm?type=recovery", request.url).toString() }); return NextResponse.redirect(new URL("/login?recovery=sent", request.url)); }\n`],
    ["src/app/api/auth/reset-password/route.ts", `import { NextResponse } from "next/server"\nimport { createServerClient } from "@/lib/supabase"\nexport async function POST(request: Request) { const body = await request.formData(); const password = String(body.get("password") ?? ""); const client = await createServerClient(); const result = await client.auth.updateUser({ password }); if (result.error) return NextResponse.redirect(new URL("/reset-password?error=update_failed", request.url)); return NextResponse.redirect(new URL("/app", request.url)); }\n`],
    ["src/app/api/auth/signout/route.ts", `import { NextResponse } from "next/server"\nimport { createServerClient } from "@/lib/supabase"\nexport async function GET(request: Request) { const client = await createServerClient(); await client.auth.signOut(); return NextResponse.redirect(new URL("/login?logged_out=1", request.url)); }\nexport const POST = GET\n`],
    ["src/app/api/workspaces/route.ts", `import { NextResponse } from "next/server"\nimport { coreRepositories } from "@/lib/core"\nexport async function POST(request: Request) { const body = await request.formData(); const name = String(body.get("name") ?? "").trim(); const slug = String(body.get("slug") ?? "").trim(); try { await (await coreRepositories()).workspaces.createWorkspace({ name, slug }); return NextResponse.redirect(new URL("/app", request.url)); } catch { return NextResponse.redirect(new URL("/onboarding?error=create_failed", request.url)); } }\n`],
    ["src/app/app/layout.tsx", `import type { ReactNode } from "react"\nimport { getCurrentUser } from "@sapienx/saas-core-runtime"\nimport { AppShell } from "@sapienx/saas-core-ui"\nimport { createServerClient } from "@/lib/supabase"\nexport const dynamic = "force-dynamic"\nexport default async function AppLayout({ children }: { children: ReactNode }) { let email: string | null = null; try { const user = await getCurrentUser(await createServerClient()); email = user?.email ?? null } catch { /* doctor/setup page remains usable before Supabase credentials exist */ } return <AppShell productName="${projectName}" userEmail={email} nav={[{label:"Overview",href:"/app",active:true},{label:"Team",href:"/app/team"},{label:"Plan & usage",href:"/app/plan"},{label:"Settings",href:"/app/settings"},{label:"Platform Control",href:"/platform"}]}>{children}</AppShell> }\n`],
    ["src/app/app/page.tsx", `import Link from "next/link"\nimport { WorkspaceSwitcher, EmptyState } from "@sapienx/saas-core-ui"\nimport { coreRepositories } from "@/lib/core"\nexport const dynamic = "force-dynamic"\nexport default async function AppHome() { let workspaces: any[] = []; let error = ""; try { workspaces = await (await coreRepositories()).workspaces.listUserWorkspaces() as any[] } catch (cause) { error = cause instanceof Error ? cause.message : "Core is not configured yet." } return <main className="saas-content"><div className="saas-eyebrow">Workspace overview</div><h1>Build your product here.</h1><p>The generated app owns product routes. Core owns the platform boundary below them.</p>{error ? <div className="saas-state error"><strong>Runtime setup required</strong><p>{error}</p><Link className="saas-button secondary" href="/onboarding">Continue setup</Link></div> : workspaces.length === 0 ? <EmptyState title="Create your first workspace" description="A workspace is the tenant boundary for your product." action={<Link className="saas-button" href="/onboarding">Create workspace</Link>} /> : <><div className="saas-card"><WorkspaceSwitcher workspaces={workspaces.map((w) => ({id:w.id,name:w.name,slug:w.slug}))} /><p>{workspaces.length} workspace{workspaces.length === 1 ? "" : "s"} available to your account.</p></div><div className="saas-grid three"><Link className="saas-card" href="/app/team"><h3>Team</h3><p>Invite people and manage role hierarchy.</p></Link><Link className="saas-card" href="/app/plan"><h3>Plan & usage</h3><p>Inspect effective entitlements and metering.</p></Link><Link className="saas-card" href="/app/settings"><h3>Workspace settings</h3><p>Branding, PWA and optional services.</p></Link></div></>}</main> }\n`],
    ["src/app/onboarding/page.tsx", `export const dynamic = "force-dynamic"\nexport default function Onboarding({ searchParams }: { searchParams: Promise<{ error?: string }> }) { return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>Workspace setup</strong></div><div className="saas-eyebrow">First tenant</div><h1>Create a workspace.</h1><p>Use a product-neutral workspace as the boundary for your future domain tables.</p><form className="saas-form" action="/api/workspaces" method="post"><label>Workspace name<input name="name" placeholder="My product" required /></label><label>Workspace slug<input name="slug" placeholder="my-product" pattern="[a-z0-9-]+" required /></label><button className="saas-button" type="submit">Create workspace</button></form></div></main> }\n`],
    ["src/app/app/team/page.tsx", `import { coreRepositories } from "@/lib/core"\nimport { StatusBadge } from "@sapienx/saas-core-ui"\nexport const dynamic = "force-dynamic"\nexport default async function TeamPage() { const repos = await coreRepositories(); const workspaces = await repos.workspaces.listUserWorkspaces() as any[]; const workspace = workspaces[0]; const members = workspace ? await repos.memberships.list(workspace.id) : []; return <main className="saas-content"><div className="saas-eyebrow">Workspace team</div><h1>People and permissions.</h1><p>Membership is the authorization source; UI controls are not security boundaries.</p>{workspace ? <><div className="saas-card"><h2>Invite a teammate</h2><form className="saas-form" action="/api/invitations" method="post"><input type="hidden" name="workspaceId" value={workspace.id} /><label>Email<input type="email" name="email" required /></label><label>Role<select name="role" defaultValue="member"><option value="admin">Admin</option><option value="manager">Manager</option><option value="member">Member</option><option value="viewer">Viewer</option></select></label><button className="saas-button" type="submit">Create invitation</button></form></div><div className="saas-card" style={{marginTop:16}}><div className="table-scroll"><table className="saas-table"><thead><tr><th>User</th><th>Role</th><th>Status</th></tr></thead><tbody>{members.map((member: any) => <tr key={member.id}><td>{member.user_id}</td><td>{member.role}</td><td><StatusBadge status={member.status} /></td></tr>)}</tbody></table></div></div></> : <div className="saas-state">Create a workspace before managing its team.</div>}</main> }\n`],
    ["src/app/api/invitations/route.ts", `import { NextResponse } from "next/server"\nimport { coreRepositories } from "@/lib/core"\nexport async function POST(request: Request) { const body = await request.formData(); try { const result = await (await coreRepositories()).invitations.create({ workspaceId: String(body.get("workspaceId") ?? ""), email: String(body.get("email") ?? ""), role: String(body.get("role") ?? "member") }); console.info("Core invitation created", { invitationId: (result.invitation as any)?.id, tokenGenerated: true }); return NextResponse.redirect(new URL("/app/team?invited=1", request.url)); } catch { return NextResponse.redirect(new URL("/app/team?error=invite_failed", request.url)); } }\n`],
    ["src/app/app/plan/page.tsx", `import { coreRepositories } from "@/lib/core"\nimport { BillingStatus, PlanCard, UsageMeter } from "@sapienx/saas-core-ui"\nexport const dynamic = "force-dynamic"\nexport default async function PlanPage() { const repos = await coreRepositories(); const workspaces = await repos.workspaces.listUserWorkspaces() as any[]; const workspace = workspaces[0]; if (!workspace) return <main className="saas-content"><div className="saas-state">Create a workspace to see plan state.</div></main>; const entitlements: any = await repos.entitlements.get(workspace.id); return <main className="saas-content"><div className="saas-eyebrow">Commercial state</div><h1>Plan & usage.</h1><div className="saas-grid two"><div className="saas-card"><BillingStatus plan={entitlements.planName} status={entitlements.subscription.status} /><div style={{marginTop:20}}><UsageMeter label="API calls" used={0} limit={entitlements.limits.api_calls ?? null} /></div></div><div className="saas-card"><h2>Effective entitlement</h2><p>Manual override → scheduled plan → subscription → payment restriction fallback.</p><strong>{entitlements.planName}</strong></div></div><div className="saas-grid three" style={{marginTop:16}}><PlanCard name="Free" price="$0" features={["1 seat","Core workspace"]} current={entitlements.planKey === "free"} /><PlanCard name="Starter" price="$19 / month" features={["3 seats","10k API calls"]} current={entitlements.planKey === "starter"} /><PlanCard name="Pro" price="$49 / month" features={["10 seats","Custom domains","PWA"]} current={entitlements.planKey === "pro"} /></div></main> }\n`],
    ["src/app/app/settings/page.tsx", `export default function SettingsPage() { return <main className="saas-content"><div className="saas-eyebrow">Workspace settings</div><h1>Configure the platform boundary.</h1><div className="saas-grid two"><div className="saas-card"><h2>Product-owned domain</h2><p>Add product tables beneath workspace_id. Core intentionally does not define a universal resources table.</p></div><div className="saas-card"><h2>Optional services</h2><p>Custom domains, workspace PWA branding, Resend and Web Push are configured server-side.</p></div></div></main> }\n`],
    ["src/app/platform/page.tsx", `import { coreRepositories } from "@/lib/core"\nimport { StatusBadge } from "@sapienx/saas-core-ui"\nexport const dynamic = "force-dynamic"\nexport default async function PlatformPage() { const repos = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); if (!member || member.status !== "active") return <main className="saas-content"><div className="saas-state"><strong>Platform Control</strong><p>This account is not a platform operator. Customer workspace roles do not grant platform access.</p></div></main>; let workspaces: any[] = []; try { workspaces = await repos.platform.listWorkspaces() as any[] } catch (error) { return <main className="saas-content"><div className="saas-state error"><strong>Platform query failed</strong><p>{error instanceof Error ? error.message : "Unknown error"}</p></div></main> } return <main className="saas-content"><div className="saas-eyebrow">Platform Control</div><h1>Operator overview.</h1><p>Signed in as <StatusBadge status={member.role} />. Support and auditor paths are read-only.</p><div className="saas-card"><div className="table-scroll"><table className="saas-table"><thead><tr><th>Workspace</th><th>Status</th><th>Plan</th><th>Members</th></tr></thead><tbody>{workspaces.map((workspace: any) => <tr key={workspace.id}><td>{workspace.name}</td><td>{workspace.status}</td><td>{workspace.plan_key}</td><td>{workspace.member_count}</td></tr>)}</tbody></table></div></div></main> }\n`],
    ["public/sw.js", `const CACHE = "saas-core-v1"; self.addEventListener("install", () => self.skipWaiting()); self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim())); self.addEventListener("fetch", (event) => { if (event.request.method === "GET" && new URL(event.request.url).origin === self.location.origin) event.respondWith(fetch(event.request).catch(() => caches.match(event.request))); });\n`],
    ["supabase/config.toml", `project_id = "${key}"\n\n[api]\nenabled = true\nport = 54321\n\n[db]\nport = 54322\n\n[studio]\nenabled = true\nport = 54323\n\n[inbucket]\nenabled = true\nport = 54324\n`],
    ["supabase/seed.sql", `-- SaaS Core does not seed customer data.\n-- Add product-owned deterministic seed data here when needed.\n`],
    ["src/lib/workspace.ts", generatedWorkspaceLibrary()],
    ["src/app/api/workspaces/route.ts", generatedWorkspaceCreateRoute()],
    ["src/app/api/workspaces/select/route.ts", generatedWorkspaceSelectRoute()],
    ["src/app/api/auth/signup/route.ts", generatedSignupRoute()],
    ["src/app/invite/[id]/page.tsx", generatedInvitationPage()],
    ["src/app/api/invitations/[id]/accept/route.ts", generatedInvitationAcceptRoute()],
    ["src/app/api/invitations/route.ts", generatedInvitationRoute()],
    ["src/app/api/billing/checkout/route.ts", generatedBillingCheckoutRoute()],
    ["src/app/api/billing/portal/route.ts", generatedBillingActionRoute("portal")],
    ["src/app/api/billing/cancel/route.ts", generatedBillingActionRoute("cancel")],
    ["src/app/api/billing/resume/route.ts", generatedBillingActionRoute("resume")],
    ["src/app/api/billing/webhook/route.ts", generatedBillingWebhookRoute()],
    ["src/app/api/billing/grace/route.ts", generatedBillingGraceRoute()],
    ["src/app/app/layout.tsx", generatedAppLayout(projectName)],
    ["src/app/app/page.tsx", generatedAppHome()],
    ["src/app/app/team/page.tsx", generatedTeamPage()],
    ["src/app/app/plan/page.tsx", generatedPlanPage()],
    ["src/app/app/settings/page.tsx", generatedSettingsPage()],
    [".env.example", `# SaaS Core generated environment. Copy to .env.local. Secret values stay server-side.\nAPP_URL=http://localhost:3000\nSAAS_CORE_PRODUCT_NAME=${projectName}\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_ANON_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\nPADDLE_ENVIRONMENT=sandbox\nPADDLE_CURRENCY=USD\nPADDLE_API_KEY=\nPADDLE_WEBHOOK_SECRET=\nPADDLE_CRON_SECRET=\nPADDLE_PRICE_STARTER_MONTH=\nPADDLE_PRICE_STARTER_YEAR=\nPADDLE_PRICE_PRO_MONTH=\nPADDLE_PRICE_PRO_YEAR=\nPADDLE_PRICE_BUSINESS_MONTH=\nPADDLE_PRICE_BUSINESS_YEAR=\nRESEND_API_KEY=\nRESEND_FROM_EMAIL=\nVAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=mailto:ops@example.com\n`],
    ["src/app/platform/page.tsx", generatedPlatformIndexPage()],
    ["src/app/platform/workspaces/page.tsx", generatedPlatformWorkspacesPage()],
    ["src/app/platform/workspaces/[id]/page.tsx", generatedPlatformWorkspacePage()],
    ["src/app/platform/users/page.tsx", generatedPlatformUsersPage()],
    ["src/app/platform/health/page.tsx", generatedPlatformHealthPage()],
    ["supabase/migrations/20260824000000_saas_core_v1.sql", coreMigrationSql()],
    ["supabase/migrations/20260824010000_production_hardening.sql", coreMigrationSql("20260824010000_production_hardening.sql")],
    ["supabase/migrations/20260824020000_final_p0_hardening.sql", coreMigrationSql("20260824020000_final_p0_hardening.sql")],
    ["supabase/migrations/20260824040000_v111_platform_operations.sql", coreMigrationSql("20260824040000_v111_platform_operations.sql")],
    ["src/product/README.md", "# Product-owned code\n\nAdd product tables with a workspace_id foreign key and enforce product-specific policies through a Core-derived workspace membership context.\n"],
  ])
  const optionalDependencies = new Set([
    ...(config.billing ? ["@sapienx/saas-core-billing"] : []),
    ...(config.email ? ["@sapienx/saas-core-notifications"] : []),
  ])
  const packageJson = JSON.parse(files.get("package.json") ?? "{}") as { dependencies?: Record<string, string>; pnpm?: { overrides?: Record<string, string> } }
  for (const dependency of ["@sapienx/saas-core-billing", "@sapienx/saas-core-notifications"]) {
    if (!optionalDependencies.has(dependency)) {
      delete packageJson.dependencies?.[dependency]
      delete packageJson.pnpm?.overrides?.[dependency]
    }
  }
  files.set("package.json", json(packageJson))
  files.set("core.config.ts", generatedCoreConfig(projectName, key, config))
  files.set(".env.example", generatedEnvExample(projectName, config))
  files.set("src/app/(auth)/signup/page.tsx", generatedSignupPage())
  files.set("src/app/(auth)/forgot-password/page.tsx", generatedForgotPasswordPage())
  files.set("src/app/(auth)/reset-password/page.tsx", generatedResetPasswordPage())
  files.set("src/app/api/auth/resend-confirmation/route.ts", generatedResendConfirmationRoute())
  files.set("src/app/api/auth/forgot-password/route.ts", generatedForgotPasswordRoute())
  files.set("src/app/api/auth/reset-password/route.ts", generatedResetPasswordRoute())
  files.set("src/app/api/invitations/route.ts", generatedInvitationRouteV11(config.email))
  files.set("src/app/app/layout.tsx", generatedAppLayoutV11(projectName, config))
  files.set("src/app/app/page.tsx", generatedAppHomeV11(config))
  files.set("src/app/app/settings/page.tsx", generatedSettingsPageV11(config))
  files.set("src/app/app/setup/page.tsx", generatedSetupPage(config))
  files.set("src/app/platform/page.tsx", generatedPlatformIndexPageV11())
  files.set("src/lib/platform.tsx", generatedPlatformNavigation())
  files.set("src/app/platform/billing/page.tsx", generatedPlatformBillingPage())
  files.set("src/app/platform/billing/[workspaceId]/page.tsx", generatedPlatformBillingWorkspacePage())
  files.set("src/app/platform/overrides/page.tsx", generatedPlatformOverridesPage())
  files.set("src/app/platform/domains/page.tsx", generatedPlatformDomainsPage())
  files.set("src/app/platform/audit/page.tsx", generatedPlatformAuditPage())
  files.set("src/app/platform/attention/page.tsx", generatedPlatformAttentionPage())
  files.set("src/app/api/platform/overrides/route.ts", generatedPlatformOverrideRoute())
  files.set("src/app/api/platform/overrides/[id]/revoke/route.ts", generatedPlatformRevokeOverrideRoute())
  files.set("src/app/api/platform/domains/[id]/reconcile/route.ts", generatedPlatformDomainReconcileRoute())
  files.set("src/app/api/platform/billing/[workspaceId]/reconcile/route.ts", generatedPlatformBillingReconcileRoute())
  if (!config.billing) for (const file of ["src/app/app/plan/page.tsx", "src/app/api/billing/checkout/route.ts", "src/app/api/billing/portal/route.ts", "src/app/api/billing/cancel/route.ts", "src/app/api/billing/resume/route.ts", "src/app/api/billing/webhook/route.ts", "src/app/api/billing/grace/route.ts"]) files.delete(file)
  if (!config.domains) files.delete("src/app/api/platform/domains/[id]/reconcile/route.ts")
  if (!config.platform) for (const file of ["src/lib/platform.tsx", "src/app/platform/page.tsx", "src/app/platform/workspaces/page.tsx", "src/app/platform/workspaces/[id]/page.tsx", "src/app/platform/users/page.tsx", "src/app/platform/health/page.tsx", "src/app/platform/billing/page.tsx", "src/app/platform/billing/[workspaceId]/page.tsx", "src/app/platform/overrides/page.tsx", "src/app/platform/domains/page.tsx", "src/app/platform/audit/page.tsx", "src/app/platform/attention/page.tsx", "src/app/api/platform/overrides/route.ts", "src/app/api/platform/overrides/[id]/revoke/route.ts", "src/app/api/platform/domains/[id]/reconcile/route.ts", "src/app/api/platform/billing/[workspaceId]/reconcile/route.ts"]) files.delete(file)
  if (!config.pwa) files.delete("public/sw.js")
  files.set("supabase/migrations/20260824030000_v11_operations.sql", coreMigrationSql("20260824030000_v11_operations.sql"))
  files.set("supabase/migrations/20260824040000_v111_platform_operations.sql", coreMigrationSql("20260824040000_v111_platform_operations.sql"))
  return files
}

function generatedCoreConfig(projectName: string, key: string, config: ResolvedCliConfig): string {
  return `import { defineSaaSCore } from "@sapienx/saas-core-config"

export default defineSaaSCore({
  version: "${VERSION}",
  product: { key: ${JSON.stringify(key)}, name: ${JSON.stringify(projectName)} },
  auth: { provider: "supabase", requireEmailConfirmation: true },
  workspace: { slugSource: "user_input", defaultTimezone: "UTC" },
  permissions: { custom: {} },
  billing: { enabled: ${config.billing}, provider: "paddle", environment: "sandbox" },
  entitlements: { features: [], metrics: [] },
  usage: { enabled: true },
  notifications: { email: { name: "resend", enabled: ${config.email} }, push: { name: "web-push", enabled: ${config.push} } },
  domains: { enabled: ${config.domains} },
  pwa: { enabled: ${config.pwa} },
  platform: { enabled: ${config.platform}, supportReadOnly: true },
})
`
}

function generatedEnvExample(projectName: string, config: ResolvedCliConfig): string {
  const lines = [
    "# SaaS Core generated environment. Copy to .env.local. Secret values stay server-side.",
    "APP_URL=http://localhost:3000",
    `SAAS_CORE_PRODUCT_NAME=${projectName}`,
    "NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY=",
    "SUPABASE_URL=http://127.0.0.1:54321",
    "SUPABASE_ANON_KEY=",
    "SUPABASE_SERVICE_ROLE_KEY=",
  ]
  if (config.billing) lines.push("PADDLE_ENVIRONMENT=sandbox", "PADDLE_CURRENCY=USD", "PADDLE_API_KEY=", "PADDLE_WEBHOOK_SECRET=", "PADDLE_CRON_SECRET=", "PADDLE_PRICE_STARTER_MONTH=", "PADDLE_PRICE_STARTER_YEAR=", "PADDLE_PRICE_PRO_MONTH=", "PADDLE_PRICE_PRO_YEAR=", "PADDLE_PRICE_BUSINESS_MONTH=", "PADDLE_PRICE_BUSINESS_YEAR=")
  if (config.email) lines.push("RESEND_API_KEY=", "RESEND_FROM_EMAIL=")
  if (config.domains) lines.push("VERCEL_TOKEN=", "VERCEL_PROJECT_ID=", "VERCEL_TEAM_ID=")
  if (config.push) lines.push("VAPID_PUBLIC_KEY=", "VAPID_PRIVATE_KEY=", "VAPID_SUBJECT=mailto:ops@example.com")
  lines.push("", "# Optional modules are selected in the generated .saas-core.json manifest.")
  return lines.join("\n") + "\n"
}

function authPage(title: string, action: string, prompt: string, href: string, linkText: string): string {
  return `export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) { const params = await searchParams; const next = params.next ?? ""; return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>SaaS Core application</strong></div><div className="saas-eyebrow">Secure account</div><h1>${title}.</h1><p>Sessions are handled by Supabase SSR with PKCE and server-side cookie refresh.</p><form className="saas-form" action="${action}" method="post"><input type="hidden" name="next" value={next} /><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" minLength={8} autoComplete="current-password" required /></label><button className="saas-button" type="submit">${title}</button></form><p><a href="/forgot-password">Forgot password?</a></p><p>${prompt} <a href="${href}">${linkText}</a></p></div></main> }\n`
}

function generatedSignupPage(): string {
  return `export default async function SignupPage({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) { const params = await searchParams; const next = params.next ?? ""; return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>SaaS Core application</strong></div><div className="saas-eyebrow">Secure account</div><h1>Create account.</h1><p>Use the invitation email or your own address. Email confirmation is enforced by the generated Core config.</p>{params.confirmation === "sent" && <div className="notice">Confirmation email sent. Open the local Mailpit message or your configured provider before signing in.</div>}{params.error && <div className="form-error">We could not create that account. Check the email and password, then try again.</div>}<form className="saas-form" action="/api/auth/signup" method="post"><input type="hidden" name="next" value={next} /><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" minLength={8} autoComplete="new-password" required /></label><button className="saas-button" type="submit">Create account</button></form>{params.confirmation === "sent" && <form className="saas-form" action="/api/auth/resend-confirmation" method="post" style={{marginTop:12}}><label>Resend to<input name="email" type="email" autoComplete="email" required /></label><button className="saas-button secondary" type="submit">Resend confirmation</button></form>}<p>Already have an account? <a href={"/login?next=" + encodeURIComponent(next)}>Sign in</a></p></div></main> }\n`
}

function generatedForgotPasswordPage(): string {
  return `export default async function ForgotPassword({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) { const params = await searchParams; return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>Password recovery</strong></div><h1>Reset your password.</h1>{params.sent && <div className="notice">If the account exists, a recovery email has been sent. Check local Mailpit or your configured provider.</div>}{params.error && <div className="form-error">We could not send a recovery request.</div>}<p>Recovery links are same-origin and handled through Supabase PKCE sessions.</p><form className="saas-form" action="/api/auth/forgot-password" method="post"><label>Email<input name="email" type="email" autoComplete="email" required /></label><button className="saas-button" type="submit">Send recovery link</button></form><p><a href="/login">Back to sign in</a></p></div></main> }\n`
}

function generatedResetPasswordPage(): string {
  return `export default async function ResetPassword({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) { const params = await searchParams; return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>Password recovery</strong></div><h1>Choose a new password.</h1>{params.error && <div className="form-error">The recovery session is invalid or expired. Request a new link.</div>}<form className="saas-form" action="/api/auth/reset-password" method="post"><label>New password<input name="password" type="password" minLength={8} required autoComplete="new-password" /></label><button className="saas-button" type="submit">Update password</button></form></div></main> }\n`
}

function generatedResendConfirmationRoute(): string {
  return `import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
export async function POST(request: Request) { const body = await request.formData(); const email = String(body.get("email") ?? "").trim(); const origin = process.env.APP_URL ?? new URL(request.url).origin; const client = await createServerClient(); const result = await client.auth.resend({ type: "signup", email, options: { emailRedirectTo: new URL("/auth/confirm?type=email", origin).toString() } }); const target = new URL("/signup", origin); target.searchParams.set(result.error ? "error" : "confirmation", result.error ? "resend_failed" : "sent"); return NextResponse.redirect(target, { status: 303 }) }
`
}

function generatedForgotPasswordRoute(): string {
  return `import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
export async function POST(request: Request) { const body = await request.formData(); const email = String(body.get("email") ?? "").trim(); const origin = process.env.APP_URL ?? new URL(request.url).origin; const client = await createServerClient(); const result = await client.auth.resetPasswordForEmail(email, { redirectTo: new URL("/auth/confirm?type=recovery", origin).toString() }); const target = new URL(result.error ? "/forgot-password?error=send_failed" : "/forgot-password?sent=1", origin); return NextResponse.redirect(target, { status: 303 }) }
`
}

function generatedResetPasswordRoute(): string {
  return `import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
export async function POST(request: Request) { const body = await request.formData(); const password = String(body.get("password") ?? ""); const origin = process.env.APP_URL ?? new URL(request.url).origin; const client = await createServerClient(); const result = await client.auth.updateUser({ password }); if (result.error) return NextResponse.redirect(new URL("/reset-password?error=update_failed", origin), { status: 303 }); return NextResponse.redirect(new URL("/app", origin), { status: 303 }) }
`
}

function authRoute(method: "signInWithPassword", fallback: string): string {
  return `import { NextResponse } from "next/server"\nimport { createServerClient } from "@/lib/supabase"\nimport { safeRedirect } from "@sapienx/saas-core-runtime"\nexport async function POST(request: Request) { const body = await request.formData(); const email = String(body.get("email") ?? "").trim(); const password = String(body.get("password") ?? ""); const origin = process.env.APP_URL ?? new URL(request.url).origin; const next = safeRedirect(String(body.get("next") ?? ""), origin, "${fallback}"); const client = await createServerClient(); const result = await client.auth.${method}({ email, password }); if (result.error) return NextResponse.redirect(new URL("/login?error=invalid_credentials", origin), { status: 303 }); return NextResponse.redirect(new URL(next, origin), { status: 303 }); }\n`
}

function generatedWorkspaceLibrary(): string {
  return `import { cookies } from "next/headers"
import { createCoreRepositories, createNextServerSupabaseClient, resolveCurrentWorkspace } from "@sapienx/saas-core-runtime"

export async function getWorkspaceContext() {
  const cookieStore = await cookies()
  const client = createNextServerSupabaseClient(cookieStore as any)
  const context = await resolveCurrentWorkspace(client, cookieStore as any)
  return { ...context, client, cookieStore, repos: createCoreRepositories(client) }
}
`
}

function generatedWorkspaceSelectRoute(): string {
  return `import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { createNextServerSupabaseClient, safeRedirect, setCurrentWorkspace } from "@sapienx/saas-core-runtime"
export async function POST(request: Request) {
  const body = await request.formData()
  const cookieStore = await cookies()
  const client = createNextServerSupabaseClient(cookieStore as any)
  const origin = process.env.APP_URL ?? new URL(request.url).origin
  try { await setCurrentWorkspace(client, cookieStore as any, String(body.get("workspaceId") ?? "")) } catch { return NextResponse.redirect(new URL("/app?error=workspace_switch_failed", origin), { status: 303 }) }
  return NextResponse.redirect(new URL(safeRedirect(String(body.get("next") ?? ""), origin, "/app"), origin), { status: 303 })
}
`
}

function generatedWorkspaceCreateRoute(): string {
  return `import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { createCoreRepositories, createNextServerSupabaseClient, setCurrentWorkspace } from "@sapienx/saas-core-runtime"
export async function POST(request: Request) {
  const body = await request.formData(); const cookieStore = await cookies(); const client = createNextServerSupabaseClient(cookieStore as any)
  try { const created: any = await createCoreRepositories(client).workspaces.createWorkspace({ name: String(body.get("name") ?? ""), slug: String(body.get("slug") ?? "") }); const workspace = Array.isArray(created) ? created[0] : created; if (workspace?.id) await setCurrentWorkspace(client, cookieStore as any, workspace.id); const origin = process.env.APP_URL ?? new URL(request.url).origin; return NextResponse.redirect(new URL("/app", origin), { status: 303 }) } catch { const origin = process.env.APP_URL ?? new URL(request.url).origin; return NextResponse.redirect(new URL("/onboarding?error=create_failed", origin), { status: 303 }) }
}
`
}

function generatedSignupRoute(): string {
  return `import { NextResponse } from "next/server"
import { createServerClient } from "@/lib/supabase"
import { safeRedirect } from "@sapienx/saas-core-runtime"
export async function POST(request: Request) { const body = await request.formData(); const email = String(body.get("email") ?? "").trim(); const password = String(body.get("password") ?? ""); const origin = process.env.APP_URL ?? new URL(request.url).origin; const next = safeRedirect(String(body.get("next") ?? ""), origin, "/app"); const client = await createServerClient(); const result = await client.auth.signUp({ email, password, options: { emailRedirectTo: new URL("/auth/confirm?type=email", origin).toString() } }); if (result.error) return NextResponse.redirect(new URL("/signup?error=signup_failed", origin), { status: 303 }); if (result.data.session) return NextResponse.redirect(new URL(next, origin), { status: 303 }); const confirmation = new URL("/signup", origin); confirmation.searchParams.set("confirmation", "sent"); confirmation.searchParams.set("next", next); return NextResponse.redirect(confirmation, { status: 303 }); }
`
}

function generatedInvitationPage(): string {
  return `import { createServiceRoleSupabaseClient, createCoreRepositories, getCurrentUser } from "@sapienx/saas-core-runtime"
import { redirect } from "next/navigation"
export const dynamic = "force-dynamic"
export default async function InvitationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ token?: string; error?: string }> }) {
  const { id } = await params; const query = await searchParams; const token = query.token ?? ""; const returnPath = "/invite/" + encodeURIComponent(id) + "?token=" + encodeURIComponent(token)
  if (!token) return <main className="auth-page"><div className="auth-card"><h1>Invitation link incomplete.</h1><p>This invitation link is missing its secure token.</p></div></main>
  let preview: any = null
  try { preview = await createCoreRepositories(createServiceRoleSupabaseClient()).invitations.preview({ invitationId: id, token }) } catch { preview = null }
  if (!preview || preview.status !== "pending" || preview.revoked_at || new Date(preview.expires_at).getTime() <= Date.now()) return <main className="auth-page"><div className="auth-card"><h1>Invitation unavailable.</h1><p>This invitation is expired, revoked, already accepted, or invalid.</p></div></main>
  const clientUser = await (async () => { try { const { createServerClient } = await import("@/lib/supabase"); return getCurrentUser(await createServerClient()) } catch { return null } })()
  if (!clientUser) return <main className="auth-page"><div className="auth-card"><div className="saas-eyebrow">Workspace invitation</div><h1>Join {preview.workspaces?.name ?? "this workspace"}.</h1><p>Sign in or create an account with <strong>{preview.normalized_email}</strong> to continue.</p><div style={{display:"flex",gap:10,flexWrap:"wrap"}}><a className="saas-button" href={"/login?next=" + encodeURIComponent(returnPath)}>Sign in</a><a className="saas-button secondary" href={"/signup?next=" + encodeURIComponent(returnPath)}>Create account</a></div></div></main>
  const emailMatches = (clientUser.email ?? "").toLowerCase() === preview.normalized_email
  return <main className="auth-page"><div className="auth-card"><div className="saas-eyebrow">Workspace invitation</div><h1>Join {preview.workspaces?.name ?? "this workspace"}.</h1><p>Invited email: <strong>{preview.normalized_email}</strong><br />Role: <strong>{preview.role}</strong></p>{!emailMatches && <div className="form-error">This invitation belongs to {preview.normalized_email}. You are signed in as {clientUser.email ?? "another account"}.</div>}{query.error && <div className="form-error">The invitation could not be accepted. It may be expired, revoked, replayed, or at its seat limit.</div>}{emailMatches && <form className="saas-form" action={"/api/invitations/" + encodeURIComponent(id) + "/accept"} method="post"><input type="hidden" name="token" value={token} /><button className="saas-button" type="submit">Accept invitation</button></form>}</div></main>
}
`
}

function generatedInvitationAcceptRoute(): string {
  return `import { cookies } from "next/headers"
import { NextResponse } from "next/server"
import { createCoreRepositories, createNextServerSupabaseClient, setCurrentWorkspace } from "@sapienx/saas-core-runtime"
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const body = await request.formData(); const token = String(body.get("token") ?? ""); const origin = process.env.APP_URL ?? new URL(request.url).origin; const cookieStore = await cookies(); const client = createNextServerSupabaseClient(cookieStore as any); try { const member: any = await createCoreRepositories(client).invitations.accept({ invitationId: id, token }); const workspaceId = Array.isArray(member) ? member[0]?.workspace_id : member?.workspace_id; if (workspaceId) await setCurrentWorkspace(client, cookieStore as any, workspaceId); return NextResponse.redirect(new URL("/app?invited=1", origin), { status: 303 }) } catch { return NextResponse.redirect(new URL("/invite/" + encodeURIComponent(id) + "?token=" + encodeURIComponent(token) + "&error=accept_failed", origin), { status: 303 }) } }
`
}

function generatedInvitationRoute(): string {
  return `import { NextResponse } from "next/server"
import { createServiceRoleSupabaseClient, createCoreRepositories as createRepositories, createNextServerSupabaseClient } from "@sapienx/saas-core-runtime"
import { buildInvitationEmail, ResendEmailProvider, sendWithRetry } from "@sapienx/saas-core-notifications"
import { cookies } from "next/headers"
export async function POST(request: Request) { const body = await request.formData(); const cookieStore = await cookies(); const client = createNextServerSupabaseClient(cookieStore as any); const repos = createRepositories(client); try { const context: any = await (await import("@/lib/workspace")).getWorkspaceContext(); const workspaceId = context.currentWorkspace?.id ?? ""; if (!workspaceId) throw new Error("NO_CURRENT_WORKSPACE"); const result: any = await repos.invitations.create({ workspaceId, email: String(body.get("email") ?? ""), role: String(body.get("role") ?? "member") }); const invitation = Array.isArray(result.invitation) ? result.invitation[0] : result.invitation; const origin = process.env.APP_URL ?? new URL(request.url).origin; const invitationUrl = origin + "/invite/" + encodeURIComponent(invitation.id) + "?token=" + encodeURIComponent(result.token); const workspace: any = await repos.workspaces.getWorkspace(workspaceId); let localLink = invitationUrl; if (process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL) { try { const message = buildInvitationEmail({ productName: process.env.SAAS_CORE_PRODUCT_NAME ?? "SaaS Core", workspaceName: workspace?.name ?? "your workspace", role: String(body.get("role") ?? "member"), invitationUrl, to: String(body.get("email") ?? "") }); const sent = await sendWithRetry(new ResendEmailProvider({ apiKey: process.env.RESEND_API_KEY, from: process.env.RESEND_FROM_EMAIL }), message); if (process.env.SUPABASE_SERVICE_ROLE_KEY) await createRepositories(createServiceRoleSupabaseClient()).invitations.markDelivery({ invitationId: invitation.id, status: "sent", providerMessageId: sent.id }); localLink = "" } catch (error) { if (process.env.SUPABASE_SERVICE_ROLE_KEY) await createRepositories(createServiceRoleSupabaseClient()).invitations.markDelivery({ invitationId: invitation.id, status: "failed", error: error instanceof Error ? error.message : "Email delivery failed." }); return NextResponse.redirect(new URL("/app/team?error=invite_delivery_failed", origin), { status: 303 }) } } const target = new URL("/app/team", origin); target.searchParams.set("invited", "1"); if (localLink) target.searchParams.set("local_invitation_link", localLink); return NextResponse.redirect(target, { status: 303 }) } catch { return NextResponse.redirect(new URL("/app/team?error=invite_failed", process.env.APP_URL ?? request.url), { status: 303 }) }
}
`
}

function generatedInvitationRouteV11(emailEnabled: boolean): string {
  if (emailEnabled) return generatedInvitationRoute()
  return `import { NextResponse } from "next/server"
import { coreRepositories } from "@/lib/core"
import { cookies } from "next/headers"
export async function POST(request: Request) { const body = await request.formData(); const cookieStore = await cookies(); const context: any = await (await import("@/lib/workspace")).getWorkspaceContext(); const workspaceId = context.currentWorkspace?.id ?? ""; const origin = process.env.APP_URL ?? new URL(request.url).origin; try { const result: any = await (await coreRepositories()).invitations.create({ workspaceId, email: String(body.get("email") ?? ""), role: String(body.get("role") ?? "member") }); const invitation = Array.isArray(result.invitation) ? result.invitation[0] : result.invitation; const invitationUrl = new URL("/invite/" + encodeURIComponent(invitation.id) + "?token=" + encodeURIComponent(result.token), origin).toString(); const target = new URL("/app/team", origin); target.searchParams.set("invited", "1"); target.searchParams.set("local_invitation_link", invitationUrl); return NextResponse.redirect(target, { status: 303 }) } catch { return NextResponse.redirect(new URL("/app/team?error=invite_failed", origin), { status: 303 }) } }
`
}

function generatedBillingCheckoutRoute(): string {
  return `import { NextResponse } from "next/server"
import { createCoreRepositories, createNextServerSupabaseClient } from "@sapienx/saas-core-runtime"
import { readPaddlePriceMappings, PaddleBillingProvider } from "@sapienx/saas-core"
import { createBillingService } from "@sapienx/saas-core-billing"
import { cookies } from "next/headers"
export async function POST(request: Request) { const body = await request.formData(); const planKey = String(body.get("planKey") ?? ""); const interval = String(body.get("interval") ?? "month") as "month" | "year"; const cookieStore = await cookies(); const client = createNextServerSupabaseClient(cookieStore as any); const repos = createCoreRepositories(client); try { const workspace: any = await (await import("@/lib/workspace")).getWorkspaceContext().then((context) => context.currentWorkspace); const member: any = workspace ? await repos.memberships.get(workspace.id) : null; if (!workspace || !member || !["owner", "admin"].includes(member.role)) throw new Error("FORBIDDEN"); if (!process.env.PADDLE_API_KEY) throw new Error("BILLING_NOT_CONFIGURED"); const subscription: any = await repos.billing.getSubscription(workspace.id); const environment = process.env.PADDLE_ENVIRONMENT === "live" ? "live" : "sandbox"; const provider = new PaddleBillingProvider({ apiKey: process.env.PADDLE_API_KEY }); const service = createBillingService({ provider, mappings: readPaddlePriceMappings(), environment }); const result = await service.createCheckout({ planKey, interval, currency: process.env.PADDLE_CURRENCY ?? "USD", customerId: subscription?.provider_customer_id, returnUrl: new URL("/app/plan?checkout=complete", request.url).toString() }); return NextResponse.redirect(result.checkoutUrl, { status: 303 }) } catch (error) { const target = new URL("/app/plan", request.url); target.searchParams.set("error", error instanceof Error ? error.message === "BILLING_NOT_CONFIGURED" ? "billing_not_configured" : "checkout_failed" : "checkout_failed"); return NextResponse.redirect(target, { status: 303 }) } }
`
}

function generatedBillingActionRoute(action: "portal" | "cancel" | "resume"): string {
  return `import { NextResponse } from "next/server"
import { createCoreRepositories, createNextServerSupabaseClient } from "@sapienx/saas-core-runtime"
import { PaddleBillingProvider } from "@sapienx/saas-core"
import { cookies } from "next/headers"
export async function POST(request: Request) { const cookieStore = await cookies(); const client = createNextServerSupabaseClient(cookieStore as any); const repos = createCoreRepositories(client); try { const workspace: any = (await import("@/lib/workspace")).getWorkspaceContext; const context: any = await workspace(); const current = context.currentWorkspace; const member: any = current ? await repos.memberships.get(current.id) : null; if (!current || !member || !["owner", "admin"].includes(member.role)) throw new Error("FORBIDDEN"); const subscription: any = await repos.billing.getSubscription(current.id); if (!subscription?.provider_subscription_id && ${action === "portal" ? "false" : "true"}) throw new Error("NO_PROVIDER_SUBSCRIPTION"); if (!process.env.PADDLE_API_KEY) throw new Error("BILLING_NOT_CONFIGURED"); const provider = new PaddleBillingProvider({ apiKey: process.env.PADDLE_API_KEY }); ${action === "portal" ? `if (!subscription?.provider_customer_id) throw new Error("NO_PROVIDER_CUSTOMER"); const result = await provider.createPortalSession({ customerId: subscription.provider_customer_id, returnUrl: new URL("/app/plan", request.url).toString() }); return NextResponse.redirect(result.portalUrl, { status: 303 })` : action === "cancel" ? `await provider.cancelAtPeriodEnd(subscription.provider_subscription_id); return NextResponse.redirect(new URL("/app/plan?billing_action=cancel_requested", request.url), { status: 303 })` : `if (!provider.resume) throw new Error("RESUME_UNSUPPORTED"); await provider.resume(subscription.provider_subscription_id); return NextResponse.redirect(new URL("/app/plan?billing_action=resume_requested", request.url), { status: 303 })`} } catch { return NextResponse.redirect(new URL("/app/plan?error=billing_action_failed", request.url), { status: 303 }) } }
`
}

function generatedBillingWebhookRoute(): string {
  return `import { NextResponse } from "next/server"
import { createCoreRepositories, createServiceRoleSupabaseClient } from "@sapienx/saas-core-runtime"
import { normalizePaddleEvent, normalizePaddleSubscription, processPaddleWebhook } from "@sapienx/saas-core-billing"
import { readPaddlePriceMappings } from "@sapienx/saas-core"
export async function POST(request: Request) { const rawBody = await request.text(); const signature = request.headers.get("Paddle-Signature") ?? ""; const secret = process.env.PADDLE_WEBHOOK_SECRET; if (!secret) return NextResponse.json({ error: "billing_not_configured" }, { status: 503 }); try { const service = createCoreRepositories(createServiceRoleSupabaseClient()); const store = { insert: (record: any) => service.billing.insertWebhook(record), markProcessing: (eventId: string) => service.billing.markWebhookProcessing(eventId), markProcessed: (eventId: string) => service.billing.markWebhookProcessed(eventId), markIgnored: (eventId: string, reason: string) => service.billing.markWebhookIgnored(eventId, reason), markFailed: (eventId: string, error: { code: string; message: string }) => service.billing.markWebhookFailed(eventId, error) }; const result = await processPaddleWebhook({ rawBody, signature, secret, store, apply: async (event) => { const data: any = event.data; const subscriptionId = String(data.id ?? ""); const existing: any = subscriptionId ? await service.billing.findSubscriptionByProviderId(subscriptionId) : null; const priceId = String(data.items?.[0]?.price?.id ?? ""); const mapping = readPaddlePriceMappings().find((candidate) => candidate.providerPriceId === priceId); if (!mapping) throw new Error("UNKNOWN_PRICE_MAPPING"); const workspaceId = String(data.custom_data?.workspace_id ?? data.customData?.workspace_id ?? existing?.workspace_id ?? ""); if (!workspaceId) throw new Error("UNKNOWN_WORKSPACE"); const snapshot = normalizePaddleSubscription({ event, environment: process.env.PADDLE_ENVIRONMENT === "live" ? "live" : "sandbox", planKey: mapping.planKey, interval: mapping.interval, currency: mapping.currency }); await service.billing.applySubscriptionPatch(workspaceId, { plan_key: snapshot.planKey, status: snapshot.status, provider: "paddle", provider_environment: snapshot.environment, provider_customer_id: snapshot.providerCustomerId, provider_subscription_id: snapshot.providerSubscriptionId, current_period_start: snapshot.currentPeriodStart, current_period_end: snapshot.currentPeriodEnd, scheduled_plan_key: snapshot.scheduledPlanKey, scheduled_plan_at: snapshot.scheduledPlanAt, billing_interval: snapshot.interval, billing_currency: snapshot.currency, provider_price_id: snapshot.providerPriceId, last_provider_event_at: snapshot.occurredAt, last_provider_event_id: event.eventId, billing_issue_code: snapshot.status === "past_due" ? "past_due" : null }) } }); return NextResponse.json({ status: result }) } catch { return NextResponse.json({ error: "webhook_rejected" }, { status: 400 }) } }
`
}

function generatedBillingGraceRoute(): string {
  return `import { NextResponse } from "next/server"
import { createCoreRepositories, createServiceRoleSupabaseClient } from "@sapienx/saas-core-runtime"
export async function POST(request: Request) { const expected = process.env.PADDLE_CRON_SECRET ?? process.env.CRON_SECRET; const authorization = request.headers.get("authorization") ?? ""; if (!expected || authorization !== "Bearer " + expected) return NextResponse.json({ error: "unauthorized" }, { status: 401 }); try { const result = await createCoreRepositories(createServiceRoleSupabaseClient()).billing.expirePaymentGrace(); return NextResponse.json({ expired: result }) } catch { return NextResponse.json({ error: "grace_job_failed" }, { status: 500 }) } }
`
}

function generatedPlatformIndexPage(): string {
  return `import Link from "next/link"
import { coreRepositories } from "@/lib/core"
import { StatusBadge } from "@sapienx/saas-core-ui"
export const dynamic = "force-dynamic"
export default async function PlatformPage() { const repos = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); if (!member || member.status !== "active") return <main className="saas-content"><div className="saas-state"><strong>Platform Control</strong><p>This account is not a platform operator. Customer workspace roles do not grant platform access.</p></div></main>; let workspaces: any[] = []; try { workspaces = await repos.platform.listWorkspaces() as any[] } catch (error) { return <main className="saas-content"><div className="saas-state error"><strong>Platform query failed</strong><p>{error instanceof Error ? error.message : "Unknown error"}</p></div></main> } return <main className="saas-content"><div className="saas-eyebrow">Platform Control</div><h1>Operator overview.</h1><p>Signed in as <StatusBadge status={member.role} />. Support and auditor paths are read-only.</p><div className="saas-grid three"><Link className="saas-card" href="/platform/workspaces"><h3>Workspaces</h3><p>Customer workspace list and Workspace 360.</p></Link><Link className="saas-card" href="/platform/users"><h3>Users</h3><p>Platform directory with read-only inspection.</p></Link><Link className="saas-card" href="/platform/health"><h3>Health</h3><p>Database, RLS, migrations, and failed webhook signals.</p></Link></div><div className="saas-card" style={{marginTop:16}}><h2>Workspace distribution</h2><div className="table-scroll"><table className="saas-table"><thead><tr><th>Workspace</th><th>Status</th><th>Plan</th><th>Members</th></tr></thead><tbody>{workspaces.map((workspace: any) => <tr key={workspace.id}><td><Link href={"/platform/workspaces/" + workspace.id}>{workspace.name}</Link></td><td>{workspace.status}</td><td>{workspace.plan_key}</td><td>{workspace.member_count}</td></tr>)}</tbody></table></div></div></main> }
`
}

function generatedPlatformNavigation(): string {
  return `import Link from "next/link"
const links = [
  { label: "Overview", href: "/platform", roles: ["platform_owner", "platform_admin", "billing_admin", "support", "auditor"] },
  { label: "Workspaces", href: "/platform/workspaces", roles: ["platform_owner", "platform_admin", "support", "auditor"] },
  { label: "Users", href: "/platform/users", roles: ["platform_owner", "platform_admin", "support"] },
  { label: "Billing", href: "/platform/billing", roles: ["platform_owner", "platform_admin", "billing_admin"] },
  { label: "Overrides", href: "/platform/overrides", roles: ["platform_owner", "platform_admin", "billing_admin"] },
  { label: "Domains", href: "/platform/domains", roles: ["platform_owner", "platform_admin", "support", "auditor"] },
  { label: "Attention", href: "/platform/attention", roles: ["platform_owner", "platform_admin", "billing_admin", "support", "auditor"] },
  { label: "Audit", href: "/platform/audit", roles: ["platform_owner", "platform_admin", "support", "auditor"] },
  { label: "Health", href: "/platform/health", roles: ["platform_owner", "platform_admin", "support", "auditor"] },
] as const
export function PlatformNavigation({ role }: { role?: string | null }) { return <nav aria-label="Platform Control" style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:20}}>{links.filter((link) => role && link.roles.includes(role as never)).map((link) => <Link key={link.href} className="saas-button secondary" href={link.href}>{link.label}</Link>)}</nav> }
`
}

function generatedPlatformIndexPageV11(): string {
  return `import Link from "next/link"
import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
import { StatusBadge } from "@sapienx/saas-core-ui"
export const dynamic = "force-dynamic"
export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = await searchParams; const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember()
  if (!member || member.status !== "active") return <main className="saas-content"><div className="saas-state"><strong>Platform Control</strong><p>This account is not a platform operator. Customer workspace roles do not grant platform access.</p></div></main>
  const can = (roles: string[]) => roles.includes(member.role)
  try {
    const workspaces: any[] = can(["platform_owner", "platform_admin", "support", "auditor"]) ? await repos.platform.listWorkspaces() : []
    const billing: any[] = can(["platform_owner", "platform_admin", "billing_admin"]) ? await repos.platform.listSubscriptions(12) : []
    const attention: any[] = await repos.platform.attentionFiltered({ limit: 12 })
    const search: any[] = query.q?.trim() ? await repos.platform.search(query.q.trim(), 20) : []
    return <main className="saas-content"><PlatformNavigation role={member.role} /><div className="saas-eyebrow">Platform Control</div><h1>Operator overview.</h1><p>Signed in as <StatusBadge status={member.role} />. Support and auditor paths are read-only and never impersonate customers.</p><form className="saas-card saas-form" method="get"><label>Search permitted records<input name="q" defaultValue={query.q ?? ""} placeholder="Search" /></label><button className="saas-button" type="submit">Search</button></form><div className="saas-grid three" style={{marginTop:16}}>{can(["platform_owner", "platform_admin", "support", "auditor"]) && <Link className="saas-card" href="/platform/workspaces"><h3>Workspaces</h3><p>{workspaces.length} customer workspaces.</p></Link>}{can(["platform_owner", "platform_admin", "billing_admin"]) && <Link className="saas-card" href="/platform/billing"><h3>Billing operations</h3><p>{billing.length} recent subscription records.</p></Link>}<Link className="saas-card" href="/platform/attention"><h3>Needs attention</h3><p>{attention.length} current operational signals.</p></Link>{can(["platform_owner", "platform_admin", "support", "auditor"]) && <Link className="saas-card" href="/platform/health"><h3>Health</h3><p>Database and provider diagnostics.</p></Link>}</div>{query.q && <div className="saas-card" style={{marginTop:16}}><h2>Search results</h2>{search.length ? <div className="table-scroll"><table className="saas-table"><thead><tr><th>Type</th><th>Result</th><th>Detail</th></tr></thead><tbody>{search.map((item: any) => <tr key={item.result_type + item.id}><td>{item.result_type}</td><td><Link href={item.href}>{item.title}</Link></td><td>{item.subtitle}</td></tr>)}</tbody></table></div> : <p>No matching permitted records.</p>}</div>}<div className="saas-card" style={{marginTop:16}}><h2>Needs attention <span className="saas-badge warning">{attention.length}</span></h2>{attention.length ? <div className="table-scroll"><table className="saas-table"><thead><tr><th>Severity</th><th>Workspace</th><th>Issue</th><th>Action</th></tr></thead><tbody>{attention.map((item: any) => <tr key={item.issue_key}><td>{item.severity}</td><td>{item.workspace_name}</td><td>{item.message}</td><td><Link href={item.deep_link}>Review</Link></td></tr>)}</tbody></table></div> : <p>No current attention items.</p>}</div></main>
  } catch (error) { return <main className="saas-content"><div className="saas-state error"><strong>Platform query failed</strong><p>{error instanceof Error ? error.message : "Unknown error"}</p></div></main> }
}
`
}

function generatedPlatformBillingPage(): string {
  return `import Link from "next/link"
import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformBillingPage() { const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const rows: any[] = await repos.platform.listSubscriptions(200) as any[]; return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Platform Control</div><h1>Billing operations.</h1><p>Local Core state is the authorization source; provider data is synchronization evidence.</p><div className="saas-card"><div className="table-scroll"><table className="saas-table"><thead><tr><th>Workspace</th><th>Plan</th><th>Status</th><th>Interval</th><th>Grace</th><th>Issue</th><th>Action</th></tr></thead><tbody>{rows.map((row: any) => <tr key={row.workspace_id}><td><Link href={"/platform/billing/" + row.workspace_id}>{row.workspace_name}</Link></td><td>{row.plan_key}</td><td>{row.status}</td><td>{row.billing_interval ?? "—"}</td><td>{row.payment_grace_ends_at ?? "—"}</td><td>{row.billing_issue_code ?? "—"}</td><td><Link href={"/platform/billing/" + row.workspace_id}>Open</Link></td></tr>)}</tbody></table></div></div></main> }
`
}

function generatedPlatformBillingWorkspacePage(): string {
  return `import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformBillingWorkspacePage({ params, searchParams }: { params: Promise<{ workspaceId: string }>; searchParams: Promise<{ error?: string; operationId?: string }> }) { const { workspaceId } = await params; const query = await searchParams; const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const subscription: any = await repos.platform.getBillingSubscription(workspaceId); return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Billing detail · operator read-only</div><h1>{workspaceId}.</h1>{query.error && <div className="form-error">Reconciliation was not applied: {query.error.replaceAll("_", " ")}.</div>}{query.operationId && <div className="notice">Operation {query.operationId} completed. Local authorization changes only after verified provider evidence.</div>}<div className="saas-grid three"><div className="saas-card"><span className="saas-card-kicker">Plan</span><h3>{subscription?.plan_key ?? "unknown"}</h3><p>{subscription?.status ?? "unknown"}</p></div><div className="saas-card"><span className="saas-card-kicker">Provider</span><h3>{subscription?.provider ?? "free"}</h3><p>{subscription?.provider_subscription_id ?? "No provider subscription"}</p></div><div className="saas-card"><span className="saas-card-kicker">Grace</span><h3>{subscription?.payment_grace_ends_at ?? "Not in grace"}</h3><p>{subscription?.billing_issue_code ?? "No billing issue"}</p></div></div><div className="saas-card" style={{marginTop:16}}><h2>Provider reconciliation</h2><p>Runs only with configured Paddle credentials and a provider subscription id. Missing credentials or provider failures remain visible as errors.</p><form action={"/api/platform/billing/" + workspaceId + "/reconcile"} method="post"><button className="saas-button" type="submit">Reconcile provider state</button></form></div></main> }
`
}

function generatedPlatformAttentionPage(): string {
  return `import Link from "next/link"
import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformAttentionPage({ searchParams }: { searchParams: Promise<{ severity?: string; issueType?: string }> }) { const query = await searchParams; const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const rows: any[] = await repos.platform.attentionFiltered({ limit: 200, severity: query.severity, issueType: query.issueType }) as any[]; return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Platform Control</div><h1>Needs attention.</h1><p>These rows are generated from current Core state, not static dashboard counters.</p><form className="saas-card saas-form" method="get"><select name="severity" defaultValue={query.severity ?? ""}><option value="">All severities</option><option value="error">Error</option><option value="warning">Warning</option></select><input name="issueType" placeholder="Issue type" defaultValue={query.issueType ?? ""} /><button className="saas-button" type="submit">Filter</button></form><div className="saas-card" style={{marginTop:16}}><div className="table-scroll"><table className="saas-table"><thead><tr><th>Severity</th><th>Workspace</th><th>Issue</th><th>Message</th><th>First observed</th><th>Action</th></tr></thead><tbody>{rows.map((row: any) => <tr key={row.issue_key}><td>{row.severity}</td><td>{row.workspace_name}</td><td>{row.issue_type}</td><td>{row.message}</td><td>{row.first_observed}</td><td><Link href={row.deep_link}>Open</Link></td></tr>)}</tbody></table></div></div></main> }
`
}

function generatedPlatformOverrideRoute(): string {
  return `import { NextResponse } from "next/server"
import { createOperationId } from "@sapienx/saas-core"
import { coreRepositories } from "@/lib/core"
export async function POST(request: Request) { const body = await request.formData(); const origin = process.env.APP_URL ?? new URL(request.url).origin; try { await (await coreRepositories()).platform.createOverride({ workspaceId: String(body.get("workspaceId") ?? ""), planKey: String(body.get("planKey") ?? ""), reason: String(body.get("reason") ?? ""), effectiveUntil: body.get("effectiveUntil") ? new Date(String(body.get("effectiveUntil"))).toISOString() : null, operationId: createOperationId("override") }); return NextResponse.redirect(new URL("/platform/overrides?state=active", origin), { status: 303 }) } catch (error) { const target = new URL("/platform/overrides", origin); target.searchParams.set("error", error instanceof Error ? error.message : "override_failed"); return NextResponse.redirect(target, { status: 303 }) } }
`
}

function generatedPlatformRevokeOverrideRoute(): string {
  return `import { NextResponse } from "next/server"
import { createOperationId } from "@sapienx/saas-core"
import { coreRepositories } from "@/lib/core"
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const body = await request.formData(); const origin = process.env.APP_URL ?? new URL(request.url).origin; try { await (await coreRepositories()).platform.revokeOverride({ overrideId: id, reason: String(body.get("reason") ?? ""), operationId: createOperationId("override-revoke") }); return NextResponse.redirect(new URL("/platform/overrides?state=active", origin), { status: 303 }) } catch (error) { const target = new URL("/platform/overrides", origin); target.searchParams.set("error", error instanceof Error ? error.message : "override_revoke_failed"); return NextResponse.redirect(target, { status: 303 }) } }
`
}

function generatedPlatformDomainReconcileRoute(): string {
  return `import { NextResponse } from "next/server"
import { createOperationId } from "@sapienx/saas-core"
import { VercelDomainProvider, reconcileDomainState } from "@sapienx/saas-core-domains"
import { coreRepositories } from "@/lib/core"
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) { const { id } = await params; const origin = process.env.APP_URL ?? new URL(request.url).origin; const operationId = createOperationId("domain-reconcile"); if (!process.env.VERCEL_TOKEN || !process.env.VERCEL_PROJECT_ID) { const target = new URL("/platform/domains", origin); target.searchParams.set("error", "domains_not_configured"); return NextResponse.redirect(target, { status: 303 }) } try { const repos: any = await coreRepositories(); const domain: any = await repos.platform.getDomain(id); if (!domain) throw new Error("DOMAIN_NOT_FOUND"); const provider = new VercelDomainProvider({ token: process.env.VERCEL_TOKEN, projectId: process.env.VERCEL_PROJECT_ID, teamId: process.env.VERCEL_TEAM_ID }); const state: any = await reconcileDomainState(provider, { hostname: domain.hostname, providerDomainId: domain.provider_domain_id }); await repos.platform.applyDomainReconciliation({ domainId: id, providerDomainId: state.providerDomainId, status: state.status, verificationState: state.verificationState, dnsConfigured: state.dnsConfigured, sslState: state.sslState, lastError: state.lastError, operationId }); return NextResponse.redirect(new URL("/platform/domains", origin), { status: 303 }) } catch (error) { const target = new URL("/platform/domains", origin); target.searchParams.set("error", error instanceof Error ? error.message : "domain_reconcile_failed"); return NextResponse.redirect(target, { status: 303 }) } }
`
}

function generatedPlatformBillingReconcileRoute(): string {
  return `import { NextResponse } from "next/server"
import { createOperationId, readPaddlePriceMappings, PaddleBillingProvider } from "@sapienx/saas-core"
import { normalizePaddleSubscription } from "@sapienx/saas-core-billing"
import { coreRepositories } from "@/lib/core"
export async function POST(request: Request, { params }: { params: Promise<{ workspaceId: string }> }) { const { workspaceId } = await params; const origin = process.env.APP_URL ?? new URL(request.url).origin; const operationId = createOperationId("billing-reconcile"); const target = new URL("/platform/billing/" + workspaceId, origin); target.searchParams.set("operationId", operationId); try { if (!process.env.PADDLE_API_KEY) throw new Error("BILLING_NOT_CONFIGURED"); const repos: any = await coreRepositories(); const local: any = await repos.platform.getBillingSubscription(workspaceId); if (!local?.provider_subscription_id) throw new Error("NO_PROVIDER_SUBSCRIPTION"); const provider = new PaddleBillingProvider({ apiKey: process.env.PADDLE_API_KEY }); if (!provider.getSubscription) throw new Error("PROVIDER_READ_UNSUPPORTED"); const data: any = await provider.getSubscription(local.provider_subscription_id); const priceId = String((Array.isArray(data.items) ? data.items[0] : null)?.price?.id ?? ""); const mapping: any = readPaddlePriceMappings().find((candidate: any) => candidate.providerPriceId === priceId); if (!mapping) throw new Error("UNKNOWN_PRICE_MAPPING"); const occurredAt = String(data.updated_at ?? new Date().toISOString()); const snapshot: any = normalizePaddleSubscription({ event: { eventId: "reconcile:" + operationId, eventType: "subscription.reconciled", occurredAt, data }, environment: process.env.PADDLE_ENVIRONMENT === "live" ? "live" : "sandbox", planKey: mapping.planKey, interval: mapping.interval, currency: mapping.currency }); await repos.platform.applyBillingReconciliation({ workspaceId, planKey: snapshot.planKey, status: snapshot.status, providerCustomerId: snapshot.providerCustomerId, providerSubscriptionId: snapshot.providerSubscriptionId, providerPriceId: snapshot.providerPriceId, interval: snapshot.interval, currency: snapshot.currency, periodStart: snapshot.currentPeriodStart, periodEnd: snapshot.currentPeriodEnd, scheduledPlanKey: snapshot.scheduledPlanKey, scheduledPlanAt: snapshot.scheduledPlanAt, occurredAt: snapshot.occurredAt, operationId }); return NextResponse.redirect(target, { status: 303 }) } catch (error) { target.searchParams.set("error", error instanceof Error && ["BILLING_NOT_CONFIGURED", "NO_PROVIDER_SUBSCRIPTION", "PROVIDER_READ_UNSUPPORTED", "UNKNOWN_PRICE_MAPPING"].includes(error.message) ? error.message.toLowerCase() : "provider_reconciliation_failed"); return NextResponse.redirect(target, { status: 303 }) } }
`
}

function generatedPlatformOverridesPage(): string {
  return `import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformOverridesPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) { const query = await searchParams; const state = query.state ?? "active"; const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const canMutate = ["platform_owner", "platform_admin", "billing_admin"].includes(member?.role); const rows: any[] = await repos.platform.listOverrides(state, 200) as any[]; return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Platform Control</div><h1>Entitlement overrides.</h1><p>Every mutation requires a reason and writes an audit event.</p>{canMutate && <form className="saas-card saas-form" action="/api/platform/overrides" method="post"><h2>Create override</h2><input name="workspaceId" placeholder="Workspace ID" required /><input name="planKey" placeholder="Plan key" required /><input name="reason" placeholder="Reason" minLength={3} required /><label>Expires at<input name="effectiveUntil" type="datetime-local" /></label><button className="saas-button" type="submit">Create audited override</button></form>}<form className="saas-card saas-form" method="get" style={{marginTop:16}}><label>State<select name="state" defaultValue={state}><option value="active">Active</option><option value="expiring">Expiring</option><option value="expired">Expired</option><option value="revoked">Revoked</option><option value="all">All</option></select></label><button className="saas-button" type="submit">Filter</button></form><div className="saas-card" style={{marginTop:16}}><div className="table-scroll"><table className="saas-table"><thead><tr><th>Workspace</th><th>Plan</th><th>Reason</th><th>Effective</th><th>Until</th><th>Status</th><th>Action</th></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}><td>{row.workspace_name}</td><td>{row.plan_key}</td><td>{row.reason}</td><td>{row.effective_from}</td><td>{row.effective_until ?? "No expiry"}</td><td>{row.revoked_at ? "revoked" : "active"}</td><td>{canMutate && !row.revoked_at && <form action={"/api/platform/overrides/" + row.id + "/revoke"} method="post"><input name="reason" placeholder="Reason" minLength={3} required /><button className="saas-button secondary" type="submit">Revoke</button></form>}</td></tr>)}</tbody></table></div></div></main> }
`
}

function generatedPlatformDomainsPage(): string {
  return `import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformDomainsPage() { const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const canMutate = ["platform_owner", "platform_admin"].includes(member?.role); const rows: any[] = await repos.platform.listDomains(200) as any[]; return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Platform Control</div><h1>Custom domains.</h1><p>Provider reconciliation runs only when Vercel credentials are configured; no action is reported as successful otherwise.</p><div className="saas-card"><div className="table-scroll"><table className="saas-table"><thead><tr><th>Hostname</th><th>Workspace</th><th>Status</th><th>Verification</th><th>SSL</th><th>Error</th><th>Action</th></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}><td>{row.hostname}</td><td>{row.workspace_name}</td><td>{row.status}</td><td>{row.verification_state}</td><td>{row.ssl_state}</td><td>{row.provider_error ?? "—"}</td><td>{canMutate && <form action={"/api/platform/domains/" + row.id + "/reconcile"} method="post"><button className="saas-button secondary" type="submit">Reconcile</button></form>}</td></tr>)}</tbody></table></div></div></main> }
`
}

function generatedPlatformAuditPage(): string {
  return `import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformAuditPage({ searchParams }: { searchParams: Promise<{ action?: string; entityType?: string; offset?: string }> }) { const query = await searchParams; const offset = Number(query.offset ?? "0") || 0; const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const rows: any[] = await repos.platform.listAudit({ action: query.action, entityType: query.entityType, limit: 50, offset }) as any[]; return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Platform Control</div><h1>Audit events.</h1><p>Read-only, paginated and redacted at the database boundary. Support views never impersonate customers.</p><form className="saas-card saas-form" method="get"><input name="action" placeholder="Action filter" defaultValue={query.action ?? ""} /><input name="entityType" placeholder="Entity type filter" defaultValue={query.entityType ?? ""} /><button className="saas-button" type="submit">Filter</button></form><div className="saas-card" style={{marginTop:16}}><div className="table-scroll"><table className="saas-table"><thead><tr><th>Time</th><th>Actor</th><th>Action</th><th>Entity</th><th>Reason</th></tr></thead><tbody>{rows.map((row: any) => <tr key={row.id}><td>{row.created_at}</td><td>{row.actor_user_id ?? "System"}</td><td>{row.action}</td><td>{row.entity_type} / {row.entity_id}</td><td>{row.reason ?? "—"}</td></tr>)}</tbody></table></div><div style={{display:"flex",gap:8,marginTop:16}}>{offset > 0 && <a className="saas-button secondary" href={"/platform/audit?offset=" + Math.max(0, offset - 50)}>Previous</a>}{rows.length === 50 && <a className="saas-button secondary" href={"/platform/audit?offset=" + (offset + 50)}>Next</a>}</div></div></main> }
`
}

function generatedPlatformWorkspacesPage(): string {
  return `import Link from "next/link"
import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformWorkspacesPage() { const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const workspaces: any[] = await repos.platform.listWorkspaces() as any[]; return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Platform Control</div><h1>Workspaces.</h1><div className="saas-card"><div className="table-scroll"><table className="saas-table"><thead><tr><th>Name</th><th>Slug</th><th>Status</th><th>Plan</th><th>Members</th></tr></thead><tbody>{workspaces.map((workspace: any) => <tr key={workspace.id}><td><Link href={"/platform/workspaces/" + workspace.id}>{workspace.name}</Link></td><td>{workspace.slug}</td><td>{workspace.status}</td><td>{workspace.plan_key}</td><td>{workspace.member_count}</td></tr>)}</tbody></table></div></div></main> }
`
}

function generatedPlatformWorkspacePage(): string {
  return `import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformWorkspacePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const view: any = await repos.platform.workspace360(id); const workspace = view?.workspace; return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Workspace 360 · read-only</div><h1>{workspace?.name ?? "Workspace"}.</h1><div className="saas-grid three"><div className="saas-card"><span className="saas-card-kicker">Status</span><h3>{workspace?.status}</h3><p>{workspace?.slug}</p></div><div className="saas-card"><span className="saas-card-kicker">Effective plan</span><h3>{view?.entitlements?.planName}</h3><p>{view?.subscription?.status}</p></div><div className="saas-card"><span className="saas-card-kicker">Members</span><h3>{view?.members?.length ?? 0}</h3><p>{member?.role === "billing_admin" ? "Hidden by billing least privilege." : "Active and historical membership rows."}</p></div></div><div className="saas-grid two" style={{marginTop:16}}><div className="saas-card"><h2>Usage</h2><div className="table-scroll"><table className="saas-table"><thead><tr><th>Metric</th><th>Period</th><th>Amount</th></tr></thead><tbody>{(view?.usage ?? []).map((row: any) => <tr key={row.metric + row.period_start}><td>{row.metric}</td><td>{row.period_start} → {row.period_end}</td><td>{row.amount}</td></tr>)}</tbody></table></div></div><div className="saas-card"><h2>Recent audit</h2><div className="table-scroll"><table className="saas-table"><thead><tr><th>Time</th><th>Action</th><th>Reason</th></tr></thead><tbody>{(view?.audit ?? []).map((row: any) => <tr key={row.id}><td>{row.created_at}</td><td>{row.action}</td><td>{row.reason ?? "—"}</td></tr>)}</tbody></table></div></div></div><div className="saas-card" style={{marginTop:16}}><h2>Members</h2><div className="table-scroll"><table className="saas-table"><thead><tr><th>User</th><th>Role</th><th>Status</th></tr></thead><tbody>{(view?.members ?? []).map((row: any) => <tr key={row.id}><td>{row.user_id}</td><td>{row.role}</td><td>{row.status}</td></tr>)}</tbody></table></div></div></main> }
`
}

function generatedPlatformUsersPage(): string {
  return `import { coreRepositories } from "@/lib/core"
import { PlatformNavigation } from "@/lib/platform"
export const dynamic = "force-dynamic"
export default async function PlatformUsersPage() { const repos: any = await coreRepositories(); const member: any = await repos.platform.getCurrentMember(); const users: any[] = await repos.platform.listUsers() as any[]; return <main className="saas-content"><PlatformNavigation role={member?.role} /><div className="saas-eyebrow">Platform Control</div><h1>Users.</h1><div className="saas-card"><div className="table-scroll"><table className="saas-table"><thead><tr><th>Email</th><th>Created</th><th>Last sign in</th></tr></thead><tbody>{users.map((user: any) => <tr key={user.id}><td>{user.email}</td><td>{user.created_at}</td><td>{user.last_sign_in_at ?? "Never"}</td></tr>)}</tbody></table></div></div></main> }
`
}

function generatedPlatformHealthPage(): string {
  return `import { inspectRuntimeHealth } from "@sapienx/saas-core-runtime"
import { createCoreRepositories } from "@sapienx/saas-core-runtime"
import { createServerClient } from "@/lib/supabase"
export const dynamic = "force-dynamic"
export default async function PlatformHealthPage() { const client = await createServerClient(); const repos: any = createCoreRepositories(client); const db: any = await repos.platform.healthSnapshot(); const checks = await inspectRuntimeHealth({ client, expectedSchemaVersion: "${SCHEMA_VERSION}", environment: process.env }); return <main className="saas-content"><div className="saas-eyebrow">Platform Health</div><h1>Signals, not assumptions.</h1><div className="saas-grid two">{checks.map((check: any) => <div className="saas-card" key={check.key}><span className="saas-card-kicker">{check.label}</span><h3>{check.status}</h3><p>{check.detail}</p></div>)}<div className="saas-card"><span className="saas-card-kicker">Database snapshot</span><h3>{db?.ok ? "operational" : "warning"}</h3><p>Schema {db?.migrationVersion ?? "unknown"}; failed webhooks in seven days: {db?.failedWebhooksLast7Days ?? "unknown"}</p></div></div></main> }
`
}

function generatedAppLayout(projectName: string): string {
  return `import type { ReactNode } from "react"
import { getCurrentUser } from "@sapienx/saas-core-runtime"
import { AppShell } from "@sapienx/saas-core-ui"
import { getWorkspaceContext } from "@/lib/workspace"
export const dynamic = "force-dynamic"
export default async function AppLayout({ children }: { children: ReactNode }) { let email: string | null = null; let context: any = { workspaces: [], currentWorkspace: null }; try { context = await getWorkspaceContext(); email = (await getCurrentUser(context.client))?.email ?? null } catch { /* setup state is rendered by the page */ } return <AppShell productName="${projectName}" userEmail={email} workspaces={context.workspaces.map((workspace: any) => ({ id: workspace.id, name: workspace.name, slug: workspace.slug }))} currentWorkspaceId={context.currentWorkspace?.id} nav={[{label:"Overview",href:"/app",active:true},{label:"Team",href:"/app/team"},{label:"Plan & usage",href:"/app/plan"},{label:"Settings",href:"/app/settings"},{label:"Platform Control",href:"/platform"}]}>{children}</AppShell> }
`
}

function generatedAppLayoutV11(projectName: string, config: ResolvedCliConfig): string {
  const nav = [
    "{label:\"Overview\",href:\"/app\",active:true}",
    "{label:\"Team\",href:\"/app/team\"}",
    ...(config.billing ? ["{label:\"Plan & usage\",href:\"/app/plan\"}"] : []),
    "{label:\"Setup Center\",href:\"/app/setup\"}",
    "{label:\"Settings\",href:\"/app/settings\"}",
    ...(config.platform ? ["{label:\"Platform Control\",href:\"/platform\"}"] : []),
  ].join(",")
  return `import type { ReactNode } from "react"
import { getCurrentUser } from "@sapienx/saas-core-runtime"
import { AppShell } from "@sapienx/saas-core-ui"
import { getWorkspaceContext } from "@/lib/workspace"
export const dynamic = "force-dynamic"
export default async function AppLayout({ children }: { children: ReactNode }) { let email: string | null = null; let context: any = { workspaces: [], currentWorkspace: null }; try { context = await getWorkspaceContext(); email = (await getCurrentUser(context.client))?.email ?? null } catch { /* setup center remains visible before database configuration */ } return <AppShell productName="${projectName}" userEmail={email} workspaces={context.workspaces.map((workspace: any) => ({ id: workspace.id, name: workspace.name, slug: workspace.slug }))} currentWorkspaceId={context.currentWorkspace?.id} nav={[${nav}]}>{children}</AppShell> }
`
}

function generatedAppHome(): string {
  return `import Link from "next/link"
import { EmptyState } from "@sapienx/saas-core-ui"
import { getWorkspaceContext } from "@/lib/workspace"
export const dynamic = "force-dynamic"
export default async function AppHome() { let context: any; let error = ""; try { context = await getWorkspaceContext() } catch (cause) { error = cause instanceof Error ? cause.message : "Core is not configured yet."; context = { workspaces: [], currentWorkspace: null } } return <main className="saas-content"><div className="saas-eyebrow">Workspace overview</div><h1>Build your product here.</h1><p>The generated app owns product routes. Core owns the platform boundary below them.</p>{error ? <div className="saas-state error"><strong>Runtime setup required</strong><p>{error}</p><Link className="saas-button secondary" href="/onboarding">Continue setup</Link></div> : !context.currentWorkspace ? <EmptyState title="Create your first workspace" description="A workspace is the tenant boundary for your product." action={<Link className="saas-button" href="/onboarding">Create workspace</Link>} /> : <><div className="saas-card"><span className="saas-card-kicker">Current workspace</span><h2>{context.currentWorkspace.name}</h2><p>{context.currentWorkspace.slug} · all Core routes now use this validated selection.</p></div><div className="saas-grid three"><Link className="saas-card" href="/app/team"><h3>Team</h3><p>Invite people and manage role hierarchy.</p></Link><Link className="saas-card" href="/app/plan"><h3>Plan & usage</h3><p>Inspect effective entitlements and metering.</p></Link><Link className="saas-card" href="/app/settings"><h3>Workspace settings</h3><p>Branding, PWA and optional services.</p></Link></div></>}</main> }
`
}

function generatedAppHomeV11(config: ResolvedCliConfig): string {
  const planCard = config.billing ? "<Link className=\"saas-card\" href=\"/app/plan\"><h3>Plan & usage</h3><p>Inspect effective entitlements and metering.</p></Link>" : ""
  return `import Link from "next/link"
import { EmptyState } from "@sapienx/saas-core-ui"
import { getWorkspaceContext } from "@/lib/workspace"
export const dynamic = "force-dynamic"
export default async function AppHome() { let context: any; let error = ""; try { context = await getWorkspaceContext() } catch (cause) { error = cause instanceof Error ? cause.message : "Core is not configured yet."; context = { workspaces: [], currentWorkspace: null } } return <main className="saas-content"><div className="saas-eyebrow">Workspace overview</div><h1>Build your product here.</h1><p>The generated app owns product routes. Core owns the platform boundary below them.</p>{error ? <div className="saas-state error"><strong>Runtime setup required</strong><p>{error}</p><Link className="saas-button secondary" href="/app/setup">Open Setup Center</Link></div> : !context.currentWorkspace ? <EmptyState title="Create your first workspace" description="A workspace is the tenant boundary for your product." action={<Link className="saas-button" href="/onboarding">Create workspace</Link>} /> : <><div className="saas-card"><span className="saas-card-kicker">Current workspace</span><h2>{context.currentWorkspace.name}</h2><p>{context.currentWorkspace.slug} · selection is validated and persisted server-side.</p></div><div className="saas-grid three"><Link className="saas-card" href="/app/team"><h3>Team</h3><p>Invite people and manage role hierarchy.</p></Link>${planCard}<Link className="saas-card" href="/app/settings"><h3>Workspace settings</h3><p>Branding, optional services and product boundary.</p></Link></div></>}</main> }
`
}

function generatedTeamPage(): string {
  return `import { getWorkspaceContext } from "@/lib/workspace"
import { StatusBadge } from "@sapienx/saas-core-ui"
export const dynamic = "force-dynamic"
export default async function TeamPage({ searchParams }: { searchParams: Promise<{ invited?: string; error?: string; local_invitation_link?: string }> }) { const query = await searchParams; const context: any = await getWorkspaceContext(); const workspace = context.currentWorkspace; const members = workspace ? await context.repos.memberships.list(workspace.id) : []; const invitations = workspace ? await context.repos.invitations.list(workspace.id) : []; return <main className="saas-content"><div className="saas-eyebrow">Workspace team</div><h1>People and permissions.</h1><p>Current workspace: <strong>{workspace?.name ?? "none"}</strong>. Membership is the authorization source; UI controls are not security boundaries.</p>{query.error && <div className="form-error">{query.error === "invite_delivery_failed" ? "Invitation created, but email delivery failed. Retry after fixing Resend." : "The invitation could not be created. Check the seat limit, role, or pending duplicate."}</div>}{query.local_invitation_link && <div className="notice"><strong>Development-only invitation link</strong><p>Resend is not configured. Share this local link only in a safe development environment: <a href={query.local_invitation_link}>{query.local_invitation_link}</a></p></div>}{workspace ? <><div className="saas-card"><h2>Invite a teammate</h2><form className="saas-form" action="/api/invitations" method="post"><input type="hidden" name="workspaceId" value={workspace.id} /><label>Email<input type="email" name="email" required /></label><label>Role<select name="role" defaultValue="member"><option value="admin">Admin</option><option value="manager">Manager</option><option value="member">Member</option><option value="viewer">Viewer</option></select></label><button className="saas-button" type="submit">Create invitation</button></form></div><div className="saas-card" style={{marginTop:16}}><h2>Members</h2><div className="table-scroll"><table className="saas-table"><thead><tr><th>User</th><th>Role</th><th>Status</th></tr></thead><tbody>{members.map((member: any) => <tr key={member.id}><td>{member.user_id}</td><td>{member.role}</td><td><StatusBadge status={member.status} /></td></tr>)}</tbody></table></div></div><div className="saas-card" style={{marginTop:16}}><h2>Invitations</h2><div className="table-scroll"><table className="saas-table"><thead><tr><th>Email</th><th>Role</th><th>Delivery</th><th>Status</th></tr></thead><tbody>{invitations.map((invitation: any) => <tr key={invitation.id}><td>{invitation.normalized_email}</td><td>{invitation.role}</td><td>{invitation.email_delivery_status}</td><td>{invitation.status}</td></tr>)}</tbody></table></div></div></> : <div className="saas-state">Create a workspace before managing its team.</div>}</main> }
`
}

function generatedPlanPage(): string {
  return `import { BillingStatus, PlanCard, UsageMeter } from "@sapienx/saas-core-ui"
import { getWorkspaceContext } from "@/lib/workspace"
export const dynamic = "force-dynamic"
function price(plan: any, interval: "month" | "year") { const cents = interval === "year" ? plan.billing?.yearlyPriceCents : plan.billing?.monthlyPriceCents; return cents === 0 ? "$0" : cents == null ? "Configured in provider" : "$" + (cents / 100).toFixed(0) + " / " + interval }
export default async function PlanPage({ searchParams }: { searchParams: Promise<{ error?: string; billing_action?: string }> }) { const query = await searchParams; const context: any = await getWorkspaceContext(); const workspace = context.currentWorkspace; if (!workspace) return <main className="saas-content"><div className="saas-state">Create a workspace to see plan state.</div></main>; const entitlements: any = await context.repos.entitlements.get(workspace.id); const plans: any[] = await context.repos.billing.listPlans(); const used: any = await context.repos.usage.get(workspace.id, "api_calls"); const subscription: any = entitlements.subscription; return <main className="saas-content"><div className="saas-eyebrow">Commercial state</div><h1>Plan & usage.</h1>{query.error && <div className="form-error">Billing action unavailable: {query.error.replaceAll("_", " ")}.</div>}{query.billing_action && <div className="notice">Billing provider request accepted. Local Core state will update only after a verified webhook.</div>}<div className="saas-grid two"><div className="saas-card"><BillingStatus plan={entitlements.planName} status={subscription.status} /><div style={{marginTop:20}}><UsageMeter label="API calls" used={used?.amount ?? 0} limit={entitlements.limits.api_calls ?? null} /></div>{subscription.status === "past_due" && <div className="form-error" style={{marginTop:16}}>Payment issue: access falls back to Free when the grace period expires.</div>}<div style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:16}}>{subscription.provider_customer_id && <form action="/api/billing/portal" method="post"><button className="saas-button secondary" type="submit">Manage subscription</button></form>}{subscription.provider_subscription_id && subscription.status !== "canceled" && <form action="/api/billing/cancel" method="post"><button className="saas-button secondary" type="submit">Cancel at period end</button></form>}{subscription.provider_subscription_id && subscription.status === "canceled" && <form action="/api/billing/resume" method="post"><button className="saas-button secondary" type="submit">Resume subscription</button></form>}</div></div><div className="saas-card"><h2>Effective entitlement</h2><p>Manual override → scheduled plan → subscription → payment restriction fallback.</p><strong>{entitlements.planName}</strong><p>Workspace: {workspace.name}</p></div></div><div className="saas-grid three" style={{marginTop:16}}>{plans.map((plan: any) => <PlanCard key={plan.key} name={plan.name} planKey={plan.key} price={price(plan, "month")} features={Object.keys(plan.features ?? {}).filter((key) => plan.features[key]).concat(Object.entries(plan.limits ?? {}).filter(([, value]) => value !== null).map(([key, value]) => key + ": " + value))} current={entitlements.planKey === plan.key} action="/api/billing/checkout" />)}</div></main> }
`
}

function generatedSettingsPage(): string {
  return `import { getWorkspaceContext } from "@/lib/workspace"
export const dynamic = "force-dynamic"
export default async function SettingsPage() { const context: any = await getWorkspaceContext(); return <main className="saas-content"><div className="saas-eyebrow">Workspace settings</div><h1>Configure the platform boundary.</h1><div className="saas-card"><h2>{context.currentWorkspace?.name ?? "No workspace selected"}</h2><p>Current selection is stored in a secure, membership-validated cookie. Product tables should reference workspace_id.</p></div><div className="saas-grid two" style={{marginTop:16}}><div className="saas-card"><h2>Product-owned domain</h2><p>Add product tables with Core-derived workspace authorization. Core intentionally does not define a universal resources table.</p></div><div className="saas-card"><h2>Optional services</h2><p>Custom domains, workspace PWA branding, Resend and Web Push are configured server-side.</p></div></div></main> }
`
}

function generatedSettingsPageV11(config: ResolvedCliConfig): string {
  const services = [
    "Email delivery: " + (config.email ? "enabled" : "disabled"),
    "Billing: " + (config.billing ? "enabled" : "disabled"),
    "Custom domains: " + (config.domains ? "enabled" : "disabled"),
    "PWA: " + (config.pwa ? "enabled" : "disabled"),
    "Web Push: " + (config.push ? "enabled" : "disabled"),
  ]
  return `import Link from "next/link"
import { getWorkspaceContext } from "@/lib/workspace"
export const dynamic = "force-dynamic"
export default async function SettingsPage() { const context: any = await getWorkspaceContext(); return <main className="saas-content"><div className="saas-eyebrow">Workspace settings</div><h1>Configure the platform boundary.</h1><div className="saas-card"><h2>{context.currentWorkspace?.name ?? "No workspace selected"}</h2><p>Current selection is stored in a secure, membership-validated cookie. Product tables should reference workspace_id.</p><Link className="saas-button secondary" href="/app/setup">Open Setup Center</Link></div><div className="saas-grid two" style={{marginTop:16}}><div className="saas-card"><h2>Product-owned domain</h2><p>Add product tables with Core-derived workspace authorization. Core intentionally does not define a universal resources table.</p></div><div className="saas-card"><h2>Core modules</h2><ul>${services.map((service) => "<li>" + service + "</li>").join("")}</ul></div></div></main> }
`
}

function generatedSetupPage(config: ResolvedCliConfig): string {
  return `import { inspectProviderConfiguration } from "@sapienx/saas-core"
import { inspectRuntimeHealth } from "@sapienx/saas-core-runtime"
import { createServerClient } from "@/lib/supabase"
export const dynamic = "force-dynamic"
const modules = ${JSON.stringify({ billing: config.billing, email: config.email, domains: config.domains, pwa: config.pwa, push: config.push, platform: config.platform })}
export default async function SetupPage() { let checks: any[] = []; let providerChecks: any[] = inspectProviderConfiguration(process.env, modules); try { checks = await inspectRuntimeHealth({ client: await createServerClient(), expectedSchemaVersion: "${SCHEMA_VERSION}", environment: process.env }) } catch (error) { checks = [{ key: "runtime", label: "Runtime", status: "error", detail: error instanceof Error ? error.message : "Runtime check failed." }] } return <main className="saas-content"><div className="saas-eyebrow">Setup Center</div><h1>Production readiness.</h1><p>These checks use the same health and provider diagnostics as the CLI. A configured provider is not reported as operational until its live boundary is verified.</p><div className="saas-grid two">{[...checks, ...providerChecks].map((check: any) => <div className="saas-card" key={check.key}><span className="saas-card-kicker">{check.label}</span><h3>{String(check.status).replaceAll("_", " ")}</h3><p>{check.detail}</p>{check.missing?.length ? <small>Missing: {check.missing.join(", ")}</small> : null}</div>)}</div><div className="saas-card" style={{marginTop:16}}><h2>Product boundary</h2><p>Core owns identity, tenants, team, plans and operations. Add product tables with workspace_id and product-specific policies under src/product.</p></div></main> }
`
}

function readManifest(target: string): Manifest | null {
  const path = join(target, ".saas-core.json")
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, "utf8")) as Manifest } catch { return null }
}

function managedHash(value: ManagedFile | string): string { return typeof value === "string" ? value : value.hash }
function printHeader(command: string) {
  if (command === "init") {
    console.log(`\n${cyan("SaaS Core")} ${dim(`v${VERSION}`)}\n\n${dim("Create a production SaaS foundation")}`)
    return
  }
  console.log(`\n${cyan("SaaS Core")} ${dim(`v${VERSION}`)}  ${dim(command)}\n${dim("Reusable multi-tenant SaaS foundation")}`)
}
function writeSafe(path: string, content: string, dryRun: boolean): "created" | "skipped" { if (existsSync(path)) return "skipped"; if (!dryRun) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, "utf8") }; return "created" }
const parseFlags = parseCliFlags

function printInitConfiguration(projectName: string, config: ResolvedCliConfig) {
  console.log(`\n${cyan("Configuration")}`)
  console.log(`  Project            ${projectName}`)
  console.log(`  Database & Auth    Supabase`)
  console.log(`  Billing            ${config.billing ? "Paddle sandbox boundary" : "Disabled"}`)
  console.log(`  Email              ${config.email ? "Resend delivery boundary" : "Disabled"}`)
  console.log(`  Domains            ${config.domains ? "Vercel boundary" : "Disabled"}`)
  console.log(`  PWA                ${config.pwa ? "Enabled" : "Disabled"}`)
  console.log(`  Web Push           ${config.push ? "Enabled" : "Disabled"}`)
  console.log(`  Platform Control   ${config.platform ? "Included" : "Disabled"}`)
  console.log(`  Core Lab           ${config.coreLab ? "Included" : "Disabled"}`)
  console.log(`  Product domain     Ready for product-owned tables`)
}

async function promptInitConfig(flags: CliFlags): Promise<ResolvedCliConfig | null> {
  const interactive = Boolean(input.isTTY && !flags.yes && !flags.nonInteractive)
  if (!interactive) return resolveCliConfig({ flags, interactive: false })
  const rl = createInterface({ input, output })
  let cancelled = false
  rl.once("SIGINT", () => { cancelled = true; rl.close() })
  const ask = async (label: string, defaultValue: boolean) => {
    const answer = (await rl.question(`\n◇ ${label} [${defaultValue ? "Y/n" : "y/N"}] `)).trim().toLowerCase()
    if (cancelled) return null
    if (!answer) return defaultValue
    return answer === "y" || answer === "yes"
  }
  try {
    const billing = await ask("Enable Paddle billing?", true)
    const email = await ask("Enable Resend email delivery?", true)
    const domains = await ask("Enable custom domains?", false)
    const pwa = await ask("Enable PWA hooks?", false)
    const push = await ask("Enable Web Push?", false)
    const platform = await ask("Enable Platform Control?", true)
    const coreLab = await ask("Include Core Lab metadata?", true)
    const installDependencies = await ask("Install dependencies now?", true)
    rl.close()
    if (cancelled || [billing, email, domains, pwa, push, platform, coreLab, installDependencies].some((value) => value === null)) return null
    return resolveCliConfig({ flags, billing: Boolean(billing), email: Boolean(email), domains: Boolean(domains), pwa: Boolean(pwa), push: Boolean(push), platform: Boolean(platform), coreLab: Boolean(coreLab), installDependencies: Boolean(installDependencies) })
  } catch {
    rl.close()
    return null
  }
}

async function projectNameFor(targetArg: string | undefined, target: string, options: ReturnType<typeof parseFlags>): Promise<string | null> {
  if (targetArg && targetArg !== ".") return target.split(/[\\/]/).filter(Boolean).pop() ?? "saas-product"
  if (!options.yes && !options.nonInteractive && input.isTTY) {
    const rl = createInterface({ input, output })
    let cancelled = false
    rl.once("SIGINT", () => { cancelled = true; rl.close() })
    try {
      const answer = (await rl.question("\n◇ Project name [saas-product]: ")).trim()
      rl.close()
      if (cancelled) return null
      return answer || "saas-product"
    } catch {
      rl.close()
      return null
    }
  }
  return "saas-product"
}

async function init(targetArg: string | undefined, options: ReturnType<typeof parseFlags>) {
  const target = resolve(targetArg ?? ".")
  const projectName = await projectNameFor(targetArg, target, options)
  if (!projectName) { console.log(yellow("Cancelled.")); process.exitCode = 130; return }
  const config = await promptInitConfig(options)
  if (!config) { console.log(yellow("Cancelled.")); process.exitCode = 130; return }
  printInitConfiguration(projectName, config)
  const files = generatedFiles(projectName, config)
  const conflicts: string[] = []
  const created: string[] = []
  for (const [relative, content] of files) {
    const absolute = join(target, relative)
    if (existsSync(absolute)) { conflicts.push(relative); continue }
    writeSafe(absolute, content, options.dryRun)
    created.push(relative)
  }
  const now = new Date().toISOString()
  const prior = readManifest(target)
  const managedFiles: Record<string, ManagedFile> = { ...(prior ? Object.fromEntries(Object.entries(prior.managedFiles).filter(([file]) => !FRAMEWORK_GENERATED_FILES.has(file)).map(([file, value]) => [file, typeof value === "string" ? { hash: value, ownership: "managed" as const } : value])) : {}) }
  for (const relative of created.filter((file) => file !== ".saas-core.json" && file !== "src/product/README.md" && !FRAMEWORK_GENERATED_FILES.has(file))) { managedFiles[relative] = { hash: hash(files.get(relative) ?? ""), ownership: relative === "package.json" || relative === "core.config.ts" ? "mergeable" : "managed" } }
  const manifest: Manifest = { projectName: prior?.projectName ?? projectName, coreVersion: VERSION, schemaVersion: SCHEMA_VERSION, installedModules: modulesForConfig(config), providers: { auth: "supabase", ...(config.billing ? { billing: "paddle" } : {}), ...(config.email ? { email: "resend" } : {}), ...(config.domains ? { domains: "vercel" } : {}), ...(config.push ? { push: "web-push" } : {}) }, configuration: config, managedFiles, generatedFiles: { "src/product/README.md": { ownership: "user-owned" }, "next-env.d.ts": { ownership: "mergeable" } }, installedAt: prior?.installedAt ?? now, updatedAt: now, version: VERSION, modules: modulesForConfig(config) }
  if (!options.dryRun) { mkdirSync(target, { recursive: true }); writeFileSync(join(target, ".saas-core.json"), json(manifest), "utf8") }
  console.log(`${green(options.dryRun ? "◇" : "✓")} ${options.dryRun ? "Preparing generated application" : "Generated application"} ${dim(`(${created.length} files)`)}`)
  if (conflicts.length) { console.log(`\n${yellow("Existing files preserved")}`); for (const file of conflicts) console.log(`  ${yellow("conflict")} ${file}`) }
  console.log(`\n${green(options.dryRun ? "Dry run complete" : "✓ SaaS Core ready")}  ${dim(target)}`)
  if (!options.dryRun && config.installDependencies) {
    try { execFileSync("pnpm", ["install"], { cwd: target, stdio: "inherit" }) } catch { console.log(yellow("Dependency installation failed; run pnpm install manually.")) }
  }
  if (!options.dryRun) console.log(`\nNext:\n  cd ${targetArg && targetArg !== "." ? targetArg : "."}\n  cp .env.example .env.local\n  ${config.installDependencies ? "pnpm dev" : "pnpm install && pnpm dev"}`)
}

type DoctorStatus = "PASS" | "NOT CONFIGURED" | "CONFIGURED_UNVERIFIED" | "DISABLED" | "WARN" | "FAIL" | "UNKNOWN"
function check(label: string, status: DoctorStatus, detail: string) { const symbol = status === "PASS" ? green("✓") : status === "FAIL" ? red("✗") : yellow("!"); console.log(`${symbol} ${label.padEnd(30)} ${status.padEnd(21)} ${dim(detail)}`); return status === "PASS" }
function commandVersion(command: string, args: string[] = ["--version"]): string | null { try { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0] ?? null } catch { return null } }
function projectEnvironment(target: string): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env }
  for (const file of [".env.local", ".env"]) {
    const path = join(target, file)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
      if (!match) continue
      const key = match[1]
      if (!key || environment[key] !== undefined) continue
      environment[key] = (match[2] ?? "").replace(/^(["'])(.*)\1$/, "$2")
    }
  }
  return environment
}

async function probeSupabase(environment: NodeJS.ProcessEnv = process.env) {
  const url = environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL
  const key = environment.SUPABASE_SERVICE_ROLE_KEY ?? environment.SUPABASE_ANON_KEY ?? environment.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { connectivity: ["NOT CONFIGURED" as const, "credentials required for a live check"], schema: ["NOT CONFIGURED" as const, "credentials required for a live check"], core: ["NOT CONFIGURED" as const, "service-role key required for protected health RPC"] }
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  try {
    const schemaResponse = await fetch(`${url.replace(/\/$/, "")}/rest/v1/saas_core_schema_versions?select=version&version=eq.${encodeURIComponent(SCHEMA_VERSION)}&limit=1`, { headers, signal: AbortSignal.timeout(5000) })
    if (!schemaResponse.ok) return { connectivity: ["FAIL" as const, `REST endpoint returned ${schemaResponse.status}`], schema: ["FAIL" as const, "schema version query failed"], core: ["WARN" as const, "health RPC was not attempted"] }
    const schemaRows = await schemaResponse.json() as unknown
    const schemaReady = Array.isArray(schemaRows) && schemaRows.some((row) => row && typeof row === "object" && (row as { version?: unknown }).version === SCHEMA_VERSION)
    if (!environment.SUPABASE_SERVICE_ROLE_KEY) return { connectivity: ["PASS" as const, "Supabase REST endpoint reachable"], schema: [schemaReady ? "PASS" as const : "WARN" as const, schemaReady ? SCHEMA_VERSION : "schema version not visible to anon key"], core: ["NOT CONFIGURED" as const, "service-role key required for protected health RPC"] }
    const healthResponse = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/core_health_check`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(5000) })
    const health = await healthResponse.json().catch(() => null) as { ok?: boolean; missingTables?: string[]; missingFunctions?: string[] } | null
    const missing = [...(health?.missingTables ?? []), ...(health?.missingFunctions ?? [])]
    return { connectivity: ["PASS" as const, "Supabase REST endpoint reachable"], schema: [schemaReady ? "PASS" as const : "FAIL" as const, schemaReady ? SCHEMA_VERSION : "required schema version missing"], core: [healthResponse.ok && health?.ok === true ? "PASS" as const : "FAIL" as const, healthResponse.ok && health?.ok === true ? "tables, functions and RLS health check passed" : `core health check failed${missing.length ? `: ${missing.join(", ")}` : ""}`] }
  } catch (error) {
    return { connectivity: ["FAIL" as const, error instanceof Error ? error.message : "Supabase request failed"], schema: ["UNKNOWN" as const, "schema could not be inspected"], core: ["UNKNOWN" as const, "core health could not be inspected"] }
  }
}

async function doctor(target: string) {
  const manifest = readManifest(target); const environment = projectEnvironment(target); let passed = 0; let warnings = 0; let failed = 0
  const add = (label: string, status: DoctorStatus, detail: string) => { if (check(label, status, detail)) passed++; else if (status === "FAIL") failed++; else warnings++ }
  add("Core manifest", manifest ? "PASS" : "FAIL", manifest ? `${manifest.coreVersion} / ${manifest.schemaVersion}` : "missing .saas-core.json")
  add("Node runtime", Number(process.versions.node.split(".")[0]) >= 20 ? "PASS" : "FAIL", process.versions.node)
  add("pnpm", commandVersion("pnpm") ? "PASS" : "FAIL", commandVersion("pnpm") ?? "not installed")
  let packageJson: ProjectPackage | null = null
  try { packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as ProjectPackage } catch { /* report below */ }
  add("Next.js compatibility", packageJson?.dependencies?.next ? "PASS" : "FAIL", packageJson?.dependencies?.next ?? "package dependency missing")
  const packageVersions = Object.fromEntries(Object.entries({ ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) }).filter(([name]) => name.startsWith("@sapienx/saas-core")))
  const compatibility = evaluateCompatibility({ packageVersions, ...(manifest?.schemaVersion ? { schemaVersion: manifest.schemaVersion } : {}), ...(manifest?.coreVersion ? { manifestVersion: manifest.coreVersion } : {}) })
  add("Core compatibility", compatibility.status === "incompatible" ? "FAIL" : compatibility.status === "warning" ? "WARN" : "PASS", compatibility.detail)
  add("Core config", existsSync(join(target, "core.config.ts")) ? "PASS" : "FAIL", "core.config.ts")
  add("Schema migration", existsSync(join(target, "supabase/migrations")) ? "PASS" : "FAIL", "migration directory")
  const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
  const configured = envKeys.filter((key) => Boolean(environment[key] ?? environment[`NEXT_PUBLIC_${key}`]))
  add("Auth environment", configured.length === envKeys.length ? "PASS" : "NOT CONFIGURED", `${configured.length}/${envKeys.length} configured; secrets hidden`)
  const probe = await probeSupabase(environment)
  add("Supabase connectivity", (probe.connectivity[0] ?? "UNKNOWN") as "PASS" | "NOT CONFIGURED" | "WARN" | "FAIL" | "UNKNOWN", probe.connectivity[1] ?? "unknown")
  add("Core schema version", (probe.schema[0] ?? "UNKNOWN") as "PASS" | "NOT CONFIGURED" | "WARN" | "FAIL" | "UNKNOWN", probe.schema[1] ?? "unknown")
  add("Core tables/functions", (probe.core[0] ?? "UNKNOWN") as "PASS" | "NOT CONFIGURED" | "WARN" | "FAIL" | "UNKNOWN", probe.core[1] ?? "unknown")
  const configuration = manifest ? configFromManifest(manifest) : resolveCliConfig()
  for (const provider of inspectProviderConfiguration(environment, configuration)) {
    const status: DoctorStatus = provider.state === "operational" ? "PASS" : provider.state === "configured_unverified" ? "CONFIGURED_UNVERIFIED" : provider.state === "disabled" ? "DISABLED" : provider.state === "not_configured" ? "NOT CONFIGURED" : provider.state === "warning" ? "WARN" : provider.state === "error" ? "FAIL" : "UNKNOWN"
    add(provider.label, status, provider.missing?.length ? `${provider.detail}; missing ${provider.missing.join(", ")}` : provider.detail)
  }
  add("Cron secret", configuration.billing ? (environment.PADDLE_CRON_SECRET ? "PASS" : "NOT CONFIGURED") : "DISABLED", configuration.billing ? (environment.PADDLE_CRON_SECRET ? "internal lifecycle route protected" : "internal lifecycle route") : "billing disabled")
  if (manifest) {
    const drift = Object.entries(manifest.managedFiles).filter(([file, value]) => !existsSync(join(target, file)) || hash(readFileSync(join(target, file), "utf8")) !== managedHash(value))
    add("Managed-file drift", drift.length === 0 ? "PASS" : "WARN", drift.length ? `${drift.length} files changed` : "baseline clean")
  } else add("Managed-file drift", "FAIL", "manifest unavailable")
  const buildReady = Boolean(packageJson?.scripts?.build && packageJson?.scripts?.dev)
  add("Build readiness", buildReady ? "PASS" : "FAIL", buildReady ? "dev/build scripts present" : "missing dev or build script")
  console.log(`\n${passed} passed  ${warnings} warnings  ${failed} failed`); if (failed > 0) process.exitCode = 1
}

function diff(target: string) {
  const manifest = readManifest(target); if (!manifest) { console.log(red("No .saas-core.json found.")); process.exitCode = 1; return }
  const changes: string[] = []
  for (const [file, value] of Object.entries(manifest.managedFiles)) { if (!existsSync(join(target, file))) changes.push(`managed file deleted: ${file}`); else if (hash(readFileSync(join(target, file), "utf8")) !== managedHash(value)) changes.push(`managed file modified: ${file}`) }
  for (const file of Object.keys(manifest.generatedFiles)) if (!existsSync(join(target, file))) changes.push(`generated user-owned file deleted: ${file}`)
  let packageJson: ProjectPackage | null = null; try { packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as ProjectPackage } catch { /* reported as drift */ }
  for (const [name, spec] of Object.entries({ ...(packageJson?.dependencies ?? {}), ...(packageJson?.devDependencies ?? {}) })) if (name.startsWith("@sapienx/saas-core") && !spec.includes(VERSION)) changes.push(`package version mismatch: ${name} ${spec}`)
  if (manifest.schemaVersion !== SCHEMA_VERSION) changes.push(`schema drift: manifest ${manifest.schemaVersion}, expected ${SCHEMA_VERSION}`)
  if (manifest.coreVersion !== VERSION) changes.push(`core version drift: manifest ${manifest.coreVersion}, expected ${VERSION}`)
  if (!manifest.configuration) changes.push("config drift: v1.1 module configuration missing")
  if (!changes.length) console.log(`${green("✓ No Core drift")}\nManaged files checked: ${Object.keys(manifest.managedFiles).length}`)
  else { console.log(`${yellow("Core drift detected")}`); for (const change of changes) console.log(`  ${yellow(change)}`); process.exitCode = 2 }
}

function info(target: string) { const manifest = readManifest(target); const environment = projectEnvironment(target); console.log(json({ coreVersion: manifest?.coreVersion ?? null, schemaVersion: manifest?.schemaVersion ?? null, installedModules: manifest?.installedModules ?? [], providers: manifest?.providers ?? {}, configuration: manifest?.configuration ?? null, environment: { node: process.versions.node, nodeEnv: environment.NODE_ENV ?? "development", supabaseConfigured: Boolean(environment.SUPABASE_URL ?? environment.NEXT_PUBLIC_SUPABASE_URL), envFile: existsSync(join(target, ".env.local")) ? ".env.local" : existsSync(join(target, ".env")) ? ".env" : null } })) }

function update(target: string, options: ReturnType<typeof parseFlags>) {
  const manifest = readManifest(target); if (!manifest) { console.log(red("No installed SaaS Core project found.")); process.exitCode = 1; return }
  const configuration = resolveCliConfig({ ...configFromManifest(manifest), flags: options })
  const source = generatedFiles(manifest.projectName ?? readFileSync(join(target, "package.json"), "utf8").match(/"name"\s*:\s*"([^"]+)/)?.[1] ?? "saas-product", configuration)
  const backup = join(target, ".saas-core-backup", new Date().toISOString().replace(/[:.]/g, "-")); const conflicts: string[] = []; const changes: string[] = []
  for (const [relative, content] of source) {
    const absolute = join(target, relative)
    if (relative === ".saas-core.json") continue
    if (!existsSync(absolute)) { changes.push(`add ${relative}`); if (!options.dryRun) writeSafe(absolute, content, false) }
    else {
      const current = readFileSync(absolute, "utf8")
      const baseline = managedHash(manifest.managedFiles[relative] ?? "")
      if (relative === "package.json") {
        try {
          const currentPackage = JSON.parse(current) as ProjectPackage
          const sourcePackage = JSON.parse(content) as ProjectPackage
          const merged = { ...currentPackage, dependencies: { ...currentPackage.dependencies, ...Object.fromEntries(Object.entries(sourcePackage.dependencies ?? {}).filter(([name]) => name.startsWith("@sapienx/saas-core"))) }, scripts: { ...currentPackage.scripts, "saas-core": sourcePackage.scripts?.["saas-core"] ?? "saas-core" } }
          const mergedText = json(merged)
          if (mergedText !== current) { changes.push(`update ${relative}`); if (!options.dryRun) { mkdirSync(dirname(join(backup, relative)), { recursive: true }); cpSync(absolute, join(backup, relative)); writeFileSync(absolute, mergedText, "utf8") } }
        } catch { conflicts.push(relative) }
      } else if (baseline && hash(current) !== baseline) conflicts.push(relative)
      else if (hash(current) !== hash(content)) { changes.push(`update ${relative}`); if (!options.dryRun) { mkdirSync(dirname(join(backup, relative)), { recursive: true }); cpSync(absolute, join(backup, relative)); writeFileSync(absolute, content, "utf8") } }
    }
  }
  const now = new Date().toISOString(); const next: Manifest = { ...manifest, coreVersion: VERSION, schemaVersion: SCHEMA_VERSION, installedModules: modulesForConfig(configuration), configuration, updatedAt: now, version: VERSION, modules: modulesForConfig(configuration) }
  if (!options.dryRun) for (const [relative] of source) if (relative !== ".saas-core.json" && existsSync(join(target, relative)) && !conflicts.includes(relative) && !FRAMEWORK_GENERATED_FILES.has(relative)) next.managedFiles[relative] = { hash: hash(readFileSync(join(target, relative), "utf8")), ownership: relative === "package.json" || relative === "core.config.ts" ? "mergeable" : "managed" }
  if (!options.dryRun) writeFileSync(join(target, ".saas-core.json"), json(next), "utf8")
  console.log(`${green(options.dryRun ? "Dry-run update" : "Core updated")} ${changes.length} change(s)`); if (conflicts.length) { console.log(yellow("Conflicts preserved:")); conflicts.forEach((file) => console.log(`  ${file}`)) }; if (!options.dryRun) console.log(dim(`backup: ${backup}`)); if (options.dryRun) changes.forEach((change) => console.log(`  ${change}`))
}

function test(target: string) {
  const manifest = readManifest(target); const checks: Array<[string, boolean, string]> = []
  checks.push(["Installed manifest", Boolean(manifest), ".saas-core.json"])
  checks.push(["Managed files", Boolean(manifest && Object.entries(manifest.managedFiles).every(([file, value]) => existsSync(join(target, file)) && hash(readFileSync(join(target, file), "utf8")) === managedHash(value))), "hash baseline"])
  checks.push(["Product boundary", existsSync(join(target, "src/product")), "src/product"])
  checks.push(["Next app routes", existsSync(join(target, "src/app")) && existsSync(join(target, "proxy.ts")), "App Router + proxy"])
  checks.push(["v1.1 manifest", manifest?.coreVersion === VERSION && manifest?.schemaVersion === SCHEMA_VERSION, `${VERSION} / ${SCHEMA_VERSION}`])
  checks.push(["Setup Center", existsSync(join(target, "src/app/app/setup/page.tsx")), "/app/setup"])
  checks.push(["Platform operations", existsSync(join(target, "src/app/platform/health/page.tsx")) && existsSync(join(target, "src/app/platform/audit/page.tsx")), "health + audit routes"])
  checks.push(["Core migration", existsSync(join(target, "supabase/migrations")), "Supabase migration"])
  for (const [label, pass, detail] of checks) console.log(`${pass ? green("✓") : red("✗")} ${label.padEnd(25)} ${dim(detail)}`)
  const passed = checks.filter(([, pass]) => pass).length; console.log(`\n${passed} passed  ${checks.length - passed} failed`); if (passed !== checks.length) process.exitCode = 1
}

export async function runCli(argv = process.argv.slice(2)) {
  const command = argv[0] ?? "info"; const options = parseFlags(argv); const targetArg = argv[1] && !argv[1].startsWith("-") ? argv[1] : "."; const target = resolve(targetArg); printHeader(command)
  if (command === "init") await init(argv[1] && !argv[1].startsWith("-") ? argv[1] : ".", options)
  else if (command === "doctor") await doctor(target)
  else if (command === "diff") diff(target)
  else if (command === "info") info(target)
  else if (command === "update") update(target, options)
  else if (command === "test") test(target)
  else if (command === "--version" || command === "-v") console.log(VERSION)
  else { console.log(`Commands: ${cyan("init")} ${cyan("update")} ${cyan("doctor")} ${cyan("diff")} ${cyan("info")} ${cyan("test")}\nOptions: --yes --non-interactive --dry-run`); process.exitCode = 1 }
}

const invokedPath = process.argv[1] ? realpathSync(process.argv[1]) : ""
const modulePath = realpathSync(fileURLToPath(import.meta.url))
if (invokedPath === modulePath) void runCli()
