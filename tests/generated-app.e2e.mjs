import { chromium } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"

const baseUrl = process.env.SAAS_CORE_APP_URL ?? "http://127.0.0.1:4321"
const supabaseUrl = process.env.SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
if (!supabaseUrl || !serviceRoleKey) throw new Error("The generated-app browser suite requires local Supabase service credentials.")

const service = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } })
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
const ownerEmail = `browser-owner-${suffix}@saas-core.test`
const inviteeEmail = `browser-invitee-${suffix}@saas-core.test`
const wrongEmail = `browser-wrong-${suffix}@saas-core.test`
const password = "BrowserAcceptance-123!"
const browser = await chromium.launch({ headless: true })
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })

try {
  await page.goto(`${baseUrl}/signup`)
  await page.getByLabel("Email").fill(ownerEmail)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/app|\/signup\?confirmation=/)
  if (page.url().includes("confirmation=")) throw new Error("Local Supabase required an email confirmation but no local confirmation handler was configured.")

  await page.goto(`${baseUrl}/onboarding`)
  await page.getByLabel("Workspace name").fill("Browser Customer Workspace")
  await page.getByLabel("Workspace slug").fill(`browser-customer-${suffix}`)
  await page.getByRole("button", { name: "Create workspace" }).click()
  await page.waitForURL(/\/app$/)

  const owner = (await service.auth.admin.listUsers({ page: 1, perPage: 100 })).data.users.find((user) => user.email === ownerEmail)
  if (!owner) throw new Error("Browser owner was not created in local Supabase.")
  const firstWorkspaces = await service.from("workspaces").select("id,name").eq("created_by", owner.id).order("created_at")
  if (firstWorkspaces.error || !firstWorkspaces.data?.[0]) throw new Error("Browser workspace was not persisted.")
  const firstWorkspace = firstWorkspaces.data[0]
  const firstSubscription = await service.from("workspace_subscriptions").update({ plan_key: "starter", status: "active" }).eq("workspace_id", firstWorkspace.id)
  if (firstSubscription.error) throw new Error(`Could not prepare the deterministic starter plan: ${firstSubscription.error.message}`)

  await page.goto(`${baseUrl}/onboarding`)
  await page.getByLabel("Workspace name").fill("Browser Secondary Workspace")
  await page.getByLabel("Workspace slug").fill(`browser-secondary-${suffix}`)
  await page.getByRole("button", { name: "Create workspace" }).click()
  await page.waitForURL(/\/app$/)
  if (!(await page.getByText("Browser Secondary Workspace").isVisible())) throw new Error("Second workspace was not selected after creation.")

  const allWorkspaces = await service.from("workspaces").select("id,name").eq("created_by", owner.id).order("created_at")
  if (allWorkspaces.error || allWorkspaces.data?.length !== 2) throw new Error("Expected exactly two owner workspaces.")
  await page.getByLabel("Workspace").selectOption(firstWorkspace.id)
  await page.getByRole("button", { name: "Switch workspace" }).click()
  await page.waitForURL(/\/app$/)
  for (const route of ["/app/team", "/app/plan", "/app/settings"]) {
    await page.goto(`${baseUrl}${route}`)
    if (!(await page.getByText("Browser Customer Workspace").first().isVisible())) throw new Error(`Current workspace did not persist on ${route}.`)
  }

  await page.goto(`${baseUrl}/app/team`)
  await page.getByLabel("Email").fill(inviteeEmail)
  await page.getByRole("button", { name: "Create invitation" }).click()
  await page.waitForURL(/local_invitation_link=/)
  const invitationLink = await page.locator('a[href*="/invite/"]').first().getAttribute("href")
  if (!invitationLink) throw new Error("Generated app did not expose the development invitation link.")
  if (!invitationLink.includes("token=")) throw new Error("Invitation link did not contain its boundary token.")

  const wrongUser = await service.auth.admin.createUser({ email: wrongEmail, password, email_confirm: true })
  if (wrongUser.error) throw new Error(`Could not prepare the wrong-account invitation check: ${wrongUser.error.message}`)
  await page.goto(`${baseUrl}/api/auth/signout`)
  await page.goto(invitationLink)
  await page.getByRole("link", { name: "Sign in" }).click()
  await page.waitForURL(/\/login\?next=/)
  await page.getByLabel("Email").fill(wrongEmail)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/invite\/.*token=/)
  if (!(await page.getByText(`This invitation belongs to ${inviteeEmail}`).isVisible())) throw new Error("Wrong-account invitation protection did not render.")
  if (await page.getByRole("button", { name: "Accept invitation" }).count() !== 0) throw new Error("Wrong account received an invitation acceptance control.")

  await page.goto(`${baseUrl}/api/auth/signout`)
  await page.goto(invitationLink)
  await page.getByRole("link", { name: "Create account" }).click()
  await page.getByLabel("Email").fill(inviteeEmail)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/invite\/.*token=/)
  await page.getByRole("button", { name: "Accept invitation" }).click()
  await page.waitForURL(/\/app\?invited=1/)
  if (!(await page.getByText("Browser Customer Workspace").isVisible())) throw new Error("Invitation acceptance did not select the invited workspace.")

  await page.goto(invitationLink)
  if (!(await page.getByRole("heading", { name: "Invitation unavailable." }).isVisible())) throw new Error("Invitation replay was not rejected.")

  await page.goto(`${baseUrl}/api/auth/signout`)
  await page.goto(`${baseUrl}/login?next=${encodeURIComponent("https://evil.example")}`)
  await page.getByLabel("Email").fill(inviteeEmail)
  await page.getByLabel("Password").fill("Wrong-password-123!")
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/error=invalid_credentials/)
  await page.goto(`${baseUrl}/login?next=${encodeURIComponent("https://evil.example")}`)
  await page.getByLabel("Email").fill(inviteeEmail)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await page.waitForURL(/\/app$/)
  if (new URL(page.url()).origin !== new URL(baseUrl).origin || new URL(page.url()).pathname !== "/app") throw new Error(`Unsafe redirect was accepted: ${page.url()}`)

  await page.setViewportSize({ width: 390, height: 844 })
  const mobileLayout = await page.evaluate(() => ({ scrollWidth: globalThis.document.documentElement.scrollWidth, clientWidth: globalThis.document.documentElement.clientWidth }))
  if (mobileLayout.scrollWidth > mobileLayout.clientWidth) throw new Error(`Mobile layout overflow: ${JSON.stringify(mobileLayout)}`)
  console.log(JSON.stringify({ status: "PASS", owner: ownerEmail, invitation: "accepted", mobile: mobileLayout }))
} finally {
  await browser.close()
}
