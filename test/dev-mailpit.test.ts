import { afterEach, describe, expect, it } from "vitest"
import { getDevMailpitUrl } from "../lib/dev-mailpit"

const originalNodeEnv = process.env.NODE_ENV
const originalMailpit = process.env.NEXT_PUBLIC_DEV_MAILPIT_URL
const environment = process.env as Record<string, string | undefined>

afterEach(() => {
  environment.NODE_ENV = originalNodeEnv
  if (originalMailpit === undefined) delete process.env.NEXT_PUBLIC_DEV_MAILPIT_URL
  else process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = originalMailpit
})

describe("development Mailpit boundary", () => {
  it("returns a local inbox only for local development hosts", () => {
    environment.NODE_ENV = "test"
    delete process.env.NEXT_PUBLIC_DEV_MAILPIT_URL
    expect(getDevMailpitUrl("localhost")).toBe("http://localhost:55624")
    expect(getDevMailpitUrl("product.example.com")).toBeNull()
  })

  it("never exposes the development inbox in production", () => {
    environment.NODE_ENV = "production"
    process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = "http://localhost:55624"
    expect(getDevMailpitUrl("localhost")).toBeNull()
  })

  it("accepts an explicitly configured development inbox without exposing credentials", () => {
    environment.NODE_ENV = "test"
    process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = "https://mail.example.test/inbox/"
    expect(getDevMailpitUrl("product.example.com")).toBe("https://mail.example.test/inbox")
  })
})
