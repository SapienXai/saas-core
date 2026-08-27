import "server-only"

import { cookies, headers } from "next/headers"
import { isSupportedLanguage, resolveAcceptLanguage, resolveLanguage, translate, translateMessage as translateEnglishMessage, type SupportedLanguage, type TranslationKey, type TranslationReplacements } from "@/i18n"

function getRecognizedLanguage(value: string | null | undefined): SupportedLanguage | null {
  if (!value) return null
  const baseLanguage = value.split(/[-_]/)[0]
  return isSupportedLanguage(baseLanguage) ? resolveLanguage(value) : null
}

export async function getServerLanguage(preferred?: string | null): Promise<SupportedLanguage> {
  const preferredLanguage = getRecognizedLanguage(preferred)
  if (preferredLanguage) return preferredLanguage
  const cookieLanguage = (await cookies()).get("lang")?.value
  const savedLanguage = getRecognizedLanguage(cookieLanguage)
  if (savedLanguage) return savedLanguage

  const browserLanguage = (await headers()).get("accept-language")
  return resolveAcceptLanguage(browserLanguage)
}

export function translateServer(language: SupportedLanguage, key: TranslationKey, replacements: TranslationReplacements = {}) {
  return translate(language, key, replacements)
}

export function translateServerMessage(language: SupportedLanguage, message: string, replacements: TranslationReplacements = {}) {
  return translateEnglishMessage(language, message, replacements)
}
