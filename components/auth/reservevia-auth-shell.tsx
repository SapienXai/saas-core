"use client"

import Image from "next/image"
import Link from "next/link"
import type { ReactNode } from "react"
import { BarChart3, CalendarCheck2, Clock3 } from "lucide-react"
import { RESERVEVIA_LOGO_DARK } from "@/lib/brand-assets"
import { useLanguage } from "@/context/language-context"

export function AuthDivider() {
  const { getTranslation } = useLanguage()
  return (
    <div className="flex items-center gap-3 text-[9px] font-bold uppercase tracking-[0.16em] text-stone-400 sm:text-[10px]">
      <span className="h-px flex-1 bg-stone-200" />
      <span className="shrink-0">{getTranslation("auth.divider")}</span>
      <span className="h-px flex-1 bg-stone-200" />
    </div>
  )
}

function ReserveviaBrand({ className = "", stacked = false, onMedia = false }: { className?: string; stacked?: boolean; onMedia?: boolean }) {
  const { getTranslation } = useLanguage()
  return (
    <Link
      href="/"
      aria-label={getTranslation("auth.homeLabel")}
      className={
        stacked
          ? `group inline-flex w-fit flex-col items-center justify-center gap-2 text-center ${className}`
          : `inline-flex w-fit items-center gap-2.5 ${className}`
      }
    >
      <Image
        src={RESERVEVIA_LOGO_DARK}
        alt=""
        width={stacked ? 40 : 48}
        height={stacked ? 40 : 48}
        className={stacked ? "h-10 w-10 rounded-[12px] object-cover" : "h-12 w-12 rounded-[14px] object-cover"}
        priority
      />
      <span
        className={
          stacked
            ? "font-serif text-[17px] font-semibold tracking-[0.055em] text-stone-950 transition-colors group-hover:text-stone-600"
            : onMedia
              ? "text-[13px] font-extrabold tracking-[0.24em] text-white"
              : "text-[13px] font-extrabold tracking-[0.24em] text-stone-900"
        }
      >
        {stacked ? "ReserveVia" : "RESERVEVIA"}
      </span>
    </Link>
  )
}

export function ReserveviaAuthShell({ title, description, children, footer }: {
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
}) {
  const { getTranslation } = useLanguage()
  return (
    <main className="reservevia-auth-page min-h-[100dvh] overflow-hidden bg-[#f4eee7] text-stone-950 max-[359px]:overflow-visible lg:h-[100dvh] lg:p-5">
      <section className="reservevia-auth-layout mx-auto grid min-h-[100dvh] w-full overflow-hidden border-stone-200/80 bg-[#faf7f2] max-[359px]:min-h-0 max-[359px]:overflow-visible lg:h-[calc(100dvh-2.5rem)] lg:min-h-0 lg:max-w-[1440px] lg:grid-cols-[minmax(0,1.04fr)_minmax(390px,0.96fr)] lg:rounded-[28px] lg:border">
        <aside className="reservevia-auth-aside isolate relative hidden overflow-hidden bg-stone-950 lg:flex lg:min-h-0 lg:flex-col lg:justify-between lg:p-10 xl:p-12">
          <video
            className="pointer-events-none absolute inset-0 z-0 h-full w-full object-cover object-center"
            autoPlay
            loop
            muted
            playsInline
            preload="metadata"
            aria-hidden="true"
          >
            <source src="/assets/banner.webm" type="video/webm" />
            <source src="/assets/banner.mp4" type="video/mp4" />
            Your browser does not support the video tag.
          </video>
          <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-b from-stone-950/75 via-stone-950/15 to-stone-950/80" />
          <div className="pointer-events-none absolute inset-0 z-0 bg-gradient-to-r from-stone-950/35 via-transparent to-stone-950/10" />

          <div className="relative z-10">
            <ReserveviaBrand onMedia />
            <div className="reservevia-auth-copy mt-10 max-w-[390px] xl:mt-11">
              <p className="mb-3 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">{getTranslation("auth.kicker")}</p>
              <h2 className="max-w-[18ch] text-balance text-[2.2rem] font-semibold leading-[0.99] tracking-[-0.065em] text-white xl:text-[2.55rem]">
                {getTranslation("auth.headline")}
              </h2>
              <p className="mt-5 max-w-[340px] text-[13px] leading-[1.65] text-white/80 xl:text-[14px]">
                {getTranslation("auth.description")}
              </p>
              <div className="mt-7 space-y-4">
                {[
                  { icon: CalendarCheck2, title: getTranslation("auth.moreReservations"), description: getTranslation("auth.moreReservationsDescription") },
                  { icon: Clock3, title: getTranslation("auth.saveTime"), description: getTranslation("auth.saveTimeDescription") },
                  { icon: BarChart3, title: getTranslation("auth.growConfidence"), description: getTranslation("auth.growConfidenceDescription") },
                ].map(({ icon: Icon, title: valueTitle, description: valueDescription }) => (
                  <div key={valueTitle} className="flex items-center gap-3">
                    <span className="reservevia-auth-value-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-[12px] bg-white/15 text-white ring-1 ring-white/20">
                      <Icon className="h-[17px] w-[17px]" strokeWidth={1.8} aria-hidden="true" />
                    </span>
                    <span>
                      <strong className="block text-[12px] font-bold leading-4 text-white">{valueTitle}</strong>
                      <span className="mt-0.5 block text-[11px] leading-4 text-white/70">{valueDescription}</span>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <p className="relative z-10 mt-10 text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">{getTranslation("auth.footnote")}</p>
        </aside>

        <div className="reservevia-auth-content relative z-10 flex min-h-[100dvh] items-center justify-center overflow-y-auto px-5 py-6 max-[359px]:min-h-0 max-[359px]:overflow-visible sm:px-8 sm:py-8 lg:min-h-0 lg:overflow-visible lg:border-l lg:border-stone-300/80 lg:shadow-[-10px_0_28px_rgba(28,25,23,0.1)] lg:px-10 lg:py-8 xl:px-14">
          <section className="reservevia-auth-card w-full max-w-[390px] rounded-[22px] border border-stone-200/90 bg-white px-6 py-7 shadow-[0_18px_55px_rgba(67,45,24,0.09)] sm:px-7 sm:py-8 lg:px-7 lg:py-8" aria-labelledby="auth-title">
            <div className="mb-5 flex justify-center lg:hidden">
              <ReserveviaBrand stacked />
            </div>
            <div className="text-center">
              <h1 id="auth-title" className="text-[1.75rem] font-semibold leading-[1.08] tracking-[-0.055em] sm:text-[1.9rem]">{title}</h1>
              <p className="mx-auto mt-2 max-w-[285px] text-[12px] leading-[1.55] text-stone-600 sm:text-[13px]">{description}</p>
            </div>
            <div className="mt-5">{children}</div>
            {footer && <div className="mt-4 text-center text-[12px] text-stone-600 sm:text-[13px]">{footer}</div>}
          </section>
        </div>
      </section>
    </main>
  )
}
