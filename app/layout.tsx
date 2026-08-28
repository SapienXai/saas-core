import type React from "react"
import type { Metadata } from "next"
import Script from "next/script"
import { Suspense } from "react"
import "./globals.css"
import "../styles/globals.css"
import "../styles/core-lilac.css"
import { ThemeProvider } from "@/components/theme-provider"
import { DevelopmentServiceWorkerCleanup } from "@/components/development-service-worker-cleanup"
import { LanguageProvider } from "@/context/language-context"
import { Toaster } from "@/components/ui/toaster"
import { Toaster as SonnerToaster } from "@/components/ui/sonner"
import { NavigationFeedback } from "@/components/navigation-feedback"
import { getLocaleConfig } from "@/i18n"
import { getServerLanguage } from "@/lib/server-i18n"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export async function generateMetadata(): Promise<Metadata> {
  const language = await getServerLanguage()
  const title = PRODUCT_CONFIG.name
  const description = PRODUCT_CONFIG.description
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000"
  return {
    title,
    description,
    authors: [{ name: PRODUCT_CONFIG.name }],
    creator: PRODUCT_CONFIG.name,
    publisher: PRODUCT_CONFIG.name,
    formatDetection: { email: false, address: false, telephone: false },
    metadataBase: new URL(siteUrl),
    alternates: { canonical: "/" },
    openGraph: {
      title,
      description,
      url: siteUrl,
      siteName: PRODUCT_CONFIG.name,
      images: [{ url: PRODUCT_CONFIG.iconPath, width: 512, height: 512, alt: PRODUCT_CONFIG.name }],
      locale: getLocaleConfig(language).intl.replace("-", "_"),
      type: "website",
    },
    twitter: { card: "summary", title, description, images: [PRODUCT_CONFIG.iconPath] },
    icons: {
      icon: [{ url: PRODUCT_CONFIG.iconPath, type: "image/svg+xml" }],
      apple: [{ url: PRODUCT_CONFIG.iconPath }],
    },
    appleWebApp: {
      capable: true,
      statusBarStyle: "default",
      title: PRODUCT_CONFIG.name,
    },
    robots: { index: true, follow: true, googleBot: { index: true, follow: true, "max-video-preview": -1, "max-image-preview": "large", "max-snippet": -1 } },
    generator: "SaaS Core 2.0",
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
        <meta name="theme-color" content="#090b11" />
      </head>
      <body className="font-sans">
        <Script id="product-pwa-install-capture" strategy="beforeInteractive">
          {`window.addEventListener("beforeinstallprompt", function (event) {
  event.preventDefault();
  window.__productBeforeInstallPrompt = event;
});`}
        </Script>
        <ThemeProvider attribute="class" defaultTheme="light" enableSystem disableTransitionOnChange>
          <DevelopmentServiceWorkerCleanup />
          <LanguageProvider initialLanguage={language}>{children}</LanguageProvider>
          <Suspense fallback={null}><NavigationFeedback /></Suspense>
          <Toaster />
          <SonnerToaster />
        </ThemeProvider>
      </body>
    </html>
  )
}
