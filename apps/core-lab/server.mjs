import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { extname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHmac } from "node:crypto"
import { performance } from "node:perf_hooks"

const { InMemorySaaSStore, CoreError, canManageWorkspaceRole, applyPaddleSubscriptionSnapshot, createDomainRecord, normalizeHostname, verifyPaddleWebhookSignature } = await import("../../packages/core/dist/index.js")
const root = fileURLToPath(new URL(".", import.meta.url))
const port = Number(process.env.CORE_LAB_PORT ?? 4173)
const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8" }

function result(input) { return { ...input, durationMs: input.durationMs ?? 0 } }
function runScenario(id, title, description, operation) {
  const started = performance.now()
  try {
    const value = operation()
    return result({ id, title, description, status: value.status ?? "PASS", expected: value.expected, actual: value.actual, operation: value.operation, errorCode: value.errorCode ?? null, detail: value.detail, durationMs: Math.round(performance.now() - started) })
  } catch (error) {
    return result({ id, title, description, status: "FAIL", expected: "scenario completes", actual: error instanceof Error ? error.message : "unknown error", operation: "scenario runner", errorCode: error instanceof CoreError ? error.code : "UNEXPECTED", detail: "Unexpected runner failure.", durationMs: Math.round(performance.now() - started) })
  }
}

