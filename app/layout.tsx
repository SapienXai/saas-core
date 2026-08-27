import type React from "react"
import type { Metadata } from "next"
import Script from "next/script"
import { Suspense } from "react"
import { Inter } from "next/font/google"
import "./globals.css"
import "../styles/globals.css"
import "../styles/reservevia-lilac.css"
import "../styles/marketing.css"
import "../styles/marketing-lilac.css"
import "../styles/marketing-how-it-works.css"
import "../styles/marketing-footer.css"
import "../styles/marketing-pricing.css"
import "../styles/consumer-states.css"
import "maplibre-gl/dist/maplibre-gl.css"
import "../styles/public-brand-booking.css"
import { ThemeProvider } from "@/components/theme-provider"
import { DevelopmentServiceWorkerCleanup } from "@/components/development-service-worker-cleanup"
import { LanguageProvider } from "@/context/language-context"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { NavigationFeedback } from "@/components/navigation-feedback"
import { MarketingAnalyticsBridge } from "@/components/marketing/marketing-analytics-bridge"
import { RESERVEVIA_APPLE_TOUCH_ICON, RESERVEVIA_FAVICON, RESERVEVIA_LOGO_DARK, RESERVEVIA_LOGO_LIGHT, RESERVEVIA_OG_HERO } from "@/lib/brand-assets"
import { getLocaleConfig } from "@/i18n"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"

const inter = Inter({ subsets: ["latin"] })

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage()
  const title = translateServer(language, "marketing.metaTitle")
  const description = translateServer(language, "marketing.metaDescription")
  const socialDescription = translateServer(language, "marketing.metaOgDescription")
  const imageAlt = translateServer(language, "marketing.metaImageAlt")
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || (process.env.NODE_ENV === "production" ? "https://reservevia.com" : "http://localhost:3000")
  return {
    title,
    description,
    keywords: translateServer(language, "marketing.metaKeywords"),
    authors: [{ name: "Reservevia" }],
    creator: "Reservevia",
    publisher: "Reservevia",
    formatDetection: { email: false, address: false, telephone: false },
    metadataBase: new URL(siteUrl),
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description: socialDescription,
      url: siteUrl,
      siteName: "Reservevia",
      images: [{ url: RESERVEVIA_OG_HERO, width: 1200, height: 630, alt: imageAlt }],
      locale: getLocaleConfig(language).intl.replace("-", "_"),
      type: "website",
    },
    twitter: { card: "summary_large_image", title, description: socialDescription, images: [RESERVEVIA_OG_HERO] },
    icons: {
      icon: [
        { url: RESERVEVIA_FAVICON },
        { url: RESERVEVIA_LOGO_LIGHT, type: "image/png", media: "(prefers-color-scheme: light)" },
        { url: RESERVEVIA_LOGO_DARK, type: "image/png", media: "(prefers-color-scheme: dark)" },
      ],
      apple: [{ url: RESERVEVIA_APPLE_TOUCH_ICON }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: "Reservevia",
    },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-video-preview": -1, "max-image-preview": "large", "max-snippet": -1 } },
    generator: "Next.js",
  }
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const language = await getServerLanguage()
  return (
    <html lang={getLocaleConfig(language).intl} dir={getLocaleConfig(language).direction} suppressHydrationWarning>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#000000" />
      </head>
      <body className={inter.className}>
        <Script id="reservevia-pwa-install-capture" strategy="beforeInteractive">
          {`window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault();
  window.__reserveviaBeforeInstallPrompt = event;
});`}
        </Script>
        <ThemeProvider attribute="class" defaultTheme="light" forcedTheme="light" enableSystem disableTransitionOnChange>
          <DevelopmentServiceWorkerCleanup />
          <MarketingAnalyticsBridge />
          <LanguageProvider initialLanguage={language}>{children}</LanguageProvider>
          <Suspense fallback={null}><NavigationFeedback /></Suspense>
          <Toaster />
          <SonnerToaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
