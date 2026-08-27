import type { SupportedLanguage } from "@/i18n/config"
import { getIntlLocale } from "@/i18n/translate"

export function formatNumber(value: number, language: SupportedLanguage, options?: Intl.NumberFormatOptions) {
  return new Intl.NumberFormat(getIntlLocale(language), options).format(value)
}

export function formatCurrency(value: number, language: SupportedLanguage, currency = "USD") {
  return formatNumber(value, language, { style: "currency", currency })
}

export function formatDate(value: Date | string | number, language: SupportedLanguage, options?: Intl.DateTimeFormatOptions) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value)
  if (Number.isNaN(date.getTime())) return ""
  return new Intl.DateTimeFormat(getIntlLocale(language), options).format(date)
}

export function formatTime(value: Date | string | number, language: SupportedLanguage, options?: Intl.DateTimeFormatOptions) {
  return formatDate(value, language, { hour: "2-digit", minute: "2-digit", ...options })
}