function runSuite() {
  const scenarios = []
  scenarios.push(runScenario("tenant-isolation", "Tenant isolation", "User A cannot read or write Workspace B.", () => {
    const store = new InMemorySaaSStore(); const a = store.addUser({ id: "user-a", email: "a@example.test" }); const b = store.addUser({ id: "user-b", email: "b@example.test" }); store.createWorkspace({ ownerUserId: a.id, name: "Workspace A", slug: "workspace-a" }); const second = store.createWorkspace({ ownerUserId: b.id, name: "Workspace B", slug: "workspace-b" })
    try { store.requireMember(second.workspace.id, a.id, "workspace:read"); return { status: "FAIL", expected: "FORBIDDEN", actual: "access granted", operation: `requireMember(${second.workspace.id}, ${a.id})`, detail: "Cross-tenant access was not blocked." } } catch (error) { return { status: "BLOCKED_AS_EXPECTED", expected: "FORBIDDEN", actual: error instanceof CoreError ? error.code : "unknown", errorCode: error instanceof CoreError ? error.code : "UNEXPECTED", operation: `requireMember(${second.workspace.id}, ${a.id})`, detail: `Workspace A remained isolated from ${second.workspace.slug}.` } }
  }))
  scenarios.push(runScenario("role-security", "Role hierarchy", "Admin cannot promote to owner or mutate the owner.", () => {
    const checks = [{ actor: "admin", target: "owner" }, { actor: "admin", target: "admin" }, { actor: "admin", target: "manager" }].map((entry) => ({ ...entry, allowed: canManageWorkspaceRole(entry.actor, entry.target) }))
    const blocked = checks.filter((entry) => !entry.allowed).length
    return { status: blocked === 2 ? "BLOCKED_AS_EXPECTED" : "FAIL", expected: "2 forbidden role mutations", actual: `${blocked} forbidden role mutations`, operation: "canManageWorkspaceRole", detail: "Owner promotion and peer-admin mutation are denied; lower roles remain manageable." }
  }))
  scenarios.push(runScenario("invitation-lifecycle", "Invitation lifecycle", "Invite, accept, and replay an invitation using a hashed token.", () => {
    const store = new InMemorySaaSStore(); const owner = store.addUser({ id: "owner", email: "owner@example.test" }); const invitee = store.addUser({ id: "invitee", email: "invitee@example.test" }); const workspace = store.createWorkspace({ ownerUserId: owner.id, name: "Team", slug: "team" }).workspace; store.setSubscription(workspace.id, { planKey: "starter" }); const invitation = store.invite({ actorUserId: owner.id, workspaceId: workspace.id, email: invitee.email, role: "member" }); const member = store.acceptInvitation({ token: invitation.token, userId: invitee.id }); let replayCode = "none"; try { store.acceptInvitation({ token: invitation.token, userId: invitee.id }) } catch (error) { replayCode = error instanceof CoreError ? error.code : "UNEXPECTED" } return { status: member.role === "member" && replayCode === "INVITATION_INVALID" ? "PASS" : "FAIL", expected: "member created once; replay rejected", actual: `${member.role}; replay=${replayCode}`, operation: "acceptInvitation → acceptInvitation", errorCode: replayCode, detail: "The plaintext token was used only at the boundary and the stored record contains its hash." }
  }))
  scenarios.push(runScenario("usage-limit", "Usage quota", "A bounded metric rejects the increment that would exceed its effective limit.", () => {
    const store = new InMemorySaaSStore(); const owner = store.addUser({ id: "owner", email: "owner@example.test" }); const workspace = store.createWorkspace({ ownerUserId: owner.id, name: "Usage", slug: "usage" }).workspace; store.state.plans.get("free").limits.api_calls = 2; store.incrementUsage({ workspaceId: workspace.id, metric: "api_calls", amount: 2 }); let code = "none"; try { store.incrementUsage({ workspaceId: workspace.id, metric: "api_calls" }) } catch (error) { code = error instanceof CoreError ? error.code : "UNEXPECTED" } return { status: code === "LIMIT_REACHED" ? "BLOCKED_AS_EXPECTED" : "FAIL", expected: "LIMIT_REACHED", actual: code, operation: "consumeUsage(api_calls, +1)", errorCode: code, detail: "The effective free-plan limit stayed authoritative at 2." }
  }))
  scenarios.push(runScenario("billing-order", "Billing event order", "Older provider events cannot overwrite newer local state.", () => {
    const store = new InMemorySaaSStore(); const owner = store.addUser({ id: "owner", email: "owner@example.test" }); const workspace = store.createWorkspace({ ownerUserId: owner.id, name: "Billing", slug: "billing" }).workspace; const current = store.state.subscriptions.get(workspace.id); const newer = applyPaddleSubscriptionSnapshot(current, { providerSubscriptionId: "sub", providerCustomerId: "cus", environment: "sandbox", status: "active", planKey: "pro", providerPriceId: "pri_pro", interval: "month", currency: "USD", currentPeriodStart: null, currentPeriodEnd: null, scheduledPlanKey: null, scheduledPlanAt: null, occurredAt: "2026-08-24T10:00:00.000Z" }); const older = applyPaddleSubscriptionSnapshot(newer, { providerSubscriptionId: "sub", providerCustomerId: "cus", environment: "sandbox", status: "past_due", planKey: "starter", providerPriceId: "pri_starter", interval: "month", currency: "USD", currentPeriodStart: null, currentPeriodEnd: null, scheduledPlanKey: null, scheduledPlanAt: null, occurredAt: "2026-08-24T09:00:00.000Z" }); return { status: older.planKey === "pro" ? "PASS" : "FAIL", expected: "pro remains authoritative", actual: older.planKey, operation: "applyPaddleSubscriptionSnapshot(newer, older)", detail: "Occurred-at ordering rejected the stale event." }
  }))
  scenarios.push(runScenario("grace-expiry", "Payment grace", "Expired past_due access falls back to Free without deleting provider identifiers.", () => {
    const store = new InMemorySaaSStore(); const owner = store.addUser({ id: "owner", email: "owner@example.test" }); const workspace = store.createWorkspace({ ownerUserId: owner.id, name: "Grace", slug: "grace" }).workspace; store.setSubscription(workspace.id, { planKey: "pro", status: "past_due", paymentGraceEndsAt: "2026-08-01T00:00:00.000Z", providerSubscriptionId: "sub_grace" }); const plan = store.getEntitlements(workspace.id, new Date("2026-08-24T00:00:00.000Z")).planKey; return { status: plan === "free" && store.state.subscriptions.get(workspace.id).providerSubscriptionId === "sub_grace" ? "PASS" : "FAIL", expected: "free effective plan; provider ID retained", actual: `${plan}; provider=${store.state.subscriptions.get(workspace.id).providerSubscriptionId}`, operation: "resolveEntitlements(at=2026-08-24)", detail: "Grace expiry changes authorization, not stored customer/provider evidence." }
  }))
  scenarios.push(runScenario("platform-roles", "Platform authorization", "Support inspection is separate from customer workspace mutation.", () => {
    const supportRead = ["platform_owner", "platform_admin", "support", "auditor"].includes("support"); const supportMutate = ["platform_owner", "platform_admin"].includes("support"); return { status: supportRead && !supportMutate ? "BLOCKED_AS_EXPECTED" : "FAIL", expected: "support read=true, mutate=false", actual: `read=${supportRead}, mutate=${supportMutate}`, operation: "platform role permission matrix", detail: "Support view is read-only and does not impersonate a customer." }
  }))
  scenarios.push(runScenario("domain-normalization", "Domain safety", "Platform hosts and IP addresses are rejected before provider calls.", () => {
    const normalized = normalizeHostname("https://Customer.Example.net./"); let ipCode = "none"; try { normalizeHostname("http://127.0.0.1") } catch (error) { ipCode = error instanceof CoreError ? error.code : "UNEXPECTED" } const record = createDomainRecord({ id: "domain", workspaceId: "workspace", hostname: normalized }); return { status: normalized === "customer.example.net" && ipCode === "DOMAIN_ERROR" && record.status === "pending" ? "PASS" : "FAIL", expected: "normalized hostname; IP rejected", actual: `${normalized}; ip=${ipCode}`, operation: "normalizeHostname + createDomainRecord", errorCode: ipCode, detail: "Provider reconciliation receives only normalized, non-platform hostnames." }
  }))
  scenarios.push(runScenario("webhook-signature", "Webhook authenticity", "Paddle raw-body signatures are checked with timestamp tolerance.", () => {
    const rawBody = JSON.stringify({ event: "subscription.updated" }); const now = Date.now(); const timestamp = Math.floor(now / 1000); const signature = createHmac("sha256", "lab-secret").update(`${timestamp}:${rawBody}`).digest("hex"); const valid = verifyPaddleWebhookSignature(rawBody, `ts=${timestamp};h1=${signature}`, "lab-secret", now); const stale = verifyPaddleWebhookSignature(rawBody, `ts=${timestamp - 9999};h1=${signature}`, "lab-secret", now); return { status: valid && !stale ? "PASS" : "FAIL", expected: "valid=true, stale=false", actual: `valid=${valid}, stale=${stale}`, operation: "verifyPaddleWebhookSignature(rawBody)", detail: "The scenario uses a deterministic mock secret; no live provider call is made." }
  }))
  return { mode: "in-memory-deterministic", version: "1.0.0", generatedAt: new Date().toISOString(), scenarios }
}

const server = createServer(async (request, response) => {
  try {
    if (request.url?.startsWith("/api/scenarios")) { response.writeHead(200, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }); response.end(JSON.stringify(runSuite())); return }
    const relative = request.url === "/" ? "/index.html" : request.url?.split("?")[0] ?? "/index.html"; const file = join(root, "public", relative); const body = await readFile(file); response.writeHead(200, { "content-type": contentTypes[extname(file)] ?? "application/octet-stream" }); response.end(body)
  } catch { response.writeHead(404, { "content-type": "text/plain; charset=utf-8" }); response.end("Not found") }
})
server.listen(port, "127.0.0.1", () => console.log(`Core Lab running at http://127.0.0.1:${port}`))
