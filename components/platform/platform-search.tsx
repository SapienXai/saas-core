"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Building2, Store, UserRound, Globe2, CreditCard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

type SearchItem = { id: string; title: string; subtitle: string; href: string; meta?: string }
type SearchGroup = { type: string; items: SearchItem[] }

const iconByType = { Workspaces: Building2, Restaurants: Store, Users: UserRound, Domains: Globe2, Billing: CreditCard } as const

export function PlatformSearch({ compact = false }: { compact?: boolean }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [groups, setGroups] = useState<SearchGroup[]>([])
  const [loading, setLoading] = useState(false)
  useEffect(() => {
    const handler = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setOpen(true) } }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [])
  useEffect(() => {
    if (!open || query.trim().length < 2) { setGroups([]); return }
    const controller = new AbortController()
    const timer = window.setTimeout(async () => {
      setLoading(true)
      try {
        const response = await fetch(`/api/platform/search?q=${encodeURIComponent(query.trim())}`, { signal: controller.signal })
        if (response.ok) { const data = await response.json() as { groups?: SearchGroup[] }; setGroups(data.groups || []) }
      } catch (error) { if ((error as Error).name !== "AbortError") setGroups([]) }
      finally { setLoading(false) }
    }, 180)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [open, query])
  return <><Button type="button" variant={compact ? "ghost" : "outline"} onClick={() => setOpen(true)} className={compact ? "h-9 w-9 border border-white/10 bg-transparent p-0 text-slate-300 hover:bg-white/[0.08] hover:text-white" : "h-9 w-full justify-between border-white/10 bg-white/[0.04] px-3 text-slate-400 hover:text-white sm:w-72"} aria-label="Search platform"><span className="flex items-center gap-2"><Search className="h-4 w-4" /><span className={compact ? "sr-only" : "text-xs"}>Search customers, domains, users…</span></span>{!compact ? <kbd className="hidden rounded-md border border-white/10 px-1.5 py-0.5 text-[10px] text-slate-500 sm:inline">⌘K</kbd> : null}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="top-3 w-[calc(100%-1rem)] translate-y-0 overflow-hidden border-white/10 bg-slate-950 p-0 text-white sm:top-[12%] sm:max-w-2xl sm:translate-y-0 sm:rounded-2xl"><DialogTitle className="sr-only">Search Platform Control</DialogTitle><Command shouldFilter={false} className="bg-slate-950 text-white"><CommandInput value={query} onValueChange={setQuery} placeholder="Search workspaces, restaurants, users, domains…" className="h-14 text-base" /><CommandList className="max-h-[min(68dvh,34rem)] py-2"><CommandEmpty>{loading ? <span className="flex items-center justify-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Searching…</span> : query.length < 2 ? "Type at least two characters to search." : "No matching platform entities."}</CommandEmpty>{groups.map((group, index) => { const Icon = iconByType[group.type as keyof typeof iconByType] || Search; return <div key={group.type}>{index > 0 ? <CommandSeparator /> : null}<CommandGroup heading={group.type}>{group.items.map((item) => <CommandItem key={`${group.type}-${item.id}`} value={`${item.title}-${item.id}`} onSelect={() => { setOpen(false); setQuery(""); router.push(item.href) }} className="min-h-14 cursor-pointer gap-3 px-3 py-2.5 data-[selected=true]:bg-white/[0.08]"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/15 text-violet-200"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-200">{item.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{item.subtitle}</span></span>{item.meta ? <span className="hidden shrink-0 text-[11px] text-slate-500 sm:block">{item.meta}</span> : null}</CommandItem>)}</CommandGroup></div>})}</CommandList></Command></DialogContent></Dialog></>
}
