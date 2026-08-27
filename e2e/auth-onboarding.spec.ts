import { test, expect, cleanupScenarioUserByEmail } from "./fixtures"

test.describe("signup and onboarding", () => {
  test.use({ scenarioKey: "free-new" })

  test("signup, email confirmation, manual onboarding, publish, and dashboard @critical @e2e", async ({ page, waitForConfirmationEmail }, testInfo) => {
    const email = `rv-browser-signup-${testInfo.workerIndex}-${Date.now()}@example.test`
    const password = "ReserveviaBrowser!2026"
    try {
      await page.goto("/signup?redirect=/onboarding")
      const createAccountButton = page.getByRole("button", { name: /create account|hesap oluştur/i })
      await expect(createAccountButton).toBeEnabled({ timeout: 30_000 })
      await page.getByLabel(/email/i).fill(email)
      await page.getByLabel(/^password$/i).fill(password)
      await page.getByLabel(/confirm password|şifreyi tekrar/i).fill(password)
      await createAccountButton.click()
      await expect(page.getByRole("heading", { name: /check your inbox|confirm your email|gelen kutunuzu kontrol edin|e-postanızı doğrulayın/i })).toBeVisible({ timeout: 30_000 })

      const confirmationUrl = await waitForConfirmationEmail(email)
      await page.goto(confirmationUrl)
      await page.waitForURL(/\/onboarding(?:\?|$)/, { timeout: 30_000 })

      await page.getByRole("button", { name: /set up my profile manually|manuel/i }).click()
      await page.getByLabel(/restaurant name|restoran adı/i).fill(`Browser Onboarding ${testInfo.workerIndex}`)
      await page.getByRole("button", { name: /save and publish|kaydet ve yayınla/i }).click()
      await page.waitForURL(/\/manage(?:\/|$)/)
      await expect(page.getByRole("heading", { name: /dashboard/i })).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole("button", { name: /current workspace/i })).toContainText(/browser onboarding/i, { timeout: 30_000 })

    } finally {
      await cleanupScenarioUserByEmail(email)
    }
  })

  test("onboarding remains usable on a compact mobile viewport @critical @mobile @e2e", async ({ page, loginAs }) => {
    await loginAs(page)
    await page.goto("/onboarding")
    await expect(page.getByRole("main").getByText(/drop in your restaurant website|restoranınızın website linkini bırakın/i).first()).toBeVisible()
    await expect(page.locator("body")).not.toHaveCSS("overflow-x", "scroll")
    await page.getByRole("button", { name: /set up my profile manually|profilimi manuel/i }).click()
    await expect(page.getByRole("button", { name: /save and publish|kaydet ve yayınla/i })).toBeVisible()
  })
})
