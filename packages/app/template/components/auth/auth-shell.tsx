"use client"

import Image from "next/image"
import Link from "next/link"
import type { CSSProperties, ReactNode } from "react"
import { ArrowLeft } from "lucide-react"
import { PRODUCT_CONFIG } from "@/lib/product-config"
import { useLanguage } from "@/context/language-context"

type AuthShellProps = {
  title: string
  description: string
  children: ReactNode
  footer?: ReactNode
  backHref?: string
  showBrand?: boolean
}

function getAuthBackgroundUrl() {
  const candidate = PRODUCT_CONFIG.auth?.backgroundUrl?.trim()
  if (!candidate) return null

  try {
    const url = new URL(candidate)
    return url.protocol === "https:" ? url.href : null
  } catch {
    return null
  }
}

function AuthMediaBackground() {
  const src = getAuthBackgroundUrl()
  if (!src) return null

  return (
    <div className="auth-media-background" aria-hidden="true">
      <iframe
        className="auth-media-background-frame"
        src={src}
        title=""
        tabIndex={-1}
        loading="eager"
        referrerPolicy="no-referrer"
        allow="autoplay; fullscreen; picture-in-picture"
      />
      <span className="auth-media-background-cinematic" />
      <span className="auth-media-background-scanlines" />
      <span className="auth-media-background-grain" />
      <span className="auth-media-background-vignette" />
      <span className="auth-media-background-sweep" />
    </div>
  )
}

export function AuthDivider() {
  const { getTranslation } = useLanguage()

  return (
    <div className="auth-divider" aria-hidden="true">
      <span />
      <span>{getTranslation("auth.divider")}</span>
      <span />
    </div>
  )
}

export function ProductBrand() {
  const { getTranslation } = useLanguage()

  return (
    <Link href="/" aria-label={getTranslation("auth.homeLabel")} className="auth-brand">
      <span className="auth-brand-mark">
        <Image src={PRODUCT_CONFIG.logoPath} alt="" width={34} height={34} priority />
      </span>
      <span className="auth-brand-name">{PRODUCT_CONFIG.name}</span>
    </Link>
  )
}

function AuthFormBrand() {
  const logoStyle = { "--auth-form-brand-url": `url("${PRODUCT_CONFIG.logoPath}")` } as CSSProperties

  return (
    <Link href="/" aria-label={`${PRODUCT_CONFIG.name} home`} className="auth-form-brand" style={logoStyle}>
      <span className="auth-form-brand-mark" aria-hidden="true" />
    </Link>
  )
}

export function AuthBackButton({ href = "/" }: { href?: string }) {
  const { getTranslation } = useLanguage()

  return (
    <Link href={href} className="auth-back-button" aria-label={getTranslation("auth.backToWelcome")}>
      <ArrowLeft aria-hidden="true" strokeWidth={1.8} />
    </Link>
  )
}

export function AuthField({
  id,
  label,
  children,
}: {
  id: string
  label: string
  children: ReactNode
}) {
  return (
    <div className="auth-field">
      <label className="auth-field-label" htmlFor={id}>{label}</label>
      {children}
    </div>
  )
}

export function AuthShell({ title, description, children, footer, backHref = "/", showBrand = false }: AuthShellProps) {
  return (
    <main className="auth-page auth-form-page">
      <AuthMediaBackground />
      <div className="auth-form-container">
        <div className="auth-form-topline">
          <AuthBackButton href={backHref} />
          <header className="auth-form-heading">
            <h1 id="auth-title">{title}</h1>
            <p>{description}</p>
          </header>
        </div>
        <section className="auth-card auth-form-card" aria-labelledby="auth-title">
          <div className="auth-form-content">
            {showBrand && <AuthFormBrand />}
            {children}
          </div>
          {footer && <div className="auth-form-footer">{footer}</div>}
        </section>
      </div>
    </main>
  )
}
