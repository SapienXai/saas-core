"use client"

import { useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { ListFilter, SlidersHorizontal, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet"

export type PlatformFilterOption = { value: string; label: string }
export type PlatformFilterConfig = { key: string; label: string; options: PlatformFilterOption[] }

function FilterSelect({ filter, value, onChange }: { filter: PlatformFilterConfig; value: string; onChange: (value: string) => void }) {
  return <label className="grid min-w-0 gap-1.5 text-[11px] font-semibold text-slate-500"><span>{filter.label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className="min-h-10 min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-800 outline-none focus:border-violet-400 dark:border-white/10 dark:bg-white/[0.05] dark:text-white"><>{filter.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</></select></label>
}

export function PlatformFilterBar({ filters, values }: { filters: PlatformFilterConfig[]; values: Record<string, string> }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(values)
  const activeCount = useMemo(() => filters.reduce((count, filter) => count + (values[filter.key] && values[filter.key] !== "all" ? 1 : 0), 0), [filters, values])
  function apply(next: Record<string, string>) {
    const params = new URLSearchParams(searchParams.toString())
    for (const filter of filters) {
      const value = next[filter.key] || "all"
      if (value === "all") params.delete(filter.key)
      else params.set(filter.key, value)
    }
    params.delete("page")
    router.push(`${pathname}${params.toString() ? `?${params.toString()}` : ""}`)
    setOpen(false)
  }
  function clear() {
    const next = { ...values }
    filters.forEach((filter) => { next[filter.key] = "all" })
    apply(next)
  }
  return <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-2.5"><div className="flex items-center justify-between gap-2 lg:hidden"><button type="button" onClick={() => { setDraft(values); setOpen(true) }} className="flex min-h-10 items-center gap-2 rounded-xl px-2.5 text-xs font-semibold text-slate-300 hover:bg-white/[0.06]"><SlidersHorizontal className="h-4 w-4" />Filters{activeCount > 0 ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-500 px-1 text-[10px] text-white">{activeCount}</span> : null}</button>{activeCount > 0 ? <button type="button" onClick={clear} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl px-2.5 text-xs font-semibold text-slate-500 hover:text-white"><X className="h-3.5 w-3.5" />Clear</button> : null}</div><div className="hidden gap-2 lg:grid lg:grid-cols-4">{filters.map((filter) => <FilterSelect key={filter.key} filter={filter} value={values[filter.key] || "all"} onChange={(value) => apply({ ...values, [filter.key]: value })} />)}</div><Sheet open={open} onOpenChange={setOpen}><SheetContent side="bottom" className="max-h-[85dvh] rounded-t-3xl border-white/10 bg-slate-950 pb-[env(safe-area-inset-bottom)]"><div className="mx-auto w-full max-w-lg"><SheetTitle className="flex items-center gap-2 text-white"><ListFilter className="h-4 w-4 text-violet-300" />Filter results</SheetTitle><SheetDescription className="mt-1 text-slate-400">Narrow the customer list without losing your search.</SheetDescription><div className="mt-5 grid gap-4">{filters.map((filter) => <FilterSelect key={filter.key} filter={filter} value={draft[filter.key] || "all"} onChange={(value) => setDraft((current) => ({ ...current, [filter.key]: value }))} />)}</div><div className="mt-6 flex gap-2"><Button type="button" variant="outline" onClick={clear} className="min-h-11 flex-1 border-white/10 text-slate-300">Clear</Button><Button type="button" onClick={() => apply(draft)} className="min-h-11 flex-1 bg-violet-500 text-white hover:bg-violet-400">Apply filters</Button></div></div></SheetContent></Sheet></div>
}
