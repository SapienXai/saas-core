import { describe, expect, it } from "vitest"
import { resolveAcceptLanguage } from "./config"

describe("resolveAcceptLanguage", () => {
  it("matches regional browser languages", () => {
    expect(resolveAcceptLanguage("tr-TR,tr;q=0.9,en;q=0.8")).toBe("tr")
    expect(resolveAcceptLanguage("es-ES,es;q=0.9")).toBe("es")
  })

  it("respects quality weights and ignores unsupported languages", () => {
    expect(resolveAcceptLanguage("de-DE,de;q=0.9,en;q=0.8,tr;q=0.7")).toBe("en")
    expect(resolveAcceptLanguage("de-DE,de;q=0.9,tr;q=0.8")).toBe("tr")
    expect(resolveAcceptLanguage("tr;q=0,en;q=0.5")).toBe("en")
  })

  it("falls back to English when no supported language is present", () => {
    expect(resolveAcceptLanguage("fr-FR,fr;q=0.9")).toBe("en")
    expect(resolveAcceptLanguage(null)).toBe("en")
  })
})
