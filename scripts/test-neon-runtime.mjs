import assert from "node:assert/strict"
import { randomUUID } from "node:crypto"
import { setTimeout as delay } from "node:timers/promises"
import { chromium, expect } from "@playwright/test"
import { createNeonDataClient } from "@sapienx/saas-core/postgres"

const origin = process.env.SAAS_CORE_AUTH_URL
const mail = process.env.SAAS_CORE_MAIL_URL
const dataApi = process.env.NEON_DATA_API_URL
for (const url of [origin, mail, dataApi, process.env.DATABASE_URL]) {
  assert.ok(url && ["127.0.0.1", "localhost"].includes(new URL(url).hostname), "This test only accepts loopback fixtures.")
}
assert.equal(process.env.NEXT_PUBLIC_SAAS_CORE_BACKEND, "neon")
assert.ok(!process.env.SUPABASE_URL && !process.env.NEXT_PUBLIC_SUPABASE_URL)
const marker = randomUUID().slice(0, 12)
const firstPassword = "Local-test-" + randomUUID()
const newPassword = "Updated-test-" + randomUUID()
const browser = await chromium.launch()

async function waitForEmail(email, subject) {
  for (let attempt = 0; attempt < 30; attempt++) {
    const list = await fetch(mail + "/api/v1/messages").then(response => response.json())
    const item = list.messages.find(message => message.Subject === subject && message.To.some(entry => entry.Address === email))
    if (item) {
      const message = await fetch(mail + "/api/v1/message/" + item.ID).then(response => response.json())
      const url = new URL(message.Text.trim())
      assert.equal(url.origin, origin)
      return url
    }
    await delay(250)
  }
  throw new Error("Expected email did not arrive at local Mailpit.")
}

async function post(context, path, data) {
  return context.request.post(origin + path, { headers: { Origin: origin }, data })
}

async function register(suffix) {
  const context = await browser.newContext({ baseURL: origin })
  const email = `neon-${marker}-${suffix}@example.test`
  assert.equal((await post(context, "/auth/signup", { email, password: firstPassword })).status(), 200)
  assert.equal((await post(context, "/auth/signin", { email, password: firstPassword })).status(), 401)
  const verification = await waitForEmail(email, "Verify your email address")
  const response = await context.request.get(verification.href)
  assert.ok(response.ok())
  const session = await context.request.get(origin + "/api/core-auth/get-session").then(result => result.json())
  assert.equal(session?.user?.email, email)
  assert.equal(session.user.emailVerified, true)
  return { context, email, id: session.user.id }
}

try {
  const owner = await register("owner")
  const outsider = await register("outsider")
  const page = await owner.context.newPage()
  await page.goto("/onboarding")
  await page.getByLabel("Workspace name").fill("Neon " + marker)
  await page.getByRole("button", { name: "Continue" }).click()
  await expect(page).toHaveURL(/\/app(?:[/?#]|$)/, { timeout: 30_000 })
  const service = createNeonDataClient({ role: "service_role" })
  const owned = await service.from("workspaces").select("id").eq("created_by", owner.id).single()
  assert.equal(owned.error, null)
  const ownerDb = createNeonDataClient({ role: "authenticated", id: owner.id, email: owner.email })
  const outsiderDb = createNeonDataClient({ role: "authenticated", id: outsider.id, email: outsider.email })
  assert.equal((await ownerDb.from("workspaces").select("id").eq("id", owned.data.id).single()).data?.id, owned.data.id)
  assert.deepEqual((await outsiderDb.from("workspaces").select("id").eq("id", owned.data.id)).data, [])
  assert.ok((await outsiderDb.from("billing_mutations").select("id")).error)
  assert.equal((await post(outsider.context, "/api/core-auth/admin/create-user", {})).status(), 404)
  assert.equal((await post(owner.context, "/api/core-auth/request-password-reset", {
    email: owner.email, redirectTo: origin + "/reset-password",
  })).status(), 200)
  const reset = await waitForEmail(owner.email, "Reset your password")
  await page.goto(reset.href)
  await page.locator("#new-password").fill(newPassword)
  await page.locator("#new-password-confirmation").fill(newPassword)
  await page.getByRole("button", { name: /update password/i }).click()
  await expect(page).toHaveURL(/\/login\?reset=success/)
  const session = await owner.context.request.get(origin + "/api/core-auth/get-session").then(result => result.json())
  assert.equal(session, null)
  assert.equal((await post(owner.context, "/auth/signin", { email: owner.email, password: firstPassword })).status(), 401)
  assert.equal((await post(owner.context, "/auth/signin", { email: owner.email, password: newPassword })).status(), 200)
  await owner.context.request.get(origin + "/auth/signout")
  assert.equal(await owner.context.request.get(origin + "/api/core-auth/get-session").then(result => result.json()), null)
  console.log("PASS Neon runtime: signup, confirmation, workspace creation, RLS, privileged endpoint denial, reset, sign-in and logout")
} finally {
  await browser.close()
}
