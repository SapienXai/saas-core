import { describe, expect, it } from "vitest"
import { readFileSync } from "node:fs"
import { localeConfig, resolveLanguage, type SupportedLanguage } from "@/i18n/config"
import { emailMessages } from "@/i18n/email-messages"
import { localeMessages } from "@/i18n/messages"
import { privacyMessages } from "@/i18n/privacy-messages"
import { formatNumber } from "@/i18n/format"
import { translateMessage } from "@/i18n/translate"

function leafPaths(value: unknown, prefix = ""): string[] {
  if (typeof value === "string") return [prefix]
  if (typeof value !== "object" || value === null) return []
  return Object.entries(value).flatMap(([key, child]) => leafPaths(child, prefix ? `${prefix}.${key}` : key))
}

function getValue(source: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, segment) => (
    typeof current === "object" && current !== null ? (current as Record<string, unknown>)[segment] : undefined
  ), source)
}

function placeholders(value: unknown) {
  return typeof value === "string" ? [...value.matchAll(/{([^}]+)}/g)].map((match) => match[1]).sort() : []
}

describe("translations", () => {
  it("registers every configured locale", () => {
    expect(Object.keys(localeMessages).sort()).toEqual(Object.keys(localeConfig).sort())
    expect(Object.keys(emailMessages).sort()).toEqual(Object.keys(localeConfig).sort())
    expect(Object.keys(privacyMessages).sort()).toEqual(Object.keys(localeConfig).sort())
  })

  it.each(Object.keys(localeConfig) as SupportedLanguage[])("keeps %s keys and placeholders in parity", (language) => {
    const englishKeys = new Set(leafPaths(localeMessages.en))
    const localizedKeys = new Set(leafPaths(localeMessages[language]))

    expect([...englishKeys].filter((key) => !localizedKeys.has(key))).toEqual([])
    expect([...localizedKeys].filter((key) => !englishKeys.has(key))).toEqual([])

    for (const key of englishKeys) {
      expect(placeholders(getValue(localeMessages[language], key))).toEqual(placeholders(getValue(localeMessages.en, key)))
    }
  })

  it("does not leave empty localized values", () => {
    for (const language of Object.keys(localeConfig) as SupportedLanguage[]) {
      expect(leafPaths(localeMessages[language]).every((key) => {
        const value = getValue(localeMessages[language], key)
        return typeof value === "string" && value.trim().length > 0
      })).toBe(true)
    }
  })

  it("keeps Spanish translated instead of silently mirroring English", () => {
    for (const key of ["auth.headline", "auth.signInDescription", "manage.common.management", "manage.planUsage.usagePeriod"]) {
      const english = getValue(localeMessages.en, key)
      const spanish = getValue(localeMessages.es, key)
      expect(typeof english).toBe("string")
      expect(spanish, key).not.toBe(english)
    }
  })

  it("resolves Spanish regional tags and formats values with the Spanish locale", () => {
    expect(resolveLanguage("es-MX")).toBe("es")
    expect(formatNumber(1234.5, "es")).toBe("1234,5")
  })

  it("translates dynamic action messages and guest validation messages", () => {
    expect(translateMessage("es", "Workspace created successfully. The public address was already in use, so we used “nuevo-workspace”."))
      .toContain("nuevo-workspace")
    expect(translateMessage("es", "Paddle sandbox price mapping is not configured for Scale."))
      .toContain("no está configurada")
    expect(translateMessage("es", "Please enter a valid email address.")).toBe("Introduce una dirección de correo electrónico válida.")
  })

  it("keeps email locale placeholders in parity", () => {
    const englishKeys = new Set(leafPaths(emailMessages.en))
    for (const language of Object.keys(localeConfig) as SupportedLanguage[]) {
      const localizedKeys = new Set(leafPaths(emailMessages[language]))
      expect([...englishKeys].filter((key) => !localizedKeys.has(key))).toEqual([])
      expect([...localizedKeys].filter((key) => !englishKeys.has(key))).toEqual([])

      for (const key of englishKeys) {
        expect(placeholders(getValue(emailMessages[language], key))).toEqual(placeholders(getValue(emailMessages.en, key)))
      }
    }
  })

  it("keeps privacy locale structures in parity", () => {
    const englishKeys = new Set(leafPaths(privacyMessages.en))
    for (const language of Object.keys(localeConfig) as SupportedLanguage[]) {
      const localizedKeys = new Set(leafPaths(privacyMessages[language]))
      expect([...englishKeys].filter((key) => !localizedKeys.has(key))).toEqual([])
      expect([...localizedKeys].filter((key) => !englishKeys.has(key))).toEqual([])
    }
  })

  it("protects the active user-facing paths from language branching regressions", () => {
    const protectedFiles = [
      "../lib/email-template.ts",
      "../lib/invitation-email.ts",
      "../lib/privacy-notice.ts",
      "../app/invite/accept/actions.ts",
      "../app/manage/team/actions.ts",
      "../components/manage/paddle-billing-actions.tsx",
    ]

    for (const file of protectedFiles) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8")
      expect(source).not.toMatch(/(?:lang|language|isEnglish|isTurkish)\s*===?\s*["']tr["']/)
    }
  })
})
