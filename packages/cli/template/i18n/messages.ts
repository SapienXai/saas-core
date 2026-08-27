import { en } from "@/i18n/locales/en"
import { tr } from "@/i18n/locales/tr"
import { es } from "@/i18n/locales/es"
import type { LocaleMessages, StringLeafKeys } from "@/i18n/types"
import type { SupportedLanguage } from "@/i18n/config"

export const localeMessages = {
  en,
  tr,
  es,
} as const satisfies Record<SupportedLanguage, LocaleMessages<typeof en>>

export type TranslationKey = StringLeafKeys<typeof en>

export function getLocaleMessages(language: SupportedLanguage) {
  return localeMessages[language]
}

const localeParityCheck: LocaleMessages<typeof en> = tr
const spanishLocaleParityCheck: LocaleMessages<typeof en> = es
void localeParityCheck
void spanishLocaleParityCheck
