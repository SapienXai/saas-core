import { afterEach, describe, expect, it, vi } from "vitest"
import { GET } from "../app/api/dev/mailpit/[[...path]]/route"

const originalNodeEnv = process.env.NODE_ENV
const environment = process.env as Record<string, string | undefined>
const originalMailpitUrl = process.env.NEXT_PUBLIC_DEV_MAILPIT_URL
const originalCoreMailUrl = process.env.SAAS_CORE_MAIL_URL

afterEach(() => {
  environment.NODE_ENV = originalNodeEnv
  if (originalMailpitUrl === undefined) delete environment.NEXT_PUBLIC_DEV_MAILPIT_URL
  else environment.NEXT_PUBLIC_DEV_MAILPIT_URL = originalMailpitUrl
  if (originalCoreMailUrl === undefined) delete environment.SAAS_CORE_MAIL_URL
  else environment.SAAS_CORE_MAIL_URL = originalCoreMailUrl
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe("development Mailpit proxy", () => {
  it("rewrites the Mailpit base path and keeps its assets same-origin", async () => {
    environment.NODE_ENV = "test"
    environment.NEXT_PUBLIC_DEV_MAILPIT_URL = "http://localhost:55524"
    vi.stubGlobal("fetch", vi.fn(async () => new Response(
      '<head></head><link rel="stylesheet" href="/dist/app.css"><div id="app" data-webroot="/"><script src="/dist/app.js"></script>',
      { headers: { "content-type": "text/html; charset=utf-8" } },
    )))

    const response = await GET(
      new Request("https://example.ngrok-free.dev/api/dev/mailpit", { headers: { host: "example.ngrok-free.dev" } }),
      { params: Promise.resolve({}) },
    )
    const body = await response.text()

    expect(response.status).toBe(200)
    expect(body).toContain('data-webroot="/api/dev/mailpit/"')
    expect(body).toContain('href="/api/dev/mailpit/dist/app.css"')
    expect(body).toContain('src="/api/dev/mailpit/dist/app.js"')
    expect(body).toContain("window.WebSocket=class")
  })

  it("forwards nested API paths and query strings to local Mailpit", async () => {
    environment.NODE_ENV = "test"
    environment.NEXT_PUBLIC_DEV_MAILPIT_URL = "http://localhost:55524"
    const fetchMock = vi.fn(async () => new Response('{"total":0}', { headers: { "content-type": "application/json" } }))
    vi.stubGlobal("fetch", fetchMock)

    const response = await GET(
      new Request("https://example.ngrok-free.dev/api/dev/mailpit/api/v1/messages?limit=25", { headers: { host: "example.ngrok-free.dev" } }),
      { params: Promise.resolve({ path: ["api", "v1", "messages"] }) },
    )

    expect(response.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledWith(
      new URL("http://127.0.0.1:55524/api/v1/messages?limit=25"),
      expect.objectContaining({ method: "GET" }),
    )
  })

  it("does not expose the proxy in production or from an untrusted host", async () => {
    environment.NODE_ENV = "production"
    const production = await GET(
      new Request("https://example.ngrok-free.dev/api/dev/mailpit", { headers: { host: "example.ngrok-free.dev" } }),
      { params: Promise.resolve({}) },
    )
    expect(production.status).toBe(404)

    environment.NODE_ENV = "test"
    const untrusted = await GET(
      new Request("https://product.example.com/api/dev/mailpit", { headers: { host: "product.example.com" } }),
      { params: Promise.resolve({}) },
    )
    expect(untrusted.status).toBe(404)
  })
})
