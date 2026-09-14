"use client"

import { useState, useTransition } from "react"
import { Copy, Plus, Archive, Pencil, Play, X } from "lucide-react"
import { useRouter } from "next/navigation"
import type { PlatformPlanRecord } from "@/lib/platform-admin"
import { activatePlatformPlanAction, archivePlatformPlanAction, createPlatformPlanAction, duplicatePlatformPlanAction, updatePlatformPlanAction } from "@/app/platform/billing/actions"
import { ManageEmptyState, ManageSurface, ManageToolbar } from "@/components/manage/manage-responsive"
import { PlatformStatusBadge } from "@/components/platform/platform-primitives"
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog"

type Panel = { mode: "create" } | { mode: "edit"; row: PlatformPlanRecord } | { mode: "duplicate"; row: PlatformPlanRecord } | null
type FormState = { key: string; name: string; description: string; sortOrder: string; features: string; limits: string; metadata: string; recommended: boolean; reason: string }

const emptyForm: FormState = { key: "", name: "", description: "", sortOrder: "0", features: "{}", limits: "{}", metadata: "{}", recommended: false, reason: "" }

function planForm(row: PlatformPlanRecord, mode: "edit" | "duplicate"): FormState {
  return {
    key: mode === "duplicate" ? `${row.key}-copy` : row.key,
    name: mode === "duplicate" ? `${row.name} copy` : row.name,
    description: row.description || "",
    sortOrder: String(row.sort_order),
    features: JSON.stringify(row.features || {}, null, 2),
    limits: JSON.stringify(row.limits || {}, null, 2),
    metadata: JSON.stringify(row.metadata || {}, null, 2),
    recommended: row.metadata?.recommended === true,
    reason: "",
  }
}

function Field({ label, value, onChange, placeholder, required = false }: { label: string; value: string; onChange: (value: string) => void; placeholder?: string; required?: boolean }) {
  return <label className="block space-y-1.5 text-sm font-semibold text-slate-800 dark:text-slate-200"><span>{label}{required ? <span className="ml-1 text-violet-600">*</span> : null}</span><input value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} required={required} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-normal outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-white" /></label>
}

function JsonField({ label, value, onChange, description }: { label: string; value: string; onChange: (value: string) => void; description: string }) {
  return <label className="block space-y-1.5 text-sm font-semibold text-slate-800 dark:text-slate-200"><span>{label}</span><span className="block text-xs font-normal leading-5 text-slate-500 dark:text-slate-400">{description}</span><textarea value={value} onChange={(event) => onChange(event.target.value)} rows={5} spellCheck={false} className="w-full rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 font-mono text-xs font-normal leading-5 outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-100" /></label>
}

