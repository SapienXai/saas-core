import type { Metadata } from "next"
import Link from "next/link"
import { MarketingLayout } from "@/components/marketing/marketing-layout"
import { requireMarketingHost } from "@/lib/marketing/host"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage()
  return {
    title: translateServer(language, "public.termsPage.metaTitle"),
    description: translateServer(language, "public.termsPage.metaDescription"),
    robots: { index: false, follow: true },
  }
}

export default async function TermsPage() {
  await requireMarketingHost()
  const language = await getServerLanguage()
  const t = (key: Parameters<typeof translateServer>[1]) => translateServer(language, key)
  return (
    <MarketingLayout>
      <main className="marketing-legal-page">
        <div className="marketing-container marketing-legal-card">
          <p className="marketing-eyebrow">Reservevia</p>
          <h1>{t("public.termsPage.title")}</h1>
          <p className="marketing-legal-intro">{t("public.termsPage.intro")}</p>
          <p className="marketing-legal-updated">{t("public.termsPage.updated")}</p>
          <div className="marketing-legal-content">
            <section><h2>{t("public.termsPage.usingTitle")}</h2><p>{t("public.termsPage.usingBody")}</p></section>
            <section><h2>{t("public.termsPage.accountsTitle")}</h2><p>{t("public.termsPage.accountsBody")}</p></section>
            <section><h2>{t("public.termsPage.reservationsTitle")}</h2><p>{t("public.termsPage.reservationsBody")}</p></section>
            <section><h2>{t("public.termsPage.plansTitle")}</h2><p>{t("public.termsPage.plansBody")}</p></section>
            <section><h2>{t("public.termsPage.responsibleTitle")}</h2><p>{t("public.termsPage.responsibleBody")}</p></section>
            <section><h2>{t("public.termsPage.contactTitle")}</h2><p>{t("public.termsPage.contactBody")} <a href="mailto:support@reservevia.com">support@reservevia.com</a>. {t("public.termsPage.contactNote")}</p></section>
          </div>
          <Link href="/" className="marketing-text-link">{t("public.termsPage.back")} <span aria-hidden="true">→</span></Link>
        </div>
      </main>
    </MarketingLayout>
  )
}
