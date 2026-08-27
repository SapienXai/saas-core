"use client"

import { useMemo, useState } from "react"
import { Building2, Check, CheckCircle2, Clock3, Crown, Mail, Send, ShieldCheck, Store, Trash2, UserPlus, Users, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Badge } from "@/components/ui/badge"
import { toast } from "sonner"
import { useLanguage } from "@/context/language-context"
import type { TranslationKey } from "@/i18n"
import { formatDate as formatLocalizedDate } from "@/i18n"
import {
  createWorkspaceInvitation,
  removeWorkspaceMember,
  resendWorkspaceInvitation,
  revokeWorkspaceInvitation,
  updateWorkspaceMember,
} from "@/app/manage/team/actions"

type Role = "admin" | "manager" | "staff"
type Restaurant = { id: string; name: string; slug: string; status: string }
type Member = {
  id: string
  userId: string
  email: string
  name: string | null
  role: string
  restaurantAccessMode: string
  restaurantIds: string[]
  createdAt: string
  isOwner: boolean
}
type Invitation = {
  id: string
  email: string
  role: string
  restaurantAccessMode: string
  restaurantIds: string[]
  expiresAt: string
  status: string
  emailDeliveryStatus: string
  deliveryError: string | null
}
type TeamData = {
  workspace: { id: string; name: string; slug: string }
  currentRole: string
  members: Member[]
  invitations: Invitation[]
  restaurants: Restaurant[]
  entitlements: { planName: string; limits: { users: number | null } }
  usage: { users: number; pendingInvitations: number; seatUsage: number }
}

type Translation = (key: TranslationKey, replacements?: Record<string, string>) => string
type ActionResult = { success: boolean; message?: string; warning?: string | null }

const selectClass = "h-11 w-full rounded-xl border border-slate-200/90 bg-white/90 px-3 text-sm font-semibold text-slate-800 shadow-sm outline-none transition focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 dark:border-white/10 dark:bg-[#15161c] dark:text-slate-100"

function roleLabel(role: string, getTranslation: Translation) {
  const labels: Record<string, TranslationKey> = {
    owner: "team.roleOwner",
    admin: "team.roleAdmin",
    manager: "team.roleManager",
    staff: "team.roleStaff",
  }
  return labels[role] ? getTranslation(labels[role]) : role
}

function statusLabel(status: string, getTranslation: Translation) {
  const labels: Record<string, TranslationKey> = {
    pending: "team.statusPending",
    revoked: "team.statusRevoked",
    expired: "team.statusExpired",
  }
  return labels[status] ? getTranslation(labels[status]) : status
}

function accessLabel(mode: string, ids: string[], restaurants: Restaurant[], getTranslation: Translation) {
  if (mode === "all") return getTranslation("team.allRestaurants")
  return restaurants.filter((restaurant) => ids.includes(restaurant.id)).map((restaurant) => restaurant.name).join(", ") || getTranslation("team.selectedRestaurants")
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean)
  if (parts.length > 1) return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase()
  return value.slice(0, 2).toUpperCase() || "RV"
}

function roleBadgeClass(role: string) {
  if (role === "owner") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"
  if (role === "admin") return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-200"
  if (role === "manager") return "border-sky-200 bg-sky-50 text-sky-700 dark:border-sky-400/20 dark:bg-sky-500/10 dark:text-sky-200"
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
}

function invitationStatusClass(status: string) {
  if (status === "pending") return "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-500/10 dark:text-emerald-200"
  if (status === "expired") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"
  return "border-slate-200 bg-slate-50 text-slate-500 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-400"
}

