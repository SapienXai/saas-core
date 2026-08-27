export const localeConfig = {
  en: {
    label: "English",
    nativeLabel: "English",
    flag: "🇬🇧",
    intl: "en-US",
    direction: "ltr",
    fallback: "en",
  },
  tr: {
    label: "Turkish",
    nativeLabel: "Türkçe",
    flag: "🇹🇷",
    intl: "tr-TR",
    direction: "ltr",
    fallback: "en",
  },
  es: {
    label: "Spanish",
    nativeLabel: "Español",
    flag: "🇪🇸",
    intl: "es-ES",
    direction: "ltr",
    fallback: "en",
  },
} as const

export type SupportedLanguage = keyof typeof localeConfig

export const DEFAULT_LANGUAGE: SupportedLanguage = "en"

export function isSupportedLanguage(value: unknown): value is SupportedLanguage {
  return typeof value === "string" && value in localeConfig
}

export function resolveLanguage(value: unknown, fallback: SupportedLanguage = DEFAULT_LANGUAGE): SupportedLanguage {
  if (isSupportedLanguage(value)) return value
  if (typeof value === "string") {
    const baseLanguage = value.split(/[-_]/)[0]
    if (isSupportedLanguage(baseLanguage)) return baseLanguage
  }
  return fallback
}

/**
 * Resolve the first supported language from an HTTP Accept-Language header.
 * Browser language preferences can include regional variants and quality
 * weights, for example: "tr-TR,tr;q=0.9,en;q=0.8".
 */
export function resolveAcceptLanguage(value: unknown, fallback: SupportedLanguage = DEFAULT_LANGUAGE): SupportedLanguage {
  if (typeof value !== "string" || !value.trim()) return fallback

  const preferences = value
    .split(",")
    .map((part, index) => {
      const [rawRange, ...parameters] = part.trim().split(";")
      const qualityParameter = parameters.find((parameter) => parameter.trim().toLowerCase().startsWith("q="))
      const parsedQuality = qualityParameter ? Number(qualityParameter.trim().slice(2)) : 1
      const quality = Number.isFinite(parsedQuality) ? Math.min(1, Math.max(0, parsedQuality)) : 0

      return { range: rawRange.trim(), quality, index }
    })
    .filter((preference) => preference.range && preference.quality > 0)
    .sort((a, b) => b.quality - a.quality || a.index - b.index)

  for (const preference of preferences) {
    const baseLanguage = preference.range.split(/[-_]/)[0].toLowerCase()
    if (isSupportedLanguage(baseLanguage)) return baseLanguage
  }

  return fallback
}

export function getLocaleConfig(language: SupportedLanguage) {
  return localeConfig[language]
}
