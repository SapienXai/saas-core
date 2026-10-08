import { getLocaleConfig, type SupportedLanguage } from "@/i18n/config"
import { getLocaleMessages, type TranslationKey } from "@/i18n/messages"
import type { TranslationReplacements } from "@/i18n/types"

let englishMessageKeys: Map<string, TranslationKey> | null = null

function getEnglishMessageKeys() {
  if (englishMessageKeys) return englishMessageKeys
  const keys = new Map<string, TranslationKey>()
  const visit = (value: unknown, path: string[]) => {
    if (typeof value === "string") {
      keys.set(value, path.join(".") as TranslationKey)
      return
    }
    if (!value || typeof value !== "object") return
    for (const [segment, child] of Object.entries(value)) visit(child, [...path, segment])
  }
  visit(getLocaleMessages("en"), [])
  englishMessageKeys = keys
  return keys
}

function getNestedValue(source: unknown, path: string[]) {
  let current: unknown = source
  for (const segment of path) {
    if (typeof current !== "object" || current === null || !(segment in current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function interpolate(template: string, replacements: TranslationReplacements) {
  const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

  return Object.entries(replacements).reduce(
    (result, [placeholder, value]) => result.replace(new RegExp(`{${escapeRegExp(placeholder)}}`, "g"), String(value)),
    template,
  )
}

export function translate(
  language: SupportedLanguage,
  key: TranslationKey,
  replacements: TranslationReplacements = {},
  options: { warnMissing?: boolean } = {},
) {
  const languageMessages = getLocaleMessages(language)
  const fallbackMessages = getLocaleMessages(getLocaleConfig(language).fallback)
  const localized = getNestedValue(languageMessages, key.split("."))
  const fallback = getNestedValue(fallbackMessages, key.split("."))
  const value = typeof localized === "string" ? localized : typeof fallback === "string" ? fallback : key

  if (options.warnMissing && typeof localized !== "string" && process.env.NODE_ENV !== "production") {
    console.warn(`[i18n] Missing translation: ${language}.${key}`)
  }

  return interpolate(value, replacements)
}

export function getIntlLocale(language: SupportedLanguage) {
  return getLocaleConfig(language).intl
}

/** Translate an English action/error message when it matches a catalog string. */
export function translateMessage(
  language: SupportedLanguage,
  message: string,
  replacements: TranslationReplacements = {},
) {
  const keys = getEnglishMessageKeys()
  const key = keys.get(message) || (message.endsWith(".") ? keys.get(message.slice(0, -1)) : keys.get(`${message}.`))
  if (key) return translate(language, key, replacements)

  const adjustedSlug = message.match(/^Workspace created successfully\. The public address was already in use, so we used “(.+)”\.$/)
  if (adjustedSlug) {
    return translate(language, "manage.common.workspaceCreatedWithAdjustedSlug", { slug: adjustedSlug[1] })
  }

  const priceMapping = message.match(/^(?:The )?(sandbox|live) price mapping is not configured for (.+)\.$/)
  if (priceMapping) {
    return translate(language, "manage.planUsage.billing.priceMappingMissing", { environment: priceMapping[1], plan: priceMapping[2] })
  }

  return message
}
