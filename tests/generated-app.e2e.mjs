import { chromium, expect } from "@playwright/test"
import { createClient } from "@supabase/supabase-js"
import { mkdirSync } from "node:fs"
import { join } from "node:path"

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
const screenshotDirectory = process.env.SAAS_CORE_SCREENSHOT_DIR ?? join(process.cwd(), "output", "playwright")
mkdirSync(screenshotDirectory, { recursive: true })
const capture = (name) => page.screenshot({ path: join(screenshotDirectory, `${name}.png`), fullPage: true })

async function findUserByEmail(email) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const users = (await service.auth.admin.listUsers({ page: 1, perPage: 100 })).data.users
    const user = users.find((candidate) => candidate.email === email)
    if (user) return user
    await new Promise((resolve) => globalThis.setTimeout(resolve, 250))
  }
  return null
}

try {
  await page.goto(`${baseUrl}/signup`)
  await capture("auth-desktop-light")
  await page.evaluate(() => { globalThis.document.documentElement.dataset.theme = "dark" })
  await capture("auth-desktop-dark")
  await page.setViewportSize({ width: 390, height: 844 })
  await page.evaluate(() => { globalThis.document.documentElement.dataset.theme = "light" })
  await capture("auth-mobile-light")
  await page.evaluate(() => { globalThis.document.documentElement.dataset.theme = "dark" })
  await capture("auth-mobile-dark")
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto(`${baseUrl}/signup`)
  await page.getByLabel("Email").fill(ownerEmail)
  await page.getByLabel("Password").fill(password)
  await page.getByRole("button", { name: "Create account" }).click()
  await page.waitForURL(/\/app|\/signup\?confirmation=/)
  if (page.url().includes("confirmation=")) throw new Error("Local Supabase required an email confirmation but no local confirmation handler was configured.")

  await page.goto(`${baseUrl}/app/setup`)
  if (!(await page.getByRole("heading", { name: "Production readiness." }).isVisible())) throw new Error("Setup Center did not render for an authenticated user.")
  await capture("setup-desktop")

  await page.goto(`${baseUrl}/onboarding`)
  await capture("onboarding-desktop")
  await page.getByLabel("Workspace name").fill("Browser Customer Workspace")
  await page.getByLabel("Workspace slug").fill(`browser-customer-${suffix}`)
  await page.getByRole("button", { name: "Create workspace" }).click()
  await page.waitForURL(/\/app$/)
  await capture("dashboard-desktop-expanded")
  await page.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(page.locator('[data-sidebar-state="collapsed"]')).toBeVisible()
  await capture("sidebar-collapsed")
  await page.reload()
  await expect(page.getByRole("button", { name: "Expand sidebar" })).toBeVisible()
  await page.getByRole("button", { name: "Expand sidebar" }).click()

  const owner = await findUserByEmail(ownerEmail)
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
  await expect(page.getByRole("combobox", { name: "Current workspace" })).toContainText("Browser Secondary Workspace")

  const allWorkspaces = await service.from("workspaces").select("id,name").eq("created_by", owner.id).order("created_at")
  if (allWorkspaces.error || allWorkspaces.data?.length !== 2) throw new Error("Expected exactly two owner workspaces.")
  await page.getByRole("combobox", { name: "Current workspace" }).click()
  await page.getByRole("option", { name: "Browser Customer Workspace" }).click()
  await page.getByRole("button", { name: "Switch workspace" }).click()
  await page.waitForURL(/\/app$/)
  for (const route of ["/app/team", "/app/plan", "/app/settings"]) {
    await page.goto(`${baseUrl}${route}`)
    await expect(page.getByRole("combobox", { name: "Current workspace" })).toContainText("Browser Customer Workspace")
    await expect(page.locator(`a.sc-nav-item-active[href="${route}"]`)).toHaveCount(1)
    await capture(route === "/app/team" ? "team-desktop" : route === "/app/plan" ? "plan-desktop" : "settings-desktop")
  }

  await page.goto(`${baseUrl}/platform`)
  await capture("platform-overview-desktop")

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
  await expect(page.getByRole("combobox", { name: "Current workspace" })).toContainText("Browser Customer Workspace")

  await page.goto(invitationLink)
  if (!(await page.getByRole("heading", { name: "Invitation unavailable." }).isVisible())) throw new Error("Invitation replay was not rejected.")

  await page.goto(`${baseUrl}/api/auth/signout`)
  await page.goto(`${baseUrl}/forgot-password`)
  await page.getByLabel("Email").fill(inviteeEmail)
  await page.getByRole("button", { name: "Send recovery link" }).click()
  await page.waitForURL(/\/forgot-password\?sent=1/)
  if (!(await page.getByText(/recovery email has been sent/i).isVisible())) throw new Error("Password recovery request did not complete.")

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

  await page.goto(`${baseUrl}/app/ui-lab`)
  await expect(page.getByTestId("ui-lab")).toBeVisible()
  const dialogTrigger = page.getByTestId("open-dialog")
  await dialogTrigger.click()
  await expect(page.getByTestId("dialog-content")).toBeVisible()
  await expect(page.getByLabel("Workspace name")).toHaveValue("Demo workspace")
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("dialog-content")).toHaveCount(0)
  await expect(dialogTrigger).toBeFocused()

  await page.getByTestId("open-sheet").click()
  await expect(page.getByTestId("sheet-content")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("sheet-content")).toHaveCount(0)

  await page.getByTestId("menu-trigger").click()
  await expect(page.getByRole("menuitem", { name: "Settings" })).toBeVisible()
  await page.getByRole("menuitem", { name: "Settings" }).click()
  await expect(page.getByText("Settings selected")).toBeVisible()

  await page.getByTestId("popover-trigger").click()
  await expect(page.getByTestId("popover-content")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.getByTestId("popover-content")).toHaveCount(0)

  await page.getByTestId("select-trigger").click()
  await page.getByRole("option", { name: "Team" }).click()
  await expect(page.getByTestId("select-trigger")).toContainText("Team")
  await page.getByTestId("tabs-settings").click()
  await expect(page.getByTestId("tabs-settings-panel")).toBeVisible()
  await page.getByTestId("accordion-trigger").click()
  await expect(page.getByTestId("accordion-content")).toBeVisible()
  await page.getByTestId("checkbox").click()
  await expect(page.getByTestId("checkbox")).toHaveAttribute("aria-checked", "true")
  await page.getByTestId("switch").click()
  await expect(page.getByTestId("switch")).toHaveAttribute("aria-checked", "false")
  const slider = page.getByTestId("slider").locator('[role="slider"]')
  await slider.press("ArrowRight")
  await expect(slider).toHaveAttribute("aria-valuenow", "65")

  await page.getByTestId("command-trigger").click()
  await expect(page.getByPlaceholder("Search workspace actions...")).toBeVisible()
  await page.getByTestId("command-item-overview").click()
  await expect(page.getByPlaceholder("Search workspace actions...")).toHaveCount(0)
  await page.getByTestId("tooltip-trigger").hover()
  await expect(page.getByTestId("tooltip-content")).toBeVisible()
  await page.getByTestId("toast-trigger").click()
  await expect(page.getByText("Saved with Core feedback")).toBeVisible()

  await capture("ui-lab-desktop-light")
  const themeButton = page.getByRole("button", { name: /Theme:/ }).first()
  await themeButton.click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await expect(page.getByTestId("open-dialog")).toBeVisible()
  await page.getByTestId("open-dialog").click()
  await expect(page.getByTestId("dialog-content")).toBeVisible()
  await capture("ui-lab-desktop-dark-dialog")
  await page.keyboard.press("Escape")

  await page.setViewportSize({ width: 390, height: 844 })
  await page.locator(".sc-mobile-header").getByRole("button", { name: /Theme:/ }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light")
  await page.goto(`${baseUrl}/app/ui-lab`)
  const mobileLayout = await page.evaluate(() => ({ scrollWidth: globalThis.document.documentElement.scrollWidth, clientWidth: globalThis.document.documentElement.clientWidth }))
  if (mobileLayout.scrollWidth > mobileLayout.clientWidth) throw new Error(`Mobile layout overflow: ${JSON.stringify(mobileLayout)}`)
  await expect(page.getByTestId("ui-lab")).toBeVisible()
  await page.getByRole("button", { name: /Open .* navigation/ }).click()
  await expect(page.locator("#sc-mobile-navigation")).toBeVisible()
  await page.keyboard.press("Escape")
  await expect(page.locator("#sc-mobile-navigation")).toHaveCount(0)
  await capture("ui-lab-mobile-light")
  await page.locator(".sc-mobile-header").getByRole("button", { name: /Theme:/ }).click()
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark")
  await capture("ui-lab-mobile-dark")
  console.log(JSON.stringify({ status: "PASS", owner: ownerEmail, invitation: "accepted", interactions: "dialog-sheet-menu-select-popover-tabs-accordion-form-command-toast", mobile: mobileLayout }))
} finally {
  await browser.close()
}
