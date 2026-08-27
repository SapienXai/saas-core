"use client"

import { useEffect } from "react"
import Link from "next/link"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    console.error("Application error:", error)
  }, [error])

  return <main className="flex min-h-screen items-center justify-center bg-slate-50 px-6 dark:bg-[#101116]"><div className="max-w-md text-center"><p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">Something went wrong</p><h1 className="mt-3 text-3xl font-bold text-slate-950 dark:text-white">We could not load this page.</h1><p className="mt-3 text-sm text-slate-500 dark:text-slate-400">Try again or return to your workspace.</p><div className="mt-6 flex justify-center gap-2"><button type="button" onClick={reset} className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-semibold text-white">Try again</button><Link href="/app" className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-200">Workspace</Link></div></div></main>
}
