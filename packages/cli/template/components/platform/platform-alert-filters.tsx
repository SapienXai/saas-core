"use client"

import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { Filter } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet"

const fields = [
  { key: "severity", label: "Severity", options: [["all", "All severities"], ["critical", "Critical"], ["warning", "Warning"], ["info", "Info"]] },
  { key: "type", label: "Type", options: [["all", "All types"], ["billing", "Billing"], ["quota", "Quota"], ["domain", "Domains"], ["suspension", "Suspensions"], ["override", "Overrides"], ["reconciliation", "Reconciliation"]] },
] as const

export function PlatformAlertFilters() {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const current = (key: string) => params.get(key) || "all"
  const activeCount = fields.filter((field) => current(field.key) !== "all").length

  function apply(values: Record<string, string>) {
    const next = new URLSearchParams(params.toString())
    for (const field of fields) {
      const value = values[field.key] || "all"
      if (value === "all") next.delete(field.key)
      else next.set(field.key, value)
    }
    router.push(`${pathname}${next.toString() ? `?${next.toString()}` : ""}`)
  }

  return <div className="flex items-center justify-between gap-2"><div className="hidden flex-wrap gap-2 sm:flex">{fields.map((field) => <select key={field.key} aria-label={field.label} value={current(field.key)} onChange={(event) => apply({ ...Object.fromEntries(fields.map((item) => [item.key, current(item.key)])), [field.key]: event.target.value })} className="h-9 rounded-xl border border-white/10 bg-white/[0.04] px-3 text-xs font-semibold text-slate-300 outline-none focus:border-violet-400"><option value="all">{field.label}: All</option>{field.options.slice(1).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>)}</div><Sheet><SheetTrigger asChild><Button type="button" variant="outline" className="h-10 border-white/10 text-slate-300 sm:hidden"><Filter className="mr-2 h-4 w-4" />Filters{activeCount ? ` · ${activeCount}` : ""}</Button></SheetTrigger><SheetContent side="bottom" className="rounded-t-3xl border-white/10 bg-slate-950 text-white"><SheetHeader><SheetTitle className="text-left text-white">Filter alerts</SheetTitle><SheetDescription className="text-left text-slate-400">Focus the action center on the conditions you can act on now.</SheetDescription></SheetHeader><div className="grid gap-4 px-4 pb-5">{fields.map((field) => <label key={field.key} className="grid gap-2 text-sm font-semibold text-slate-300">{field.label}<select value={current(field.key)} onChange={(event) => apply({ ...Object.fromEntries(fields.map((item) => [item.key, current(item.key)])), [field.key]: event.target.value })} className="h-11 rounded-xl border border-white/10 bg-white/[0.05] px-3 text-sm text-white outline-none focus:border-violet-400">{field.options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>)}</div></SheetContent></Sheet></div>
}
