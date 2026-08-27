"use client"

import Link from "next/link"
import Image from "next/image"
import { ArrowRight } from "lucide-react"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export default function NotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
      <section className="max-w-lg text-center"><Image src={PRODUCT_CONFIG.iconPath} alt="" width={56} height={56} className="mx-auto h-14 w-14 rounded-2xl" /><p className="mt-6 text-sm font-semibold uppercase tracking-[0.2em] text-violet-300">Page not found</p><h1 id="not-found-title" className="mt-3 text-4xl font-bold">That workspace path does not exist.</h1><p className="mt-4 text-slate-300">Return to {PRODUCT_CONFIG.name} and continue from your workspace.</p><Link href="/" className="mt-8 inline-flex h-12 items-center gap-2 rounded-xl bg-violet-500 px-5 text-sm font-bold hover:bg-violet-400">Go home <ArrowRight className="h-4 w-4" /></Link></section>
    </main>
  )
}
