import Link from "next/link"
import Image from "next/image"
import { redirect } from "next/navigation"
import { ArrowRight, Check, Layers3 } from "lucide-react"
import { getAccountState } from "@/lib/account-state"
import { getCurrentUserAccess } from "@/lib/auth-utils"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export const dynamic = "force-dynamic"

export default async function Home() {
  const state = await getAccountState()
  if (state.authenticated) {
    if (!state.workspaceId && (await getCurrentUserAccess())?.platformRole) redirect("/platform")
    redirect(state.path)
  }

  return (
    <main className="min-h-dvh bg-slate-950 px-4 py-6 text-white sm:px-8 sm:py-10">
      <div className="mx-auto grid min-h-[calc(100dvh-3rem)] max-w-6xl overflow-hidden rounded-[2rem] border border-white/10 bg-slate-900 shadow-2xl shadow-slate-950/30 lg:grid-cols-[1.08fr_.92fr]">
        <section className="flex items-center px-6 py-12 sm:px-12 lg:px-16">
          <div className="w-full max-w-lg">
            <div className="inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2"><Image src={PRODUCT_CONFIG.iconPath} alt="" width={36} height={36} className="h-9 w-9 rounded-xl" priority /><span className="text-sm font-semibold">{PRODUCT_CONFIG.name}</span></div>
            <p className="mt-14 text-xs font-bold uppercase tracking-[0.2em] text-violet-300">Welcome</p>
            <h1 className="mt-4 text-4xl font-bold tracking-tight sm:text-6xl">Welcome to {PRODUCT_CONFIG.name}</h1>
            <p className="mt-6 max-w-md text-base leading-7 text-slate-300">Sign in to your account or create a new account to get started.</p>
            <div className="mt-9 grid gap-3 sm:flex sm:flex-wrap"><Link href="/login" className="inline-flex h-12 items-center justify-center gap-2 rounded-xl bg-violet-500 px-6 text-sm font-bold text-white transition hover:bg-violet-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900">Sign in <ArrowRight className="h-4 w-4" /></Link><Link href="/signup" className="inline-flex h-12 items-center justify-center rounded-xl border border-white/15 px-6 text-sm font-bold text-white transition hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900">Create account</Link></div>
          </div>
        </section>
        <section className="relative overflow-hidden bg-gradient-to-br from-violet-700 via-indigo-700 to-slate-950 px-6 py-12 sm:px-12 lg:px-10">
          <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-fuchsia-300/20 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-24 -left-20 h-64 w-64 rounded-full bg-cyan-300/15 blur-3xl" />
          <div className="relative flex h-full flex-col justify-end">
            <Layers3 className="h-7 w-7 text-violet-100" aria-hidden="true" />
            <h2 className="mt-6 max-w-sm text-2xl font-bold tracking-tight sm:text-3xl">A clear place for your work.</h2>
            <p className="mt-4 max-w-sm text-sm leading-6 text-indigo-100">{PRODUCT_CONFIG.description}</p>
            <div className="mt-8 space-y-3 border-t border-white/15 pt-6 text-sm text-indigo-50">
              {["Your account stays yours", "Your workspace keeps work together", "Your team gets the right access"].map((item) => <div key={item} className="flex items-center gap-3"><span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15"><Check className="h-3.5 w-3.5" /></span>{item}</div>)}
            </div>
          </div>
        </section>
      </div>
    </main>
  )
}
