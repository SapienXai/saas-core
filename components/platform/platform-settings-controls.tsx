"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { savePlatformSetting } from "@/app/platform/actions"

export function PlatformSettingEditor({ setting, canEdit }: { setting: { key: string; value: unknown }; canEdit: boolean }) {
  const initial = typeof setting.value === "boolean" ? String(setting.value) : typeof setting.value === "string" ? setting.value : JSON.stringify(setting.value)
  const [value, setValue] = useState(initial)
  const [pending, startTransition] = useTransition()
  const booleanSetting = setting.key === "maintenance_mode" || setting.key === "signup_enabled"
  const submit = () => {
    const reason = window.prompt(`Reason for updating ${setting.key}:`)
    if (reason === null) return
    const next = booleanSetting ? value === "true" : value
    startTransition(async () => {
      const result = await savePlatformSetting(setting.key, next, reason)
      if (result.success) { toast.success("Platform setting updated"); window.location.reload() } else toast.error("message" in result ? result.message : "Setting update failed")
    })
  }
  return <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-white/10 bg-white/[0.04] p-4"><div><p className="text-sm font-semibold text-white">{setting.key}</p><p className="mt-1 text-xs text-slate-500">Only non-secret operational settings belong here.</p></div><div className="flex items-center gap-2">{booleanSetting ? <select value={value} onChange={(event) => setValue(event.target.value)} disabled={!canEdit || pending} className="rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white disabled:opacity-50"><option value="true">Enabled</option><option value="false">Disabled</option></select> : <input value={value} onChange={(event) => setValue(event.target.value)} disabled={!canEdit || pending} className="w-64 rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white outline-none focus:border-violet-400 disabled:opacity-50" /> }<button type="button" disabled={!canEdit || pending} onClick={submit} className="rounded-lg bg-violet-500 px-3 py-2 text-xs font-semibold text-white hover:bg-violet-400 disabled:opacity-40">Save</button></div></div>
}
