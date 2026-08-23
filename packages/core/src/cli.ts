#!/usr/bin/env node
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync, realpathSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { stdin as input, stdout as output } from "node:process"

const VERSION = "1.0.0"
const SCHEMA_VERSION = "1.1-hardening"
const MODULES = ["auth", "workspace", "permissions", "invitations", "entitlements", "usage", "billing", "audit", "domains", "notifications", "platform", "pwa"]
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
  version?: string
  modules?: string[]
}
type ProjectPackage = { dependencies?: Record<string, string>; scripts?: Record<string, string> }

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

function generatedFiles(projectName: string): Map<string, string> {
  const key = projectKey(projectName)
  const coreDeps = {
    "@sapienx/saas-core": packageSpec("@sapienx/saas-core"),
    "@sapienx/saas-core-auth": packageSpec("@sapienx/saas-core-auth"),
    "@sapienx/saas-core-config": packageSpec("@sapienx/saas-core-config"),
    "@sapienx/saas-core-runtime": packageSpec("@sapienx/saas-core-runtime"),
    "@sapienx/saas-core-ui": packageSpec("@sapienx/saas-core-ui"),
  }
  const localOverrides = process.env.SAAS_CORE_TARBALL_DIR ? { pnpm: { overrides: { ...coreDeps } } } : {}
  return new Map([
    ["package.json", json({ name: key, private: true, version: "0.1.0", type: "module", scripts: { dev: "next dev", build: "next build", start: "next start", lint: "next lint", typecheck: "tsc --noEmit", test: "vitest run", "saas-core": "saas-core" }, dependencies: { next: "16.3.0", react: "^19.2.8", "react-dom": "^19.2.8", "@supabase/ssr": "^0.12.4", "@supabase/supabase-js": "^2.112.3", ...coreDeps }, devDependencies: { "@types/node": "^24.0.0", "@types/react": "^19.2.0", "@types/react-dom": "^19.2.0", typescript: "^5.9.0", vitest: "^3.2.0", "@playwright/test": "^1.62.0" }, ...localOverrides })],
    ["next.config.mjs", `/** @type {import('next').NextConfig} */\nexport default { reactStrictMode: true, poweredByHeader: false }\n`],
    ["tsconfig.json", json({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], allowJs: false, skipLibCheck: true, strict: true, noEmit: true, incremental: true, esModuleInterop: true, module: "esnext", moduleResolution: "bundler", resolveJsonModule: true, isolatedModules: true, jsx: "react-jsx", plugins: [{ name: "next" }], paths: { "@/*": ["./src/*"] } }, include: ["next-env.d.ts", ".next/types/**/*.ts", ".next/dev/types/**/*.ts", "src/**/*.ts", "src/**/*.tsx", "proxy.ts"], exclude: ["node_modules"] })],
    ["next-env.d.ts", "/// <reference types=\"next\" />\n/// <reference types=\"next/image-types/global\" />\n\n// NOTE: This file should not be edited\n"],
    ["core.config.ts", `import { defineSaaSCore } from "@sapienx/saas-core-config"\n\nexport default defineSaaSCore({\n  version: "1.0.0",\n  product: { key: ${JSON.stringify(key)}, name: ${JSON.stringify(projectName)} },\n  auth: { provider: "supabase", requireEmailConfirmation: true },\n  workspace: { slugSource: "user_input", defaultTimezone: "UTC" },\n  permissions: { custom: {} },\n  billing: { provider: "paddle", environment: "sandbox" },\n  entitlements: { features: [], metrics: [] },\n  usage: { enabled: true },\n  notifications: { email: { name: "resend", enabled: false }, push: { name: "web-push", enabled: false } },\n  domains: { enabled: false },\n  pwa: { enabled: false },\n  platform: { enabled: true, supportReadOnly: true },\n})\n`],
    [".env.example", `# SaaS Core generated environment. Copy to .env.local. Secret values stay server-side.\nAPP_URL=http://localhost:3000\nNEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321\nNEXT_PUBLIC_SUPABASE_ANON_KEY=\nSUPABASE_URL=http://127.0.0.1:54321\nSUPABASE_ANON_KEY=\nSUPABASE_SERVICE_ROLE_KEY=\nPADDLE_ENVIRONMENT=sandbox\nPADDLE_API_KEY=\nPADDLE_WEBHOOK_SECRET=\nPADDLE_CRON_SECRET=\nRESEND_API_KEY=\nRESEND_FROM_EMAIL=\nVAPID_PUBLIC_KEY=\nVAPID_PRIVATE_KEY=\nVAPID_SUBJECT=mailto:ops@example.com\n`],
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
    ["supabase/migrations/20260824000000_saas_core_v1.sql", coreMigrationSql()],
    ["supabase/migrations/20260824010000_production_hardening.sql", coreMigrationSql("20260824010000_production_hardening.sql")],
    ["src/product/README.md", "# Product-owned code\n\nAdd product tables with a workspace_id foreign key and enforce product-specific policies through a Core-derived workspace membership context.\n"],
  ])
}

