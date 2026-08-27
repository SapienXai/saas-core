import Link from "next/link"
import Image from "next/image"
import { ArrowRight, Layers3, ShieldCheck, Sparkles } from "lucide-react"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export default function Home() {
  return (
    <main className="min-h-screen bg-slate-950 px-6 py-16 text-white sm:px-10">
      <div className="mx-auto grid max-w-5xl gap-12 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <section>
          <div className="mb-8 inline-flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.06] px-3 py-2"><Image src={PRODUCT_CONFIG.iconPath} alt="" width={32} height={32} className="h-8 w-8 rounded-lg" /><span className="text-sm font-semibold">{PRODUCT_CONFIG.name}</span></div>
          <p className="mb-4 text-sm font-semibold uppercase tracking-[0.2em] text-violet-300">Workspace foundation</p>
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight sm:text-6xl">Build the product. Keep the platform quality.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-slate-300">{PRODUCT_CONFIG.description} Authentication, tenancy, billing, platform control, PWA behavior, and the management experience are ready at the workspace boundary.</p>
          <div className="mt-8 flex flex-wrap gap-3"><Link href="/login" className="inline-flex h-12 items-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-bold text-white transition hover:bg-violet-400">Open workspace <ArrowRight className="h-4 w-4" /></Link><Link href="/signup" className="inline-flex h-12 items-center rounded-xl border border-white/15 px-5 text-sm font-bold text-white transition hover:bg-white/10">Create account</Link></div>
        </section>
        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1">
          {[{icon:Layers3,title:"Workspace-first",body:"Every product domain attaches to an explicit workspace boundary."},{icon:ShieldCheck,title:"Secure by default",body:"Server authorization and row-level policies protect membership data."},{icon:Sparkles,title:"Production interactions",body:"Responsive shell, overlays, feedback, themes, and PWA support stay intact."}].map(({icon:Icon,title,body}) => <div key={title} className="rounded-3xl border border-white/10 bg-white/[0.06] p-5"><Icon className="h-5 w-5 text-violet-300" /><h2 className="mt-4 text-base font-bold">{title}</h2><p className="mt-2 text-sm leading-6 text-slate-300">{body}</p></div>)}
        </section>
      </div>
    </main>
  )
}