export function PlatformPlanManagement({ rows }: { rows: PlatformPlanRecord[] }) {
  const router = useRouter()
  const [panel, setPanel] = useState<Panel>(null)
  const [form, setForm] = useState<FormState>(emptyForm)
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const { showConfirmation, ConfirmationDialogComponent } = useConfirmationDialog()

  const open = (next: Panel) => {
    setMessage(null)
    setPanel(next)
    setForm(next === null || next.mode === "create" ? emptyForm : planForm(next.row, next.mode))
  }

  const run = (action: (data: FormData) => Promise<{ success: boolean; message: string }>, data: FormData, close = false) => startTransition(async () => {
    const result = await action(data)
    setMessage({ ok: result.success, text: result.message })
    if (result.success) {
      if (close) setPanel(null)
      router.refresh()
    }
  })

  const submit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const data = new FormData()
    for (const [key, value] of Object.entries(form)) data.set(key, String(value))
    if (panel?.mode === "duplicate") {
      data.set("sourceKey", panel.row.key)
      data.set("newKey", form.key)
      run(duplicatePlatformPlanAction, data, true)
    } else if (panel?.mode === "edit") {
      run(updatePlatformPlanAction, data, true)
    } else {
      run(createPlatformPlanAction, data, true)
    }
  }

  const toggleArchive = (row: PlatformPlanRecord) => {
    const data = new FormData()
    data.set("key", row.key)
    data.set("reason", row.active ? "Archived from the platform billing catalog." : "Reactivated from the platform billing catalog.")
    const action = row.active ? archivePlatformPlanAction : activatePlatformPlanAction
    if (!row.active) return run(action, data)
    showConfirmation({
      title: `Archive ${row.name}?`,
      description: row.referenced ? "This plan has billing history. Active subscriptions must be moved first; historical rows will remain intact." : "Archived plans stay in history but are no longer available for new checkout or selection.",
      confirmText: "Archive plan",
      variant: "destructive",
      onConfirm: () => run(action, data),
    })
  }

  return <div className="space-y-3">
    <ManageToolbar><div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-semibold text-slate-900 dark:text-white">Plan catalog</p><p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">Manage reusable plan definitions. Entitlement maps are validated on the server.</p></div><button type="button" onClick={() => open({ mode: "create" })} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white shadow-sm shadow-violet-600/20 transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500"><Plus className="h-4 w-4" />Add plan</button></div></ManageToolbar>
    {message ? <div className={`rounded-xl border px-3.5 py-3 text-sm ${message.ok ? "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-300" : "border-rose-200 bg-rose-50 text-rose-800 dark:border-rose-400/20 dark:bg-rose-500/10 dark:text-rose-300"}`} role="status">{message.text}</div> : null}
    {rows.length === 0 ? <ManageSurface><ManageEmptyState title="No plans configured" description="Create the first reusable plan definition for this product." action={<button type="button" onClick={() => open({ mode: "create" })} className="inline-flex min-h-10 items-center gap-2 rounded-xl bg-violet-600 px-3.5 text-xs font-bold text-white"><Plus className="h-4 w-4" />Add plan</button>} compact /></ManageSurface> : <ManageSurface className="overflow-hidden">
      <div className="hidden lg:block"><div className="grid grid-cols-[minmax(0,1.5fr)_110px_190px_245px] gap-3 border-b border-slate-200/80 px-4 py-3 text-[10px] font-bold uppercase tracking-[0.12em] text-slate-500 dark:border-white/10 dark:text-slate-400"><span>Plan</span><span>Status</span><span>Entitlements</span><span className="text-right">Actions</span></div>{rows.map((row) => <div key={row.key} className="grid grid-cols-[minmax(0,1.5fr)_110px_190px_245px] items-center gap-3 border-b border-slate-100 px-4 py-3.5 last:border-0 dark:border-white/10"><div className="min-w-0"><div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-semibold text-slate-950 dark:text-white">{row.name}</p>{row.metadata?.recommended === true ? <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[10px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300">Recommended</span> : null}</div><p className="truncate text-xs text-slate-500 dark:text-slate-400"><code>{row.key}</code>{row.description ? ` · ${row.description}` : ""}</p></div><PlatformStatusBadge status={row.active ? "active" : "archived"} label={row.active ? "Active" : "Archived"} /><div className="min-w-0 text-xs text-slate-500 dark:text-slate-400"><p>{Object.keys(row.features || {}).length} feature{Object.keys(row.features || {}).length === 1 ? "" : "s"} · {Object.keys(row.limits || {}).length} limit{Object.keys(row.limits || {}).length === 1 ? "" : "s"}</p><p className="mt-0.5">{row.referenced ? "Has subscription history" : "Not yet referenced"}</p></div><div className="flex flex-wrap justify-end gap-1"><button type="button" disabled={pending} onClick={() => open({ mode: "edit", row })} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-violet-700 hover:bg-violet-50 disabled:opacity-40 dark:text-violet-300 dark:hover:bg-violet-500/10"><Pencil className="h-3.5 w-3.5" />Edit</button><button type="button" disabled={pending} onClick={() => open({ mode: "duplicate", row })} className="inline-flex min-h-10 items-center gap-1 rounded-lg px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-100 disabled:opacity-40 dark:text-slate-300 dark:hover:bg-white/[0.06]"><Copy className="h-3.5 w-3.5" />Duplicate</button><button type="button" disabled={pending} onClick={() => toggleArchive(row)} className={`inline-flex min-h-10 items-center gap-1 rounded-lg px-2 text-xs font-bold disabled:opacity-40 ${row.active ? "text-rose-700 hover:bg-rose-50 dark:text-rose-300 dark:hover:bg-rose-500/10" : "text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-500/10"}`}>{row.active ? <Archive className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}{row.active ? "Archive" : "Activate"}</button></div></div>)}</div>
      <div className="divide-y divide-slate-100 dark:divide-white/10 lg:hidden">{rows.map((row) => <article key={row.key} className="p-3.5"><div className="flex items-start gap-3"><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-950 dark:text-white">{row.name}</p><p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400"><code>{row.key}</code></p></div><PlatformStatusBadge status={row.active ? "active" : "archived"} label={row.active ? "Active" : "Archived"} /></div>{row.description ? <p className="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">{row.description}</p> : null}<p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{Object.keys(row.features || {}).length} feature{Object.keys(row.features || {}).length === 1 ? "" : "s"} · {Object.keys(row.limits || {}).length} limit{Object.keys(row.limits || {}).length === 1 ? "" : "s"} · {row.referenced ? "Has subscription history" : "Not yet referenced"}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={pending} onClick={() => open({ mode: "edit", row })} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold dark:border-white/10"><Pencil className="h-3.5 w-3.5" />Edit</button><button type="button" disabled={pending} onClick={() => open({ mode: "duplicate", row })} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold dark:border-white/10"><Copy className="h-3.5 w-3.5" />Duplicate</button><button type="button" disabled={pending} onClick={() => toggleArchive(row)} className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-xs font-bold dark:border-white/10">{row.active ? "Archive" : "Activate"}</button></div></div></div></article>)}</div>
    </ManageSurface>}
    {panel ? <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 p-2 backdrop-blur-[2px] sm:items-center sm:p-6" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) open(null) }}><section role="dialog" aria-modal="true" aria-labelledby="platform-plan-panel-title" className="max-h-[calc(100dvh-1rem)] w-full max-w-2xl overflow-y-auto rounded-[1.5rem] bg-white p-5 shadow-2xl dark:bg-slate-950 sm:max-h-[calc(100dvh-3rem)] sm:p-6"><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[0.14em] text-violet-600">Platform Control</p><h2 id="platform-plan-panel-title" className="mt-1 text-xl font-bold tracking-tight text-slate-950 dark:text-white">{panel.mode === "create" ? "Add plan" : panel.mode === "duplicate" ? "Duplicate plan" : "Edit plan"}</h2><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{panel.mode === "duplicate" ? "The copy starts inactive and does not copy provider price mappings." : "Keep plan identity stable while changing only validated catalog fields."}</p></div><button type="button" onClick={() => open(null)} className="inline-flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 dark:hover:bg-white/[0.06]" aria-label="Close"><X className="h-5 w-5" /></button></div><form onSubmit={submit} className="mt-6 space-y-4"><div className="grid gap-4 sm:grid-cols-2"><Field label="Stable key" value={form.key} onChange={(value) => setForm((current) => ({ ...current, key: value }))} placeholder="plan_key" required /><Field label="Display name" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} required /></div><Field label="Description" value={form.description} onChange={(value) => setForm((current) => ({ ...current, description: value }))} placeholder="Optional product copy" /><div className="grid gap-4 sm:grid-cols-2"><Field label="Sort order" value={form.sortOrder} onChange={(value) => setForm((current) => ({ ...current, sortOrder: value }))} required /><label className="flex min-h-11 items-center gap-2 self-end rounded-xl border border-slate-200 px-3 text-sm font-semibold text-slate-800 dark:border-white/10 dark:text-slate-200"><input type="checkbox" checked={form.recommended} onChange={(event) => setForm((current) => ({ ...current, recommended: event.target.checked }))} className="h-4 w-4 accent-violet-600" />Recommended plan</label></div><div className="grid gap-4 lg:grid-cols-3"><JsonField label="Features" value={form.features} onChange={(value) => setForm((current) => ({ ...current, features: value }))} description="Boolean capability keys." /><JsonField label="Limits" value={form.limits} onChange={(value) => setForm((current) => ({ ...current, limits: value }))} description="Finite integers or null for unlimited." /><JsonField label="Metadata" value={form.metadata} onChange={(value) => setForm((current) => ({ ...current, metadata: value }))} description="Product-owned JSON metadata." /></div><Field label="Reason" value={form.reason} onChange={(value) => setForm((current) => ({ ...current, reason: value }))} placeholder="Why is this catalog entry changing?" required /><div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end"><button type="button" onClick={() => open(null)} className="min-h-11 rounded-xl border border-slate-200 px-4 text-sm font-bold dark:border-white/10">Cancel</button><button type="submit" disabled={pending} className="min-h-11 rounded-xl bg-violet-600 px-4 text-sm font-bold text-white disabled:opacity-50">{pending ? "Saving…" : panel.mode === "create" ? "Create plan" : panel.mode === "duplicate" ? "Duplicate plan" : "Save changes"}</button></div></form></section></div> : null}
    {ConfirmationDialogComponent}
  </div>
}