function SummaryCard({ label, value, detail, icon: Icon, tone }: { label: string; value: string | number; detail: string; icon: typeof Users; tone: "violet" | "blue" | "amber" | "emerald" }) {
  const tones = {
    violet: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200",
    blue: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-200",
    amber: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-200",
    emerald: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-200",
  }

  return (
    <Card className="border-0 bg-white/80 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10">
      <CardContent className="p-4 sm:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="min-h-[2rem] text-[10px] font-bold uppercase leading-4 tracking-[0.1em] text-slate-400 dark:text-slate-500 sm:min-h-0 sm:text-[11px] sm:tracking-[0.12em]">{label}</p>
            <p className="mt-1 break-words text-xl font-bold leading-tight tracking-tight text-slate-950 dark:text-white sm:mt-2 sm:text-2xl">{value}</p>
          </div>
          <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl ${tones[tone]}`}><Icon className="h-5 w-5" /></span>
        </div>
        <p className="mt-2 min-h-[2rem] text-[10px] font-medium leading-4 text-slate-500 dark:text-slate-400 sm:mt-3 sm:min-h-0 sm:text-xs">{detail}</p>
      </CardContent>
    </Card>
  )
}

function SectionHeading({ icon: Icon, title, description, count }: { icon: typeof Users; title: string; description?: string; count?: string | number }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-white/10 sm:px-6 sm:py-5">
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0">
          <h2 className="text-base font-bold tracking-tight text-slate-950 dark:text-white">{title}</h2>
          {description && <p className="mt-1 max-w-xl text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>}
        </div>
      </div>
      {count !== undefined && <span className="shrink-0 rounded-full bg-slate-100 px-2.5 py-1 text-xs font-bold tabular-nums text-slate-600 dark:bg-white/[0.07] dark:text-slate-300">{count}</span>}
    </div>
  )
}

function MemberControls({ member, data, roleOptions, busy, runAction, getTranslation }: { member: Member; data: TeamData; roleOptions: string[]; busy: boolean; runAction: (action: () => Promise<ActionResult>) => Promise<boolean>; getTranslation: Translation }) {
  const [role, setRole] = useState<Role>(member.role as Role)
  const [accessMode, setAccessMode] = useState<"all" | "selected">(member.restaurantAccessMode as "all" | "selected")
  const [restaurantIds, setRestaurantIds] = useState(member.restaurantIds)
  const targetRoleOptions = member.role === "admin" && data.currentRole === "owner" ? ["admin", "manager", "staff"] : roleOptions

  async function save(nextRole: Role, nextMode: "all" | "selected", nextIds: string[]) {
    const result = await runAction(() => updateWorkspaceMember({
      memberId: member.id,
      role: nextRole,
      restaurantAccessMode: nextRole === "admin" ? "all" : nextMode,
      restaurantIds: nextIds,
    }))
    if (result) {
      setRole(nextRole)
      setAccessMode(nextRole === "admin" ? "all" : nextMode)
      setRestaurantIds(nextIds)
    }
  }

  return (
    <div className="w-full min-w-0 xl:max-w-[27rem]">
      <div className="grid grid-cols-2 gap-2">
        <select aria-label={getTranslation("team.roleFor", { email: member.email })} value={role} onChange={(event) => void save(event.target.value as Role, accessMode, restaurantIds)} className={selectClass} disabled={busy}>
          {targetRoleOptions.map((option) => <option key={option} value={option}>{roleLabel(option, getTranslation)}</option>)}
        </select>
        <select aria-label={getTranslation("team.accessFor", { email: member.email })} value={role === "admin" ? "all" : accessMode} onChange={(event) => {
          const nextMode = event.target.value as "all" | "selected"
          setAccessMode(nextMode)
          if (nextMode === "all") void save(role, "all", [])
        }} className={selectClass} disabled={busy || role === "admin" || data.restaurants.length <= 1}>
          <option value="all">{getTranslation("team.allRestaurants")}</option>
          <option value="selected">{getTranslation("team.selectedRestaurants")}</option>
        </select>
      </div>
      {role !== "admin" && accessMode === "selected" && data.restaurants.length > 1 && (
        <div className="mt-2 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-3 dark:border-violet-400/20 dark:bg-violet-500/10">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-violet-700 dark:text-violet-200">{getTranslation("team.selectedRestaurants")}</p>
          <div className="grid gap-1.5 sm:grid-cols-2">
            {data.restaurants.map((restaurant) => <label key={restaurant.id} className="flex min-h-9 min-w-0 items-center gap-2 rounded-xl px-2 text-xs font-medium text-slate-700 hover:bg-white/70 dark:text-slate-200 dark:hover:bg-white/[0.06]"><input className="h-4 w-4 accent-violet-600" type="checkbox" checked={restaurantIds.includes(restaurant.id)} onChange={(event) => setRestaurantIds((current) => event.target.checked ? [...current, restaurant.id] : current.filter((id) => id !== restaurant.id))} /> <span className="truncate">{restaurant.name}</span></label>)}
          </div>
          <Button className="mt-2 w-full rounded-xl bg-violet-600 font-bold shadow-md shadow-violet-600/15 hover:bg-violet-700 sm:w-auto" size="sm" loading={busy} disabled={restaurantIds.length === 0} onClick={() => void save(role, "selected", restaurantIds)}><Check className="h-4 w-4" />{getTranslation("team.saveAccess")}</Button>
        </div>
      )}
      <Button variant="outline" size="sm" loading={busy} className="mt-2 h-10 w-full rounded-xl border-slate-200/90 font-bold text-rose-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-700 dark:border-white/10 dark:text-rose-300 dark:hover:border-rose-400/20 dark:hover:bg-rose-500/10 sm:w-auto" onClick={() => void runAction(() => removeWorkspaceMember(member.id))}><Trash2 className="h-4 w-4" />{getTranslation("team.remove")}</Button>
    </div>
  )
}

export function TeamManagement({ initialData }: { initialData: TeamData }) {
  const { currentLang, getTranslation, translateMessage } = useLanguage()
  const [data] = useState(initialData)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("staff")
  const [accessMode, setAccessMode] = useState<"all" | "selected">("all")
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const visibleInvitations = data.invitations.filter((invitation) => invitation.status !== "accepted")
  const canInvite = data.usage.seatUsage < (data.entitlements.limits.users ?? Number.MAX_SAFE_INTEGER)
  const roleOptions = useMemo(() => data.currentRole === "owner" ? ["admin", "manager", "staff"] : ["manager", "staff"], [data.currentRole])
  const seatLimit = data.entitlements.limits.users
  const seatPercent = seatLimit === null || seatLimit <= 0 ? 0 : Math.min(Math.round((data.usage.seatUsage / seatLimit) * 100), 100)
  const seatLimitLabel = seatLimit === null ? getTranslation("marketing.unlimited") : String(seatLimit)

  async function refresh() {
    window.location.reload()
  }

  async function invite() {
    setBusy(true)
    const inviteRestaurantIds = selectedIds.length ? selectedIds : data.restaurants.length === 1 ? [data.restaurants[0].id] : []
    const result = await createWorkspaceInvitation({ email, role, restaurantAccessMode: role === "admin" ? "all" : accessMode, restaurantIds: inviteRestaurantIds })
    setBusy(false)
    if (!result.success) {
      toast.error(translateMessage(result.message || getTranslation("team.actionFailed")))
      return
    }
    toast.success(translateMessage(result.warning || getTranslation("team.invitationCreated")))
    setEmail("")
    await refresh()
  }

  async function runAction(action: () => Promise<ActionResult>) {
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (!result.success) {
      toast.error(translateMessage(result.message || getTranslation("team.actionFailed")))
      return false
    }
    toast.success(translateMessage(result.warning || getTranslation("team.actionCompleted")))
    await refresh()
    return true
  }

  return (
    <div className="mx-auto w-full max-w-[1440px] pb-10">
      <section className="relative overflow-hidden rounded-[28px] bg-[#17142d] px-5 py-6 text-white shadow-2xl shadow-violet-950/20 sm:px-7 sm:py-8 max-[600px]:rounded-[22px] max-[600px]:px-4 max-[600px]:py-5">
        <div className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-violet-500/35 blur-3xl" />
        <div className="pointer-events-none absolute bottom-0 left-1/3 h-44 w-64 rounded-full bg-indigo-400/20 blur-3xl" />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between max-[600px]:gap-5">
          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-xs font-semibold text-violet-200 max-[600px]:mb-2 max-[600px]:text-[10px]"><span className="flex h-6 w-6 items-center justify-center rounded-lg bg-white/10 max-[600px]:h-5 max-[600px]:w-5"><Users className="h-3.5 w-3.5 max-[600px]:h-3 max-[600px]:w-3" /></span><span>{getTranslation("team.label")}</span><span className="h-1 w-1 rounded-full bg-violet-300/60" /><span className="text-violet-200/70">{getTranslation("manage.common.workspace")}</span></div>
            <h1 className="max-w-3xl truncate text-3xl font-bold tracking-tight sm:text-4xl max-[600px]:text-2xl">{data.workspace.name}</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-indigo-100/75 max-[600px]:mt-1.5 max-[600px]:text-xs max-[600px]:leading-5">{getTranslation("team.description")}</p>
          </div>
          <div className="w-full max-w-[22rem] shrink-0 rounded-[22px] border border-white/10 bg-white/[0.08] p-4 backdrop-blur-sm max-[600px]:rounded-2xl max-[600px]:p-3.5">
            <div className="flex items-center justify-between gap-3 text-xs font-semibold text-indigo-100/75"><span>{getTranslation("team.seats")}</span><span className="font-bold tabular-nums text-white">{data.usage.seatUsage} / {seatLimitLabel}</span></div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/10"><div className={`h-full rounded-full transition-all ${canInvite ? "bg-gradient-to-r from-violet-300 to-indigo-300" : "bg-rose-300"}`} style={{ width: `${Math.max(seatPercent, data.usage.seatUsage > 0 ? 5 : 0)}%` }} /></div>
            <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-indigo-100/65"><span>{getTranslation("team.seatsDescription")}</span><span className="flex shrink-0 items-center gap-1.5 rounded-full bg-white/10 px-2 py-1 font-bold text-indigo-100"><ShieldCheck className="h-3 w-3" />{roleLabel(data.currentRole, getTranslation)}</span></div>
          </div>
        </div>
      </section>

      <section className="mt-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <SummaryCard label={getTranslation("team.members")} value={data.members.length} detail={getTranslation("team.activeMembers")} icon={Users} tone="violet" />
        <SummaryCard label={getTranslation("team.pendingInvitations")} value={visibleInvitations.filter((invitation) => invitation.status === "pending").length} detail={getTranslation("team.pendingDescription")} icon={Clock3} tone="amber" />
        <SummaryCard label={getTranslation("manage.sidebar.restaurants")} value={data.restaurants.length} detail={getTranslation("team.locationsDescription")} icon={Store} tone="blue" />
        <SummaryCard label={getTranslation("team.plan")} value={data.entitlements.planName} detail={getTranslation("team.planDescription")} icon={Crown} tone="emerald" />
      </section>

      <Card className="mt-5 overflow-hidden border-0 bg-white/80 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10"><CardContent className="p-0"><div className="flex items-start gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-white/10 sm:px-6 sm:py-5"><span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-600/20"><UserPlus className="h-5 w-5" /></span><div className="min-w-0"><h2 className="text-base font-bold tracking-tight text-slate-950 dark:text-white">{getTranslation("team.inviteMember")}</h2><p className="mt-1 text-xs leading-5 text-slate-500 dark:text-slate-400">{getTranslation("team.inviteDescription")}</p></div></div><div className="p-5 sm:p-6"><div className="grid gap-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(150px,0.55fr)_minmax(0,1fr)_auto] lg:items-end"><div className="space-y-2"><Label htmlFor="invite-email" className="text-xs font-bold text-slate-600 dark:text-slate-300">{getTranslation("team.email")}</Label><div className="relative"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" disabled={!canInvite || busy} className="h-11 rounded-xl border-slate-200/90 bg-white/90 pl-10 shadow-sm dark:border-white/10 dark:bg-[#15161c]" /></div></div><div className="space-y-2"><Label htmlFor="invite-role" className="text-xs font-bold text-slate-600 dark:text-slate-300">{getTranslation("team.role")}</Label><select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)} className={selectClass} disabled={busy}>{roleOptions.map((option) => <option key={option} value={option}>{roleLabel(option, getTranslation)}</option>)}</select></div><div className="space-y-2"><Label htmlFor="invite-access" className="text-xs font-bold text-slate-600 dark:text-slate-300">{getTranslation("team.restaurantAccess")}</Label><select id="invite-access" value={role === "admin" ? "all" : accessMode} onChange={(event) => setAccessMode(event.target.value as typeof accessMode)} className={selectClass} disabled={role === "admin" || busy}><option value="all">{getTranslation("team.allRestaurants")}</option><option value="selected">{getTranslation("team.selectedRestaurants")}</option></select></div><Button onClick={invite} loading={busy} disabled={!canInvite || !email.trim() || (role !== "admin" && accessMode === "selected" && selectedIds.length === 0)} className="h-11 w-full rounded-xl bg-violet-600 px-5 font-bold shadow-md shadow-violet-600/20 hover:bg-violet-700 lg:w-auto"><Send className="h-4 w-4" />{getTranslation("team.invite")}</Button></div>{role !== "admin" && accessMode === "selected" && data.restaurants.length > 1 && <div className="mt-4 rounded-2xl border border-violet-200/80 bg-violet-50/60 p-3.5 dark:border-violet-400/20 dark:bg-violet-500/10"><div className="mb-2 flex items-center gap-2 text-xs font-bold text-violet-800 dark:text-violet-100"><Building2 className="h-4 w-4" />{getTranslation("team.selectRestaurants")}</div><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{data.restaurants.map((restaurant) => <label key={restaurant.id} className="flex min-h-11 min-w-0 items-center gap-3 rounded-xl border border-violet-200/70 bg-white/65 px-3 text-sm font-semibold text-slate-700 transition hover:bg-white dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-200"><input className="h-4 w-4 accent-violet-600" type="checkbox" checked={selectedIds.includes(restaurant.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...current, restaurant.id] : current.filter((id) => id !== restaurant.id))} /><span className="truncate">{restaurant.name}</span></label>)}</div></div>}{!canInvite && <div className="mt-4 flex items-start gap-2.5 rounded-2xl border border-amber-200/80 bg-amber-50/70 p-3.5 text-xs leading-5 text-amber-900 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-100"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />{getTranslation("team.noSeats")}</div>}</div></CardContent></Card>

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.22fr)_minmax(360px,0.78fr)]"><Card className="overflow-hidden border-0 bg-white/80 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10"><CardContent className="p-0"><SectionHeading icon={Users} title={getTranslation("team.members")} description={getTranslation("team.membersDescription")} count={data.members.length} /><div className="divide-y divide-slate-200/80 dark:divide-white/10">{data.members.length === 0 && <div className="px-5 py-12 text-center text-sm text-slate-500 dark:text-slate-400">{getTranslation("team.noMembers")}</div>}{data.members.map((member) => { const displayName = member.name || member.email; return <div key={member.id} className="p-5 sm:p-6"><div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between"><div className="flex min-w-0 items-start gap-3"><span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl text-sm font-bold text-white shadow-sm ${member.isOwner ? "bg-gradient-to-br from-amber-400 to-orange-500" : "bg-gradient-to-br from-violet-600 to-indigo-500"}`}>{initials(displayName)}</span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="max-w-full truncate text-sm font-bold text-slate-950 dark:text-white">{displayName}</p>{member.isOwner && <Badge className="border-amber-200 bg-amber-50 text-[10px] font-bold text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"><Crown className="mr-1 h-3 w-3" />{getTranslation("team.roleOwner")}</Badge>}</div><p className="mt-1 flex min-w-0 items-center gap-1.5 truncate text-xs text-slate-500 dark:text-slate-400"><Mail className="h-3.5 w-3.5 shrink-0" />{member.email}</p><div className="mt-3 flex flex-wrap items-center gap-2"><Badge className={`font-bold ${roleBadgeClass(member.role)}`}>{roleLabel(member.role, getTranslation)}</Badge><span className="inline-flex min-w-0 items-center gap-1.5 text-xs font-medium text-slate-500 dark:text-slate-400"><Building2 className="h-3.5 w-3.5 shrink-0" /><span className="break-words">{accessLabel(member.restaurantAccessMode, member.restaurantIds, data.restaurants, getTranslation)}</span></span></div></div></div>{!member.isOwner ? <MemberControls member={member} data={data} roleOptions={roleOptions} busy={busy} runAction={runAction} getTranslation={getTranslation} /> : <div className="flex items-center gap-2 rounded-xl bg-amber-50/70 px-3 py-2 text-xs font-semibold text-amber-700 dark:bg-amber-500/10 dark:text-amber-200"><ShieldCheck className="h-4 w-4" />{getTranslation("team.ownerAccess")}</div>}</div></div> })}</div></CardContent></Card><Card className="h-fit overflow-hidden border-0 bg-white/80 shadow-sm ring-1 ring-slate-200/70 dark:bg-white/[0.04] dark:ring-white/10"><CardContent className="p-0"><SectionHeading icon={Mail} title={getTranslation("team.pendingInvitations")} description={getTranslation("team.pendingDescription")} count={visibleInvitations.length} /><div className="space-y-3 p-5 sm:p-6">{visibleInvitations.length === 0 && <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50/70 px-4 py-10 text-center dark:border-white/10 dark:bg-white/[0.03]"><CheckCircle2 className="mx-auto h-8 w-8 text-emerald-500" /><p className="mt-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{getTranslation("team.noPendingInvitations")}</p></div>}{visibleInvitations.map((invitation) => <div key={invitation.id} className="rounded-2xl border border-slate-200/80 bg-slate-50/60 p-4 dark:border-white/10 dark:bg-white/[0.03]"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2.5"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Mail className="h-4 w-4" /></span><div className="min-w-0"><p className="truncate text-sm font-bold text-slate-900 dark:text-white">{invitation.email}</p><p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500 dark:text-slate-400"><Clock3 className="h-3 w-3" />{getTranslation("team.expires", { date: formatLocalizedDate(invitation.expiresAt, currentLang) })}</p></div></div><Badge className={`shrink-0 font-bold ${invitationStatusClass(invitation.status)}`}>{statusLabel(invitation.status, getTranslation)}</Badge></div><div className="mt-3 flex items-start gap-2 text-xs font-medium text-slate-500 dark:text-slate-400"><Building2 className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span className="break-words">{accessLabel(invitation.restaurantAccessMode, invitation.restaurantIds, data.restaurants, getTranslation)}</span></div>{invitation.emailDeliveryStatus === "failed" && <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"><XCircle className="h-3.5 w-3.5" />{getTranslation("team.deliveryIssue")}</p>}<div className="mt-4 grid grid-cols-2 gap-2"><Button variant="outline" size="sm" loading={busy} disabled={invitation.status === "revoked"} className="h-10 rounded-xl border-slate-200/90 font-bold dark:border-white/10" onClick={() => void runAction(() => resendWorkspaceInvitation(invitation.id))}><Send className="h-3.5 w-3.5" />{getTranslation("team.resend")}</Button><Button variant="ghost" size="sm" loading={busy} disabled={invitation.status === "revoked"} className="h-10 rounded-xl font-bold text-slate-500 hover:bg-rose-50 hover:text-rose-700 dark:text-slate-400 dark:hover:bg-rose-500/10 dark:hover:text-rose-300" onClick={() => void runAction(() => revokeWorkspaceInvitation(invitation.id))}><Trash2 className="h-3.5 w-3.5" />{getTranslation("team.revoke")}</Button></div></div>)}</div></CardContent></Card></div>
    </div>
  )
}
