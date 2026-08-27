"use client"

import Link from "next/link"
import { Menu, X } from "lucide-react"
import { useEffect, useState } from "react"

type DocsNavigationProps = {
  current: string
  navigation: readonly (readonly [string, string])[]
}

function DocsBrand() {
  return <Link href="/docs" className="text-lg font-semibold tracking-tight">ReserveVia <span className="text-violet-600">Docs</span></Link>
}

export function PublicDocsNavigation({ current, navigation }: DocsNavigationProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!open) return
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false)
    }
    document.body.style.overflow = "hidden"
    window.addEventListener("keydown", onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener("keydown", onKeyDown)
    }
  }, [open])

  const closeMenu = () => setOpen(false)

  const links = navigation.map(([href, label]) => (
    <Link
      key={href}
      href={href === "overview" ? "/docs" : `/docs/${href}`}
      onClick={closeMenu}
      className={`rounded-lg px-3 py-2 transition hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-white/10 dark:hover:text-white ${current === href ? "bg-slate-100 font-medium text-slate-950 dark:bg-white/10 dark:text-white" : ""}`}
    >
      {label}
    </Link>
  ))

  return (
    <>
      <div className="mb-6 flex items-center justify-between lg:hidden">
        <DocsBrand />
        <button
          type="button"
          aria-controls="public-docs-mobile-navigation"
          aria-expanded={open}
          aria-label={open ? "Close documentation navigation" : "Open documentation navigation"}
          onClick={() => setOpen((value) => !value)}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 text-sm font-medium text-slate-700 shadow-sm transition hover:border-slate-300 hover:text-slate-950 dark:border-white/10 dark:bg-white/5 dark:text-slate-200 dark:hover:bg-white/10"
        >
          {open ? <X className="h-4 w-4" aria-hidden="true" /> : <Menu className="h-4 w-4" aria-hidden="true" />}
          <span>{open ? "Close" : "Docs menu"}</span>
        </button>
      </div>

      {open ? <>
        <button type="button" aria-label="Close documentation navigation" onClick={closeMenu} className="fixed inset-0 z-40 bg-slate-950/30 lg:hidden" />
        <div
          id="public-docs-mobile-navigation"
          className="fixed inset-y-0 left-0 z-50 w-[min(19rem,88vw)] overflow-y-auto border-r border-slate-200 bg-white px-5 py-6 shadow-2xl dark:border-white/10 dark:bg-[#11131a] lg:hidden"
        >
          <div className="flex items-center justify-between">
            <DocsBrand />
            <button type="button" aria-label="Close documentation navigation" onClick={closeMenu} className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-950 dark:hover:bg-white/10 dark:hover:text-white">
              <X className="h-5 w-5" aria-hidden="true" />
            </button>
          </div>
          <nav className="mt-8 grid gap-1 text-sm text-slate-600 dark:text-slate-400" aria-label="Documentation navigation">
            {links}
          </nav>
        </div>
      </> : null}

      <aside className="hidden lg:sticky lg:top-10 lg:block lg:h-fit">
        <DocsBrand />
        <nav className="mt-8 grid gap-1 text-sm text-slate-600 dark:text-slate-400" aria-label="Documentation navigation">
          {links}
        </nav>
      </aside>
    </>
  )
}
