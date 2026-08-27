"use client"

import { useState, useTransition } from "react"
import { toast } from "sonner"
import { savePlatformMember } from "@/app/platform/actions"

const ROLES = ["platform_owner", "platform_admin", "billing_admin", "support", "auditor"]

export function PlatformMemberEditor({ users, members }: { users: Array<{ id: string; email: string; name: string }>; members: Array<{ user_id: string; role: string; status: string }> }) {
  const [userId, setUserId] = useState(users[0]?.id || "")
  const current = members.find((member) => member.user_id === userId)
  const [role, setRole] = useState(current?.role || "support")
  const [status, setStatus] = useState<"active" | "suspended">(current?.status === "suspended" ? "suspended" : "active")
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()
  const selectUser = (nextId: string) => { setUserId(nextId); const member = members.find((item) => item.user_id === nextId); setRole(member?.role || "support"); setStatus(member?.status === "suspended" ? "suspended" : "active") }
  const submit = (event: React.FormEvent) => { event.preventDefault(); startTransition(async () => { const result = await savePlatformMember({ userId, role, status, reason }); if (result.success) { toast.success("Platform member updated"); window.location.reload() } else toast.error("message" in result ? result.message : "Platform member update failed") }) }
  return <form onSubmit={submit} className="rounded-2xl border border-violet-400/20 bg-violet-500/[0.06] p-5"><h3 className="font-semibold text-white">Grant or update platform access</h3><p className="mt-1 text-xs text-slate-400">This changes platform staff access only; workspace roles are managed separately.</p><div className="mt-4 grid gap-3 sm:grid-cols-3"><label className="text-xs text-slate-400 sm:col-span-1">User<select value={userId} onChange={(event) => selectUser(event.target.value)} disabled={pending} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">{users.map((user) => <option key={user.id} value={user.id}>{user.email}</option>)}</select></label><label className="text-xs text-slate-400">Role<select value={role} onChange={(event) => setRole(event.target.value)} disabled={pending} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white">{ROLES.map((item) => <option key={item} value={item}>{item}</option>)}</select></label><label className="text-xs text-slate-400">Status<select value={status} onChange={(event) => setStatus(event.target.value as "active" | "suspended")} disabled={pending} className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white"><option value="active">active</option><option value="suspended">suspended</option></select></label></div><label className="mt-3 block text-xs text-slate-400">Reason<input required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Why is this access changing?" className="mt-1.5 w-full rounded-lg border border-white/10 bg-slate-950 px-3 py-2 text-sm text-white placeholder:text-slate-600" /></label><button type="submit" disabled={pending || !userId} className="mt-4 rounded-xl bg-violet-500 px-4 py-2.5 text-sm font-semibold text-white hover:bg-violet-400 disabled:opacity-40">{pending ? "Saving…" : "Save platform access"}</button></form>
}
