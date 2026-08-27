import { test, expect, completeGuestReservation } from "./fixtures"

test.describe("public booking and management", () => {
  test.use({ scenarioKey: "free-new" })

  test("publishes a restaurant, accepts a guest booking, and shows it in management @critical @e2e", async ({ page, browser, scenario, loginAs }) => {
    if (!scenario?.primaryRestaurantSlug) throw new Error("Scenario did not provide a restaurant slug.")
    await loginAs(page)
    await page.goto("/onboarding")
    await page.getByRole("button", { name: /set up my profile manually|profilimi manuel/i }).click()
    await page.getByRole("button", { name: /save and publish|kaydet ve yayınla/i }).click()
    await page.waitForURL(/\/manage(?:\/|$)/, { timeout: 30_000 })

    const guestContext = await browser.newContext()
    const guestPage = await guestContext.newPage()
    try {
      await guestPage.goto(`/reserve?restaurantSlug=${encodeURIComponent(scenario.primaryRestaurantSlug)}`)
      await expect(guestPage.getByRole("button", { name: /continue|devam/i })).toBeVisible({ timeout: 30_000 })
      await completeGuestReservation(guestPage, `guest-${scenario.runId}@example.test`)
      await expect(guestPage.getByRole("heading", { name: /reservation received|rezervasyonunuz alındı/i })).toBeVisible({ timeout: 30_000 })
    } finally {
      await guestContext.close()
    }

    await page.goto("/manage/reservations")
    await expect(page.getByText("Browser Guest")).toBeVisible({ timeout: 30_000 })
  })

})

test.describe("mobile booking", () => {
  test.use({ scenarioKey: "starter-active" })

  test("booking flow has no horizontal overflow on mobile @critical @mobile @e2e", async ({ page, browser, scenario }) => {
    if (!scenario?.primaryRestaurantSlug) throw new Error("Scenario did not provide a restaurant slug.")
    await page.goto(`/reserve?restaurantSlug=${encodeURIComponent(scenario.primaryRestaurantSlug)}`)
    await expect(page.getByRole("button", { name: /continue|devam/i })).toBeVisible({ timeout: 30_000 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await page.getByRole("button", { name: /continue|devam/i }).click()
    await expect(page.getByRole("heading", { name: /contact|iletişim/i })).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    void browser
  })
})

test.describe("customer reservation management", () => {
  test.use({ scenarioKey: "starter-active" })

  test("updates and cancels a reservation through its scoped management link @critical @e2e", async ({ page, scenario }) => {
    if (!scenario?.primaryRestaurantSlug || !scenario.customerManagementTokens[0]?.token) {
      throw new Error("Scenario did not provide a customer management token.")
    }
    const token = scenario.customerManagementTokens[0].token
    const manageUrl = `/r/${scenario.primaryRestaurantSlug}?manageToken=${encodeURIComponent(token)}`

    await page.goto(manageUrl)
    const dialog = page.getByRole("dialog", { name: /edit your reservation|rezervasyonunuzu düzenleyin/i })
    await expect(dialog).toBeVisible({ timeout: 30_000 })
    await dialog.getByLabel(/special requests|özel istekler/i).fill("Updated by browser")
    await dialog.getByRole("button", { name: /save changes|değişiklikleri kaydet/i }).click()
    await expect(dialog).toBeHidden({ timeout: 30_000 })

    await page.goto(manageUrl)
    const reloadedDialog = page.getByRole("dialog", { name: /edit your reservation|rezervasyonunuzu düzenleyin/i })
    await expect(reloadedDialog.getByLabel(/special requests|özel istekler/i)).toHaveValue("Updated by browser", { timeout: 30_000 })
    await reloadedDialog.getByRole("button", { name: /cancel reservation|rezervasyonu iptal et/i }).click()
    const cancelDialog = page.getByRole("alertdialog")
    await expect(cancelDialog).toBeVisible()
    await cancelDialog.getByRole("button", { name: /yes, cancel it|evet, iptal et/i }).click()
    await expect(cancelDialog).toBeHidden({ timeout: 30_000 })
    await expect(page.getByRole("link", { name: /reserve table|reserve a table|masa ayırt/i })).toBeVisible({ timeout: 30_000 })
  })
})

test.describe("reservation idempotency", () => {
  test.use({ scenarioKey: "starter-active" })

  test("double submit creates one reservation and returns one success @critical @e2e", async ({ page, browser, scenario, loginAs }) => {
    if (!scenario?.primaryRestaurantSlug) throw new Error("Scenario did not provide a restaurant slug.")
    const guestContext = await browser.newContext()
    const guestPage = await guestContext.newPage()
    try {
      await guestPage.goto(`/reserve?restaurantSlug=${encodeURIComponent(scenario.primaryRestaurantSlug)}`)
      await expect(guestPage.getByRole("button", { name: /continue|devam/i })).toBeVisible({ timeout: 30_000 })
      await completeGuestReservation(guestPage, `duplicate-${scenario.runId}@example.test`, "Duplicate Browser Guest", { duplicateSubmit: true })
      await expect(guestPage.getByRole("heading", { name: /reservation received|rezervasyonunuz alındı/i })).toBeVisible({ timeout: 30_000 })
    } finally {
      await guestContext.close()
    }

    await loginAs(page)
    await page.goto("/manage/reservations")
    await expect(page.getByText("Duplicate Browser Guest")).toHaveCount(1, { timeout: 30_000 })
  })
})

test.describe("free reservation quota", () => {
  test.use({ scenarioKey: "free-100" })

  test("blocks the next public reservation after 100 and exposes upgrade options in management @critical @e2e", async ({ page, browser, scenario, loginAs }) => {
    if (!scenario?.primaryRestaurantSlug) throw new Error("Scenario did not provide a restaurant slug.")
    const guestContext = await browser.newContext()
    const guestPage = await guestContext.newPage()
    try {
      await guestPage.goto(`/reserve?restaurantSlug=${encodeURIComponent(scenario.primaryRestaurantSlug)}`)
      await expect(guestPage.getByRole("heading", { name: /reservations are resting|rezervasyonlar şu an dinleniyor/i })).toBeVisible({ timeout: 30_000 })
    } finally {
      await guestContext.close()
    }

    await loginAs(page)
    await page.goto("/manage")
    await expect(page.getByRole("link", { name: /view plans|planları görüntüle/i }).first()).toBeVisible({ timeout: 30_000 })
  })
})

test.describe("plan limits in management", () => {
  test.use({ scenarioKey: "free-new" })

  test("blocks a second restaurant and routes to upgrade options @critical @e2e", async ({ page, loginAs }) => {
    await loginAs(page)
    await page.goto("/onboarding")
    await page.getByRole("button", { name: /set up my profile manually|profilimi manuel/i }).click()
    await page.getByRole("button", { name: /save and publish|kaydet ve yayınla/i }).click()
    await page.waitForURL(/\/manage(?:\/|$)/, { timeout: 30_000 })

    await page.goto("/manage/restaurants")
    await page.getByRole("button", { name: /add restaurant|restoran ekle/i }).click()
    const upgradeDialog = page.getByRole("dialog", { name: /used all restaurant slots|restaurant slots|restoran slot/i })
    await expect(upgradeDialog).toBeVisible({ timeout: 30_000 })
    await upgradeDialog.getByRole("link", { name: /view upgrade options|yükseltme seçenekleri/i }).click()
    await page.waitForURL(/\/manage\/plan(?:#.*)?$/, { timeout: 30_000 })
    await expect(page.getByRole("heading", { name: /plan|usage|kullanım/i }).first()).toBeVisible()
  })
})
