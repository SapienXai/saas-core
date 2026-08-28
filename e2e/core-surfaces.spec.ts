import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import { expect, test, type Page } from "@playwright/test"

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const password = "CoreBrowser!2026-password"
const stamp = `${Date.now()}-${process.pid}`
const email = `core-browser-${stamp}@example.test`
const workspaceName = `Projects Proof ${stamp}`

let service: SupabaseClient | null = null
let userId = ""
let workspaceId = ""

async function waitForAuthReady() {
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY
  if (!anonKey) throw new Error("The browser proof needs the local Supabase anon key.")

  const client = createClient(url!, anonKey, { auth: { persistSession: false, autoRefreshToken: false } })
  let lastError: Error | null = null
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const result = await client.auth.signInWithPassword({ email, password })
    if (!result.error && result.data.user) {
      await client.auth.signOut()
      return
    }
    lastError = result.error
      ? new Error(`Local browser proof account is not ready: ${result.error.message}`)
      : new Error("Local browser proof account did not return a user.")
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw lastError || new Error("Local browser proof account was not ready in time.")
}

async function signInAndCreateWorkspace(page: Page) {
  await page.goto("/login")
  await page.locator("#login-email").fill(email)
  await page.locator("#login-password").fill(password)
  await page.getByRole("button", { name: "Sign in" }).click()
  await expect(page).toHaveURL(/\/(onboarding|app)(\?|$)/, { timeout: 30_000 })

  if (new URL(page.url()).pathname === "/onboarding") {
    await page.locator("#workspace-name").last().fill(workspaceName)
    await page.getByRole("button", { name: "Continue" }).last().click()
    await expect(page).toHaveURL(/\/app(\?|$)/, { timeout: 30_000 })
  }
  await expect(page.getByRole("heading", { name: "Workspace", exact: true })).toBeVisible()
  if (!workspaceId && service) {
    const result = await service.from("workspaces").select("id").eq("created_by", userId).maybeSingle()
    workspaceId = result.data?.id || ""
  }
}

test.beforeAll(async () => {
  test.skip(!url || !serviceRoleKey, "Local Supabase credentials are required for the authenticated browser proof.")
  service = createClient(url!, serviceRoleKey!, { auth: { persistSession: false, autoRefreshToken: false } })
  const result = await service.auth.admin.createUser({ email, password, email_confirm: true })
  if (result.error || !result.data.user) throw result.error || new Error("Could not create the browser proof account.")
  userId = result.data.user.id
  await waitForAuthReady()
})

test.afterAll(async () => {
  if (!service) return
  if (workspaceId) await service.from("workspaces").delete().eq("id", workspaceId)
  if (userId) await service.auth.admin.deleteUser(userId)
})

test("@critical public and auth surfaces remain available", async ({ page }) => {
  await page.goto("/")
  await expect(page.getByRole("heading", { name: "Build the product. Keep the platform quality." })).toBeVisible()
  await page.goto("/login")
  await expect(page.locator("#login-email")).toBeVisible()
  await expect(page.getByRole("link", { name: "Create an account" })).toBeVisible()
  await page.goto("/signup")
  await expect(page.locator("#signup-email")).toBeVisible()
  await page.goto("/forgot-password")
  await expect(page.locator("#forgot-email")).toBeVisible()
})

test("@critical authenticated shell preserves collapse, persistence, theme, and feedback", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "The authenticated desktop shell proof runs once in the desktop project.")
  await signInAndCreateWorkspace(page)

  const sidebar = page.locator("#manage-sidebar-desktop")
  await expect(sidebar).toBeVisible()
  await sidebar.getByRole("button", { name: "Collapse sidebar" }).click()
  await expect(sidebar).toHaveClass(/w-\[3\.75rem\]/)
  await page.reload()
  await expect(sidebar).toHaveClass(/w-\[3\.75rem\]/)
  await sidebar.getByRole("button", { name: "Open sidebar" }).click()
  await expect(sidebar).toHaveClass(/w-\[17rem\]/)

  // The Next development indicator can sit above the shell footer in dev mode;
  // production mode receives a normal pointer event at the same coordinate.
  await sidebar.locator("button").last().click()
  await page.getByRole("switch", { name: "Light mode" }).click()
  await expect(page.locator("body")).toHaveAttribute("data-manage-theme", "dark")
  await page.keyboard.press("Escape")
  await page.locator("header").getByRole("button", { name: "Notifications" }).click()
  await expect(page.getByText("No new notifications")).toBeVisible()
  await page.locator("header").getByRole("button", { name: "Close notifications" }).click()

  await sidebar.getByRole("button", { name: "Settings" }).click()
  await sidebar.getByRole("link", { name: "Team", exact: true }).click()
  await expect(page).toHaveURL(/\/app\/team(?:\?lang=en)?$/)
  await expect(page.getByRole("heading", { name: workspaceName, exact: true })).toBeVisible()
  await page.screenshot({ path: "output/playwright/core-team-desktop.png", fullPage: true })
})

test("@critical @mobile authenticated shell keeps mobile geometry and navigation usable", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "mobile-chromium", "The mobile shell proof runs once in the mobile project.")
  await signInAndCreateWorkspace(page)

  const dimensions = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }))
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport + 1)
  expect(dimensions.body).toBeLessThanOrEqual(dimensions.viewport + 1)
  await page.locator("header").getByRole("button").first().click()
  const navigationDialog = page.getByRole("dialog")
  await expect(navigationDialog).toBeVisible()
  await navigationDialog.getByRole("button", { name: "Settings" }).click()
  await expect(navigationDialog.getByRole("link", { name: "Team", exact: true })).toBeVisible()
  await navigationDialog.getByRole("button", { name: "Close navigation" }).click()
  await expect(navigationDialog).toBeHidden()
  await page.screenshot({ path: "output/playwright/core-workspace-mobile.png", fullPage: true })
})
