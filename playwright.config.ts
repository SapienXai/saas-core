import { defineConfig, devices } from "@playwright/test"

const appUrl = process.env.RESERVEVIA_APP_URL || "http://127.0.0.1:3100"
const fullE2E = process.env.RESERVEVIA_FULL_E2E === "1"
const appPort = new URL(appUrl).port || "3000"
// Local Supabase and the shared Next dev server are intentionally serialized
// by default; callers can opt into more workers on stronger CI infrastructure.
const requestedWorkers = Number(process.env.RESERVEVIA_E2E_WORKERS || "1")
const workers = Number.isInteger(requestedWorkers) && requestedWorkers > 0 ? requestedWorkers : 1

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  workers,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: process.env.CI ? [["line"], ["html", { outputFolder: "output/playwright/html", open: "never" }]] : [["list"]],
  outputDir: "output/playwright/test-results",
  use: {
    baseURL: appUrl,
    locale: "en-US",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    ...devices["Desktop Chrome"],
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "mobile-chromium", use: { ...devices["Pixel 5"] }, grep: /@mobile/ },
    { name: "firefox", use: { ...devices["Desktop Firefox"] }, grep: fullE2E ? undefined : /@never-in-pr/ },
    { name: "webkit", use: { ...devices["Desktop Safari"] }, grep: fullE2E ? undefined : /@never-in-pr/ },
  ],
  webServer: [
    {
      command: `pnpm run dev:local -- --port ${appPort}`,
      url: appUrl,
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
})