function authPage(title: string, action: string, prompt: string, href: string, linkText: string): string {
  return `export default async function AuthPage({ searchParams }: { searchParams: Promise<Record<string,string|undefined>> }) { const params = await searchParams; const next = params.next ?? ""; return <main className="auth-page"><div className="auth-card"><div className="saas-brand"><span className="saas-brand-mark">S</span><strong>SaaS Core application</strong></div><div className="saas-eyebrow">Secure account</div><h1>${title}.</h1><p>Sessions are handled by Supabase SSR with PKCE and server-side cookie refresh.</p><form className="saas-form" action="${action}" method="post"><input type="hidden" name="next" value={next} /><label>Email<input name="email" type="email" autoComplete="email" required /></label><label>Password<input name="password" type="password" minLength={8} autoComplete="current-password" required /></label><button className="saas-button" type="submit">${title}</button></form><p><a href="/forgot-password">Forgot password?</a></p><p>${prompt} <a href="${href}">${linkText}</a></p></div></main> }\n`
}

function authRoute(method: "signInWithPassword", fallback: string): string {
  return `import { NextResponse } from "next/server"\nimport { createServerClient } from "@/lib/supabase"\nimport { safeRedirect } from "@sapienx/saas-core-runtime"\nexport async function POST(request: Request) { const body = await request.formData(); const email = String(body.get("email") ?? "").trim(); const password = String(body.get("password") ?? ""); const next = safeRedirect(String(body.get("next") ?? ""), new URL(request.url).origin, "${fallback}"); const client = await createServerClient(); const result = await client.auth.${method}({ email, password }); if (result.error) return NextResponse.redirect(new URL("/login?error=invalid_credentials", request.url)); return NextResponse.redirect(new URL(next, request.url)); }\n`
}

function readManifest(target: string): Manifest | null {
  const path = join(target, ".saas-core.json")
  if (!existsSync(path)) return null
  try { return JSON.parse(readFileSync(path, "utf8")) as Manifest } catch { return null }
}

function managedHash(value: ManagedFile | string): string { return typeof value === "string" ? value : value.hash }
function printHeader(command: string) { console.log(`\n${cyan("SaaS Core")} ${dim(`v${VERSION}`)}  ${dim(command)}\n${dim("Reusable multi-tenant SaaS foundation")}`) }
function writeSafe(path: string, content: string, dryRun: boolean): "created" | "skipped" { if (existsSync(path)) return "skipped"; if (!dryRun) { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, content, "utf8") }; return "created" }
function parseFlags(argv: string[]) { return { yes: argv.includes("--yes"), nonInteractive: argv.includes("--non-interactive"), dryRun: argv.includes("--dry-run") } }

async function projectNameFor(targetArg: string | undefined, target: string, options: ReturnType<typeof parseFlags>) {
  if (targetArg && targetArg !== ".") return target.split(/[\\/]/).filter(Boolean).pop() ?? "saas-product"
  if (!options.yes && !options.nonInteractive && input.isTTY) { const rl = createInterface({ input, output }); const answer = (await rl.question("Project name [saas-product]: ")).trim(); rl.close(); return answer || "saas-product" }
  return "saas-product"
}

