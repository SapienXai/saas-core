import { afterEach, describe, expect, it, vi } from "vitest"
import { sendEmail } from "../lib/email-service"

const originalApiKey = process.env.RESEND_API_KEY
const originalMailpitUrl = process.env.NEXT_PUBLIC_DEV_MAILPIT_URL
const originalMailpitPort = process.env.SAAS_CORE_MAILPIT_PORT
const originalFetch = globalThis.fetch

afterEach(() => {
  if (originalApiKey === undefined) delete process.env.RESEND_API_KEY
  else process.env.RESEND_API_KEY = originalApiKey
  if (originalMailpitUrl === undefined) delete process.env.NEXT_PUBLIC_DEV_MAILPIT_URL
  else process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = originalMailpitUrl
  if (originalMailpitPort === undefined) delete process.env.SAAS_CORE_MAILPIT_PORT
  else process.env.SAAS_CORE_MAILPIT_PORT = originalMailpitPort
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

describe("development email delivery", () => {
  it("sends through the local Mailpit API when Resend is not configured", async () => {
    delete process.env.RESEND_API_KEY
    process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = "http://localhost:55524"
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ID: "mailpit-message" }), { status: 200, headers: { "content-type": "application/json" } }))
    globalThis.fetch = fetchMock as typeof fetch

    const result = await sendEmail({
      to: "member@example.com",
      from: "PlaceDJ <noreply@example.com>",
      replyTo: "support@example.com",
      subject: "Workspace invite",
      text: "Join the workspace.",
      html: "<p>Join the workspace.</p>",
    })

    expect(result).toMatchObject({ success: true, devMailpit: true })
    expect(fetchMock).toHaveBeenCalledWith("http://localhost:55524/api/v1/send", expect.objectContaining({ method: "POST" }))
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit
    expect(JSON.parse(String(request.body))).toMatchObject({
      From: { Email: "noreply@example.com", Name: "PlaceDJ" },
      To: [{ Email: "member@example.com" }],
      Subject: "Workspace invite",
      Text: "Join the workspace.",
      HTML: "<p>Join the workspace.</p>",
    })
  })
})
