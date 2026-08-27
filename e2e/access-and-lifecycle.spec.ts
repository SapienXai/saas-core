import { test, expect } from "./fixtures"

test.describe("workspace and tenant access", () => {
  test.use({ scenarioKey: "business-multi" })

  test("switches workspaces without leaking the previous tenant @critical @e2e", async ({ page, loginAs }) => {
    await loginAs(page)
    await page.goto("/manage/restaurants")
    await expect(page.getByRole("button", { name: /current workspace|geçerli çalışma alanı/i })).toBeVisible()
    await page.getByRole("button", { name: /current workspace|geçerli çalışma alanı/i }).click()
    const secondaryWorkspace = page.getByRole("menuitem").filter({ hasText: /workspace two/i }).first()
    await expect(secondaryWorkspace).toBeVisible()
    await secondaryWorkspace.click()
    await page.waitForLoadState("networkidle")
    await expect(page.getByText(/business-multi workspace two/i).first()).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText(/business-multi restaurant/i).first()).not.toBeVisible()
  })
})

test.describe("restaurant-scoped roles", () => {
  test.use({ scenarioKey: "staff-restricted" })

  test("manager and staff see only their assigned restaurants @critical @e2e", async ({ page, loginAs }) => {
    await loginAs(page, "manager")
    await page.goto("/manage/restaurants")
    const managerMain = page.getByRole("main")
    await expect(managerMain.getByText(/staff-restricted second/i).first()).toBeVisible({ timeout: 30_000 })
    await expect(managerMain.getByText(/staff-restricted restaurant/i).first()).not.toBeVisible()

    await page.context().clearCookies()
    await page.evaluate(() => localStorage.clear())
    await loginAs(page, "staff")
    await page.goto("/manage/restaurants")
    const staffMain = page.getByRole("main")
    await expect(staffMain.getByText(/staff-restricted restaurant/i).first()).toBeVisible({ timeout: 30_000 })
    await expect(staffMain.getByText(/staff-restricted second/i).first()).not.toBeVisible()
  })
})

test.describe("unclaimed restaurant lifecycle", () => {
  test.use({ scenarioKey: "unclaimed" })

  test("shows claim CTA and completes exact-email claim @critical @e2e", async ({ page, scenario, loginAs }) => {
    if (!scenario?.primaryRestaurantSlug || !scenario.primaryRestaurantId) throw new Error("Scenario did not provide claim data.")
    await page.goto(`/r/${scenario.primaryRestaurantSlug}`)
    await expect(page.getByRole("link", { name: /claim/i })).toBeVisible({ timeout: 30_000 })
    await loginAs(page, "owner", `/claim/${scenario.primaryRestaurantId}`)
    await page.getByRole("button", { name: /claim this business|bu işletmeyi sahiplen/i }).click()
    await page.waitForURL(/\/manage(?:\/|$)/, { timeout: 30_000 })
    await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 30_000 })
  })
})
