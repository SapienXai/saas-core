import type { Metadata } from "next"
import Link from "next/link"
import { MarketingLayout } from "@/components/marketing/marketing-layout"
import { requireMarketingHost } from "@/lib/marketing/host"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage()
  return {
    title: translateServer(language, "public.privacyPage.metaTitle"),
    description: translateServer(language, "public.privacyPage.metaDescription"),
    robots: { index: false, follow: true },
  }
}

export default async function PrivacyPage() {
  await requireMarketingHost()
  const language = await getServerLanguage()
  const t = (key: Parameters<typeof translateServer>[1]) => translateServer(language, key)
  return (
    <MarketingLayout>
      <main className="marketing-legal-page">
        <div className="marketing-container marketing-legal-card">
          <p className="marketing-eyebrow">Reservevia</p>
          <h1>{t("public.privacyPage.title")}</h1>
          <p className="marketing-legal-intro">{t("public.privacyPage.intro")}</p>
          <p className="marketing-legal-updated">{t("public.privacyPage.updated")}</p>
          <div className="marketing-legal-content">
            <section><h2>{t("public.privacyPage.informationTitle")}</h2><p>{t("public.privacyPage.informationBody")}</p></section>
            <section><h2>{t("public.privacyPage.useTitle")}</h2><p>{t("public.privacyPage.useBody")}</p></section>
            <section><h2>{t("public.privacyPage.restaurantTitle")}</h2><p>{t("public.privacyPage.restaurantBody")}</p></section>
            <section><h2>{t("public.privacyPage.providersTitle")}</h2><p>{t("public.privacyPage.providersBody")}</p></section>
            <section><h2>{t("public.privacyPage.retentionTitle")}</h2><p>{t("public.privacyPage.retentionBody")}</p></section>
            <section><h2>{t("public.privacyPage.contactTitle")}</h2><p>{t("public.privacyPage.contactBody")} <a href="mailto:support@reservevia.com">support@reservevia.com</a>. {t("public.privacyPage.draftNote")}</p></section>
          </div>
          <Link href="/" className="marketing-text-link">{t("public.privacyPage.back")} <span aria-hidden="true">→</span></Link>
        </div>
      </main>
    </MarketingLayout>
  )
}
