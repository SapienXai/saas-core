"use client"

import Link from "next/link"
import { useLanguage } from "@/context/language-context"
import { ProductBrand } from "@/components/auth/auth-shell"

function AuthIllustration() {
  return (
    <div className="auth-illustration" aria-hidden="true">
      <svg viewBox="0 0 360 286" role="presentation" focusable="false">
        <g className="auth-illustration-soft" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <path d="M114 44c-6-13 4-27 18-27 5-13 25-16 34-3 13-6 28 4 28 18 13 1 20 10 20 20h-95" strokeWidth="1.4" />
          <path d="M164 52v18M153 70h22" strokeWidth="1.2" />
          <path d="M76 225h229" strokeWidth="1.2" />
          <path d="M87 225c5-18 10-29 18-38M97 212c-8-5-12-12-12-20M101 205c8-7 13-14 15-25" strokeWidth="1.25" />
          <path d="M71 225h35" strokeWidth="1.5" />
          <circle cx="52" cy="73" r="1.2" fill="currentColor" stroke="none" />
          <circle cx="294" cy="50" r="1.5" fill="currentColor" stroke="none" />
          <circle cx="289" cy="246" r="2.2" fill="currentColor" stroke="none" />
        </g>
        <g className="auth-illustration-line" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round">
          <rect x="80" y="77" width="176" height="107" rx="8" strokeWidth="1.7" />
          <path d="M80 95h176M91 86h1M99 86h1M107 86h1" strokeWidth="1.5" />
          <rect x="94" y="112" width="42" height="28" rx="3" strokeWidth="1.3" />
          <path d="m102 122 6 5-6 5M112 133h11M150 153l16-19 10 9 20-26M150 163h67M150 173h43" strokeWidth="1.5" />
          <path d="m215 116 3 1-1 4M157 153l-4 1 1 4" strokeWidth="1.1" />
          <path d="M151 122h16M151 131h9" strokeWidth="1.2" />
          <path d="m205 128 4 4 8-9M205 145l4 4 8-9M205 162l4 4 8-9" strokeWidth="1.1" />
          <path d="M170 184v17M166 201h9" strokeWidth="1.2" />
          <path d="M63 145c-3-11 3-23 15-25 8-1 15 3 19 10 9 0 15 6 15 15M80 132c5-10 16-14 25-9" strokeWidth="1.4" />
          <circle cx="80" cy="131" r="11" strokeWidth="1.5" />
          <path d="M67 157c6-9 20-12 31-5 9 6 14 18 17 33l8 32H92l-3-26-14 24M102 166l24 17 13-16M122 183l-14 21" strokeWidth="1.6" />
          <path d="m94 204 25 1 12 15H92Z" strokeWidth="1.4" />
          <path d="M75 205v20M108 205l-3 20M133 205l-6 20" strokeWidth="1.4" />
          <path d="M91 160c8-6 16-9 22-17l10 3-13 22" strokeWidth="1.4" />
          <circle cx="259" cy="127" r="13" strokeWidth="1.5" />
          <path d="M247 119c6-10 16-12 24-5M245 160c4-13 14-20 28-18 15 2 22 15 24 30l4 31h-62l2-27M259 174l-8-23M276 171l-4 27M246 159l-16 16M279 160l17 10" strokeWidth="1.6" />
          <path d="m230 175 32-3 8 29-32 3Z" strokeWidth="1.3" />
          <path d="M251 184h3" className="auth-illustration-accent" strokeWidth="2.3" />
          <path d="M250 201v24M274 198l6 27M240 225h42" strokeWidth="1.4" />
          <path d="M242 129c8 4 17 4 27 0" strokeWidth="1.1" />
          <path d="M89 151c4 6 9 8 15 9" className="auth-illustration-accent" strokeWidth="1.5" />
        </g>
        <g className="auth-illustration-accent" fill="currentColor">
          <circle cx="310" cy="72" r="7" />
          <circle cx="292" cy="244" r="4" />
          <circle cx="207" cy="255" r="3.5" />
          <circle cx="52" cy="73" r="2" />
        </g>
      </svg>
    </div>
  )
}

function splitCopy(value: string) {
  const lines = value.split("\n")
  return lines.map((line, index) => (
    <span key={`${line}-${index}`}>{line}{index < lines.length - 1 && <br />}</span>
  ))
}

export function AuthEntry() {
  const { getTranslation } = useLanguage()

  return (
    <main className="auth-page auth-entry-page">
      <div className="auth-entry-container">
        <ProductBrand />
        <section className="auth-entry-content" aria-labelledby="entry-title">
          <AuthIllustration />
          <div className="auth-entry-copy">
            <h1 id="entry-title">{splitCopy(getTranslation("auth.welcomeTitle"))}</h1>
            <p>{splitCopy(getTranslation("auth.welcomeDescription"))}</p>
          </div>
        </section>
        <nav className="auth-segmented-entry" aria-label={getTranslation("auth.authNavigation")}>
          <Link href="/signup" aria-current="page" className="is-selected">{getTranslation("auth.register")}</Link>
          <Link href="/login">{getTranslation("auth.signInAction")}</Link>
        </nav>
      </div>
    </main>
  )
}
