import { afterEach, describe, expect, it } from "vitest"
import { DEV_MAILPIT_PROXY_PATH, getDevMailpitUrl } from "../lib/dev-mailpit"

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
    expect(getDevMailpitUrl("192.168.1.108")).toBe("http://192.168.1.108.nip.io:55624")
    expect(getDevMailpitUrl("192.168.1.108.nip.io")).toBe("http://192.168.1.108.nip.io:55624")
    expect(getDevMailpitUrl("127.0.0.1.nip.io")).toBe("http://127.0.0.1.nip.io:55624")
    expect(getDevMailpitUrl("10.0.0.8")).toBe("http://10.0.0.8.nip.io:55624")
    expect(getDevMailpitUrl("172.16.0.8.nip.io")).toBe("http://172.16.0.8.nip.io:55624")
    expect(getDevMailpitUrl("product.example.com")).toBeNull()
  })

  it("uses the app-origin proxy for an Ngrok development host", () => {
    environment.NODE_ENV = "test"
    delete process.env.NEXT_PUBLIC_DEV_MAILPIT_URL
    expect(getDevMailpitUrl("congenial-limes-badland.ngrok-free.dev")).toBe(DEV_MAILPIT_PROXY_PATH)

    process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = "http://localhost:55524"
    expect(getDevMailpitUrl("congenial-limes-badland.ngrok-free.dev")).toBe(DEV_MAILPIT_PROXY_PATH)
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

  it("moves a loopback override to the current private host", () => {
    environment.NODE_ENV = "test"
    process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = "http://localhost:55624"
    expect(getDevMailpitUrl("192.168.1.108")).toBe("http://192.168.1.108.nip.io:55624")
  })

  it("recognizes a nip.io host and preserves a consumer-specific port", () => {
    environment.NODE_ENV = "test"
    process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = "http://localhost:55524"
    expect(getDevMailpitUrl("192.168.1.108.nip.io")).toBe("http://192.168.1.108.nip.io:55524")
  })

  it("preserves a consumer-specific Mailpit port when moving a loopback override", () => {
    environment.NODE_ENV = "test"
    process.env.NEXT_PUBLIC_DEV_MAILPIT_URL = "http://localhost:55524"
    expect(getDevMailpitUrl("192.168.1.108")).toBe("http://192.168.1.108.nip.io:55524")
  })
})