async function init(targetArg: string | undefined, options: ReturnType<typeof parseFlags>) {
  const target = resolve(targetArg ?? ".")
  const projectName = await projectNameFor(targetArg, target, options)
  const files = generatedFiles(projectName)
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
  const manifest: Manifest = { projectName: prior?.projectName ?? projectName, coreVersion: VERSION, schemaVersion: SCHEMA_VERSION, installedModules: MODULES, providers: { auth: "supabase", billing: "paddle", email: "resend", domains: "vercel", push: "web-push" }, managedFiles, generatedFiles: { "src/product/README.md": { ownership: "user-owned" }, "next-env.d.ts": { ownership: "mergeable" } }, installedAt: prior?.installedAt ?? now, updatedAt: now, version: VERSION, modules: MODULES }
  if (!options.dryRun) { mkdirSync(target, { recursive: true }); writeFileSync(join(target, ".saas-core.json"), json(manifest), "utf8") }
  for (const file of created) console.log(`${green(options.dryRun ? "·" : "✓")} ${file}`)
  if (conflicts.length) { console.log(`\n${yellow("Existing files preserved")}`); for (const file of conflicts) console.log(`  ${yellow("conflict")} ${file}`) }
  console.log(`\n${green(options.dryRun ? "Dry run complete" : "Project ready")}  ${dim(target)}`)
  if (!options.dryRun) console.log(`\nNext:\n  cd ${targetArg && targetArg !== "." ? targetArg : "."}\n  cp .env.example .env.local\n  pnpm install\n  pnpm dev`)
}

function check(label: string, status: "PASS" | "NOT CONFIGURED" | "WARN" | "FAIL" | "UNKNOWN", detail: string) { const symbol = status === "PASS" ? green("✓") : status === "WARN" || status === "NOT CONFIGURED" || status === "UNKNOWN" ? yellow("!") : red("✗"); console.log(`${symbol} ${label.padEnd(30)} ${status.padEnd(15)} ${dim(detail)}`); return status === "PASS" }
function commandVersion(command: string, args: string[] = ["--version"]): string | null { try { return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim().split("\n")[0] ?? null } catch { return null } }

async function probeSupabase() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_ANON_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) return { connectivity: ["NOT CONFIGURED" as const, "credentials required for a live check"], schema: ["NOT CONFIGURED" as const, "credentials required for a live check"], core: ["NOT CONFIGURED" as const, "service-role key required for protected health RPC"] }
  const headers = { apikey: key, Authorization: `Bearer ${key}` }
  try {
    const schemaResponse = await fetch(`${url.replace(/\/$/, "")}/rest/v1/saas_core_schema_versions?select=version&version=eq.${encodeURIComponent(SCHEMA_VERSION)}&limit=1`, { headers, signal: AbortSignal.timeout(5000) })
    if (!schemaResponse.ok) return { connectivity: ["FAIL" as const, `REST endpoint returned ${schemaResponse.status}`], schema: ["FAIL" as const, "schema version query failed"], core: ["WARN" as const, "health RPC was not attempted"] }
    const schemaRows = await schemaResponse.json() as unknown
    const schemaReady = Array.isArray(schemaRows) && schemaRows.some((row) => row && typeof row === "object" && (row as { version?: unknown }).version === SCHEMA_VERSION)
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return { connectivity: ["PASS" as const, "Supabase REST endpoint reachable"], schema: [schemaReady ? "PASS" as const : "WARN" as const, schemaReady ? SCHEMA_VERSION : "schema version not visible to anon key"], core: ["NOT CONFIGURED" as const, "service-role key required for protected health RPC"] }
    const healthResponse = await fetch(`${url.replace(/\/$/, "")}/rest/v1/rpc/core_health_check`, { method: "POST", headers: { ...headers, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(5000) })
    const health = await healthResponse.json().catch(() => null) as { ok?: boolean; missingTables?: string[] } | null
    return { connectivity: ["PASS" as const, "Supabase REST endpoint reachable"], schema: [schemaReady ? "PASS" as const : "FAIL" as const, schemaReady ? SCHEMA_VERSION : "required schema version missing"], core: [healthResponse.ok && health?.ok === true ? "PASS" as const : "FAIL" as const, healthResponse.ok && health?.ok === true ? "tables, functions and RLS health check passed" : `core health check failed${health?.missingTables?.length ? `: ${health.missingTables.join(", ")}` : ""}`] }
  } catch (error) {
    return { connectivity: ["FAIL" as const, error instanceof Error ? error.message : "Supabase request failed"], schema: ["UNKNOWN" as const, "schema could not be inspected"], core: ["UNKNOWN" as const, "core health could not be inspected"] }
  }
}

