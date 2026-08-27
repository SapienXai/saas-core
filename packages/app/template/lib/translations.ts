// Backwards-compatible exports for components that still import the legacy path.
// Translation data lives in /i18n/locales and the registry is owned by /i18n.
export { en } from "@/i18n/locales/en"
export { tr } from "@/i18n/locales/tr"
export { es } from "@/i18n/locales/es"

import { localeMessages } from "@/i18n/messages"
import type { StringLeafKeys } from "@/i18n/types"

export const translations = localeMessages
export type SupportedLanguage = keyof typeof translations
export type TranslationKey = StringLeafKeys<typeof translations.en>
