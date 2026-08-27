"use client"

import { AlertTriangle } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"

export default function PlatformError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const router = useRouter()
  return <div className="mx-auto flex max-w-md flex-col items-center justify-center py-16 text-center"><span className="flex h-11 w-11 items-center justify-center rounded-xl bg-rose-500/10 text-rose-300"><AlertTriangle className="h-5 w-5" /></span><h2 className="mt-4 text-lg font-semibold text-white">Platform data could not load</h2><p className="mt-2 text-sm leading-6 text-slate-400">The operation failed safely. Try again, or return to the Platform Control home.</p><div className="mt-5 flex gap-2"><Button type="button" onClick={() => reset()} className="min-h-11 bg-violet-500 text-white hover:bg-violet-400">Try again</Button><Button type="button" variant="outline" onClick={() => router.push("/platform")} className="min-h-11 border-white/10 text-slate-300">Go home</Button></div></div>
}