async function doctor(target: string) {
  const manifest = readManifest(target); let passed = 0; let total = 0
  const add = (label: string, status: "PASS" | "NOT CONFIGURED" | "WARN" | "FAIL" | "UNKNOWN", detail: string) => { total++; if (check(label, status, detail)) passed++ }
  add("Core manifest", manifest ? "PASS" : "FAIL", manifest ? `${manifest.coreVersion} / ${manifest.schemaVersion}` : "missing .saas-core.json")
  add("Node runtime", Number(process.versions.node.split(".")[0]) >= 20 ? "PASS" : "FAIL", process.versions.node)
  add("pnpm", commandVersion("pnpm") ? "PASS" : "FAIL", commandVersion("pnpm") ?? "not installed")
  let packageJson: ProjectPackage | null = null
  try { packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as ProjectPackage } catch { /* report below */ }
  add("Next.js compatibility", packageJson?.dependencies?.next ? "PASS" : "FAIL", packageJson?.dependencies?.next ?? "package dependency missing")
  add("Core config", existsSync(join(target, "core.config.ts")) ? "PASS" : "FAIL", "core.config.ts")
  add("Schema migration", existsSync(join(target, "supabase/migrations")) ? "PASS" : "FAIL", "migration directory")
  const envKeys = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]
  const configured = envKeys.filter((key) => Boolean(process.env[key] ?? process.env[`NEXT_PUBLIC_${key}`]))
  add("Auth environment", configured.length === envKeys.length ? "PASS" : "NOT CONFIGURED", `${configured.length}/${envKeys.length} configured; secrets hidden`)
  const probe = await probeSupabase()
  add("Supabase connectivity", (probe.connectivity[0] ?? "UNKNOWN") as "PASS" | "NOT CONFIGURED" | "WARN" | "FAIL" | "UNKNOWN", probe.connectivity[1] ?? "unknown")
  add("Core schema version", (probe.schema[0] ?? "UNKNOWN") as "PASS" | "NOT CONFIGURED" | "WARN" | "FAIL" | "UNKNOWN", probe.schema[1] ?? "unknown")
  add("Core tables/functions", (probe.core[0] ?? "UNKNOWN") as "PASS" | "NOT CONFIGURED" | "WARN" | "FAIL" | "UNKNOWN", probe.core[1] ?? "unknown")
  add("Paddle", process.env.PADDLE_API_KEY && process.env.PADDLE_WEBHOOK_SECRET ? "PASS" : "NOT CONFIGURED", "server credentials")
  add("Resend", process.env.RESEND_API_KEY && process.env.RESEND_FROM_EMAIL ? "PASS" : "NOT CONFIGURED", "server credentials")
  add("Vercel domains", process.env.VERCEL_TOKEN ? "PASS" : "NOT CONFIGURED", "optional provider credentials")
  add("Web Push", process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY ? "PASS" : "NOT CONFIGURED", "optional VAPID credentials")
  add("Cron secret", process.env.PADDLE_CRON_SECRET ? "PASS" : "NOT CONFIGURED", "internal lifecycle route")
  if (manifest) {
    const drift = Object.entries(manifest.managedFiles).filter(([file, value]) => !existsSync(join(target, file)) || hash(readFileSync(join(target, file), "utf8")) !== managedHash(value))
    add("Managed-file drift", drift.length === 0 ? "PASS" : "WARN", drift.length ? `${drift.length} files changed` : "baseline clean")
  } else add("Managed-file drift", "FAIL", "manifest unavailable")
  const buildReady = Boolean(packageJson?.scripts?.build && packageJson?.scripts?.dev)
  add("Build readiness", buildReady ? "PASS" : "FAIL", buildReady ? "dev/build scripts present" : "missing dev or build script")
  console.log(`\n${passed} passed  ${total - passed} requiring attention`); if (passed !== total) process.exitCode = 1
}

