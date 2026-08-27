import { test as base, expect, type Page } from "@playwright/test"
import {
  cleanupScenarioUser,
  cleanupScenarioUserByEmail,
  destroyScenario,
  getScenarioCredentials,
  seedScenario,
  type ScenarioKey,
  type ScenarioManifest,
} from "../lib/dev/scenario-factory"

type MailpitMessage = {
  Subject?: string
  To?: Array<{ Address?: string }>
  HTML?: string
}

type Fixtures = {
  scenarioKey: ScenarioKey | null
  scenario: ScenarioManifest | null
  loginAs: (page: Page, label?: string, redirect?: string) => Promise<void>
  waitForConfirmationEmail: (email: string) => Promise<string>
}

const mailpitUrl = process.env.RESERVEVIA_MAIL_URL || "http://127.0.0.1:54524"

export const test = base.extend<Fixtures>({
  scenarioKey: ["free-new", { option: true }],
  scenario: async ({ scenarioKey }, provide, testInfo) => {
    const manifest = scenarioKey
      ? await seedScenario(scenarioKey, { runId: `${testInfo.workerIndex}-${testInfo.testId}` })
      : null
    await provide(manifest)
    if (manifest) await destroyScenario(manifest)
  },
  loginAs: async ({ scenario, request }, provide) => {
    await provide(async (page, label = "owner", redirect = "/manage") => {
      const manifest = scenario
      if (!manifest) throw new Error("loginAs requires the scenario fixture.")
      const credentials = getScenarioCredentials(manifest, label)
      await page.goto(`/login?redirect=${encodeURIComponent(redirect)}`)
      await page.getByLabel(/email/i).fill(credentials.email)
      await page.getByRole("textbox", { name: /^password$/i }).fill(credentials.password)
      const userAgent = await page.evaluate(() => navigator.userAgent)
      const isWebKit = /AppleWebKit/i.test(userAgent) && !/Chrome|Chromium/i.test(userAgent)
      const installApiSession = async () => {
        const response = await request.post("/auth/signin", {
          form: { email: credentials.email, password: credentials.password, redirect },
        })
        if (!response.ok()) throw new Error(`WebKit auth bootstrap failed with ${response.status()}.`)
        const cookieUrl = new URL(page.url()).origin
        const cookies = response.headersArray()
          .filter((header) => header.name.toLowerCase() === "set-cookie")
          .map((header) => header.value.split(";", 1)[0])
          .map((pair) => {
            const separator = pair.indexOf("=")
            return separator > 0
              ? { name: pair.slice(0, separator), value: pair.slice(separator + 1), url: cookieUrl }
              : null
          })
          .filter((cookie): cookie is { name: string; value: string; url: string } => Boolean(cookie))
        if (!cookies.some((cookie) => cookie.name.includes("-auth-token"))) throw new Error("WebKit auth cookies were not returned.")
        await page.context().addCookies(cookies)
      }
      if (isWebKit) {
        await installApiSession()
        await page.goto(`/auth/continue?redirect=${encodeURIComponent(redirect)}`)
        await page.waitForURL(/\/(manage|onboarding|claim\/[^/]+)(?:\/|$)/, { timeout: 30_000, waitUntil: "commit" })
        return
      }
      await page.getByRole("button", { name: /sign in|giriş yap/i }).click()
      try {
        await page.waitForURL(/\/(manage|onboarding|claim\/[^/]+)(?:\/|$)/, { timeout: 30_000, waitUntil: "commit" })
        return
      } catch (error) {
        if (!isWebKit) throw error

        // WebKit in the hosted Playwright runner can discard the chunked
        // Set-Cookie headers from a top-level local form navigation. Re-run
        // the same route through Playwright's API context and install only
        // the opaque session cookies into this test context. This is local
        // E2E-only; production code never takes this branch.
        await installApiSession()
        await page.goto(`/auth/continue?redirect=${encodeURIComponent(redirect)}`)
        await page.waitForURL(/\/(manage|onboarding|claim\/[^/]+)(?:\/|$)/, { timeout: 30_000, waitUntil: "commit" })
      }
    })
  },
  waitForConfirmationEmail: async ({ request }, provide) => {
    await provide(async (email) => {
      for (let attempt = 0; attempt < 80; attempt += 1) {
        const response = await request.get(`${mailpitUrl}/api/v1/messages`)
        if (!response.ok()) throw new Error(`Mailpit request failed with ${response.status()}.`)
        const inbox = await response.json() as { messages?: MailpitMessage[] }
        const message = inbox.messages?.find((candidate) =>
          candidate.Subject === "Confirm your Reservevia email" && candidate.To?.some((recipient) => recipient.Address?.toLowerCase() === email.toLowerCase()),
        )
        if (message) {
          const detailsResponse = await request.get(`${mailpitUrl}/api/v1/message/${(message as MailpitMessage & { ID?: string }).ID}`)
          const details = await detailsResponse.json() as MailpitMessage
          const match = details.HTML?.match(/href="([^"]*\/auth\/confirm[^"]*)"/)
          if (!match) throw new Error("Confirmation email did not contain the Reservevia confirmation URL.")
          return match[1].replaceAll("&amp;", "&")
        }
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      throw new Error(`Mailpit did not receive a confirmation email for ${email}.`)
    })
  },
})

export { expect, cleanupScenarioUser, cleanupScenarioUserByEmail }

export async function completeGuestReservation(page: Page, email: string, name = "Browser Guest", options: { duplicateSubmit?: boolean } = {}) {
  await page.getByRole("button", { name: /continue|devam/i }).click()
  await page.getByRole("button", { name: /add contact|iletişim bilgisi/i }).click()
  await page.getByLabel(/full name|ad soyad/i).fill(name)
  await page.getByLabel(/phone|telefon/i).fill("+15550102026")
  await page.getByLabel(/email/i).fill(email)
  await page.getByRole("button", { name: /guest age|misafir yaşı/i }).click()
  await page.getByLabel(/minimum age|minimum guest age|minimum misafir yaşı/i).selectOption("25")
  await page.getByLabel(/maximum age|maximum guest age|maximum misafir yaşı/i).selectOption("30")
  const ageDialog = page.getByRole("dialog", { name: /guest age|misafir yaşı/i })
  await ageDialog.getByRole("button", { name: /^set$|^uygula$|^done$|^tamam$/i }).click()
  await expect(ageDialog).toBeHidden()
  const confirmButton = page.getByRole("button", { name: /confirm reservation|rezervasyonu onayla/i })
  if (options.duplicateSubmit) {
    await confirmButton.evaluate((element) => {
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
      element.dispatchEvent(new MouseEvent("click", { bubbles: true }))
    })
  } else {
    await confirmButton.click()
  }
}
