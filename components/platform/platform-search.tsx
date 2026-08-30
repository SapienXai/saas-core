"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { Search, Building2, UserRound, Globe2, CreditCard, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList, CommandSeparator } from "@/components/ui/command"
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog"

type SearchItem = { id: string; title: string; subtitle: string; href: string; meta?: string }
type SearchGroup = { type: string; items: SearchItem[] }

const iconByType = { Workspaces: Building2, Users: UserRound, Domains: Globe2, Billing: CreditCard } as const

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
  return <><Button type="button" variant={compact ? "ghost" : "outline"} onClick={() => setOpen(true)} className={compact ? "h-9 w-9 border border-slate-200 bg-transparent p-0 text-slate-500 hover:bg-violet-50 hover:text-violet-700 dark:border-white/10 dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white" : "h-9 w-full justify-between border-slate-200 bg-white/80 px-3 text-slate-500 hover:text-slate-900 dark:border-white/10 dark:bg-white/[0.04] dark:text-slate-400 dark:hover:text-white sm:w-72"} aria-label="Search platform"><span className="flex items-center gap-2"><Search className="h-4 w-4" /><span className={compact ? "sr-only" : "text-xs"}>Search workspaces, users, domains…</span></span>{!compact ? <kbd className="hidden rounded-md border border-slate-200 px-1.5 py-0.5 text-[10px] text-slate-500 dark:border-white/10 sm:inline">⌘K</kbd> : null}</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="top-3 w-[calc(100%-1rem)] translate-y-0 overflow-hidden border-slate-200 bg-white p-0 text-slate-950 dark:border-white/10 dark:bg-[#101116] dark:text-white sm:top-[12%] sm:max-w-2xl sm:translate-y-0 sm:rounded-2xl"><DialogTitle className="sr-only">Search Platform Control</DialogTitle><Command shouldFilter={false} className="bg-white text-slate-950 dark:bg-[#101116] dark:text-white"><CommandInput value={query} onValueChange={setQuery} placeholder="Search workspaces, users, domains…" className="h-14 text-base" /><CommandList className="max-h-[min(68dvh,34rem)] py-2"><CommandEmpty>{loading ? <span className="flex items-center justify-center gap-2 text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Searching…</span> : query.length < 2 ? "Type at least two characters to search." : "No matching platform entities."}</CommandEmpty>{groups.map((group, index) => { const Icon = iconByType[group.type as keyof typeof iconByType] || Search; return <div key={group.type}>{index > 0 ? <CommandSeparator /> : null}<CommandGroup heading={group.type}>{group.items.map((item) => <CommandItem key={`${group.type}-${item.id}`} value={`${item.title}-${item.id}`} onSelect={() => { setOpen(false); setQuery(""); router.push(item.href) }} className="min-h-14 cursor-pointer gap-3 px-3 py-2.5 data-[selected=true]:bg-violet-50 dark:data-[selected=true]:bg-white/[0.08]"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Icon className="h-4 w-4" /></span><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold text-slate-800 dark:text-slate-200">{item.title}</span><span className="mt-0.5 block truncate text-xs text-slate-500">{item.subtitle}</span></span>{item.meta ? <span className="hidden shrink-0 text-[11px] text-slate-500 sm:block">{item.meta}</span> : null}</CommandItem>)}</CommandGroup></div>})}</CommandList></Command></DialogContent></Dialog></>
}