function diff(target: string) {
  const manifest = readManifest(target); if (!manifest) { console.log(red("No .saas-core.json found.")); process.exitCode = 1; return }
  const changes: string[] = []
  for (const [file, value] of Object.entries(manifest.managedFiles)) { if (!existsSync(join(target, file))) changes.push(`managed file deleted: ${file}`); else if (hash(readFileSync(join(target, file), "utf8")) !== managedHash(value)) changes.push(`managed file modified: ${file}`) }
  for (const file of Object.keys(manifest.generatedFiles)) if (!existsSync(join(target, file))) changes.push(`generated user-owned file deleted: ${file}`)
  let packageJson: ProjectPackage | null = null; try { packageJson = JSON.parse(readFileSync(join(target, "package.json"), "utf8")) as ProjectPackage } catch { /* reported as drift */ }
  if (packageJson?.dependencies && packageJson.dependencies["@sapienx/saas-core"] && !packageJson.dependencies["@sapienx/saas-core"].includes(VERSION)) changes.push(`package version mismatch: @sapienx/saas-core ${packageJson.dependencies["@sapienx/saas-core"]}`)
  if (!changes.length) console.log(`${green("✓ No Core drift")}\nManaged files checked: ${Object.keys(manifest.managedFiles).length}`)
  else { console.log(`${yellow("Core drift detected")}`); for (const change of changes) console.log(`  ${yellow(change)}`); process.exitCode = 2 }
}

function info(target: string) { const manifest = readManifest(target); console.log(json({ coreVersion: manifest?.coreVersion ?? null, schemaVersion: manifest?.schemaVersion ?? null, installedModules: manifest?.installedModules ?? [], providers: manifest?.providers ?? {}, environment: { node: process.versions.node, nodeEnv: process.env.NODE_ENV ?? "development", supabaseConfigured: Boolean(process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL) } })) }

function update(target: string, options: ReturnType<typeof parseFlags>) {
  const manifest = readManifest(target); if (!manifest) { console.log(red("No installed SaaS Core project found.")); process.exitCode = 1; return }
  const source = generatedFiles(manifest.projectName ?? readFileSync(join(target, "package.json"), "utf8").match(/"name"\s*:\s*"([^"]+)/)?.[1] ?? "saas-product")
  const backup = join(target, ".saas-core-backup", new Date().toISOString().replace(/[:.]/g, "-")); const conflicts: string[] = []; const changes: string[] = []
  for (const [relative, content] of source) {
    const absolute = join(target, relative)
    if (relative === ".saas-core.json") continue
    if (!existsSync(absolute)) { changes.push(`add ${relative}`); if (!options.dryRun) writeSafe(absolute, content, false) }
    else { const current = readFileSync(absolute, "utf8"); if (managedHash(manifest.managedFiles[relative] ?? "") && hash(current) !== managedHash(manifest.managedFiles[relative] ?? "")) conflicts.push(relative); else if (hash(current) !== hash(content)) { changes.push(`update ${relative}`); if (!options.dryRun) { mkdirSync(dirname(join(backup, relative)), { recursive: true }); cpSync(absolute, join(backup, relative)); writeFileSync(absolute, content, "utf8") } } }
  }
  const now = new Date().toISOString(); const next: Manifest = { ...manifest, coreVersion: VERSION, schemaVersion: SCHEMA_VERSION, installedModules: MODULES, updatedAt: now, version: VERSION, modules: MODULES }
  if (!options.dryRun) writeFileSync(join(target, ".saas-core.json"), json(next), "utf8")
  console.log(`${green(options.dryRun ? "Dry-run update" : "Core updated")} ${changes.length} change(s)`); if (conflicts.length) { console.log(yellow("Conflicts preserved:")); conflicts.forEach((file) => console.log(`  ${file}`)) }; if (!options.dryRun) console.log(dim(`backup: ${backup}`)); if (options.dryRun) changes.forEach((change) => console.log(`  ${change}`))
}

function test(target: string) {
  const manifest = readManifest(target); const checks: Array<[string, boolean, string]> = []
  checks.push(["Installed manifest", Boolean(manifest), ".saas-core.json"])
  checks.push(["Managed files", Boolean(manifest && Object.entries(manifest.managedFiles).every(([file, value]) => existsSync(join(target, file)) && hash(readFileSync(join(target, file), "utf8")) === managedHash(value))), "hash baseline"])
  checks.push(["Product boundary", existsSync(join(target, "src/product")), "src/product"])
  checks.push(["Next app routes", existsSync(join(target, "src/app")) && existsSync(join(target, "proxy.ts")), "App Router + proxy"])
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
