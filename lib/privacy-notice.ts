import { getPrivacyMessages } from "@/i18n/privacy-messages"
import { interpolateEmail } from "@/i18n/email-messages"

export type PrivacyNoticeSection = {
  heading: string
  paragraphs?: string[]
  items?: string[]
}

export type PrivacyNoticeContent = {
  version: string
  locale: string
  country: string
  title: string
  introduction: string
  dataControllerLabel: string
  dataControllerName: string
  contactLabel: string
  contactEmail: string
  contactPhone: string
  contactAddress: string
  sections: PrivacyNoticeSection[]
  closeLabel: string
}

const DEFAULT_VERSION = "2026-08-04-v1"
const DEFAULT_COUNTRY = "Türkiye"
const DEFAULT_EMAIL = "support@reservevia.com"
const DEFAULT_PHONE = "+90 549 412 3888"
const DEFAULT_ADDRESS = "Çıldır Mahallesi, Muğla, Türkiye"

function getSetting(name: string, fallback: string) {
  return process.env[name]?.trim() || fallback
}

function getListSetting(name: string, fallback: readonly string[]) {
  const value = process.env[name]?.trim()
  if (!value) return [...fallback]
  return value.split(";").map((item) => item.trim()).filter(Boolean)
}

export function getPrivacyNoticeContent({
  restaurantPhone,
  language,
}: {
  restaurantPhone?: string | null
  language?: string | null
} = {}): PrivacyNoticeContent {
  const { locale, messages } = getPrivacyMessages(language)
  const dataControllerName = getSetting("PRIVACY_NOTICE_DATA_CONTROLLER_NAME", "Reservevia")
  const country = getSetting("PRIVACY_NOTICE_COUNTRY", DEFAULT_COUNTRY)
  const contactEmail = getSetting("PRIVACY_NOTICE_CONTACT_EMAIL", DEFAULT_EMAIL)
  const contactPhone = getSetting("PRIVACY_NOTICE_CONTACT_PHONE", restaurantPhone?.trim() || DEFAULT_PHONE)
  const contactAddress = getSetting("PRIVACY_NOTICE_CONTACT_ADDRESS", DEFAULT_ADDRESS)
  const retentionPeriod = getSetting("PRIVACY_NOTICE_RETENTION_PERIOD", messages.retentionPeriod)
  const recipients = getListSetting("PRIVACY_NOTICE_RECIPIENTS", messages.recipients)
  const sections = messages.sections.map((section, index) => ({
    heading: section.heading,
    ...(index === 0 ? { items: [...(section.items || [])] } : {}),
    ...(index === 1 ? { items: [...(section.items || [])] } : {}),
    ...(index === 2 ? { paragraphs: [...(section.paragraphs || [])] } : {}),
    ...(index === 3 ? { items: recipients } : {}),
    ...(index === 4 ? { paragraphs: [retentionPeriod] } : {}),
    ...(index === 5 ? {
      paragraphs: [
        messages.rightsParagraph,
        interpolateEmail(messages.rightsRequest, { email: contactEmail }),
      ],
    } : {}),
  }))

  return {
    version: getSetting("PRIVACY_NOTICE_VERSION", DEFAULT_VERSION),
    locale,
    country,
    title: messages.title,
    introduction: interpolateEmail(messages.introduction, { controller: dataControllerName, country }),
    dataControllerLabel: messages.dataControllerLabel,
    dataControllerName,
    contactLabel: messages.contactLabel,
    contactEmail,
    contactPhone,
    contactAddress,
    sections,
    closeLabel: messages.closeLabel,
  }
}
