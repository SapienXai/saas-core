"use client"

import { useState } from "react"
import { CheckCircle2, Clock3, Crown, Mail, MoreHorizontal, Send, ShieldCheck, Trash2, UserPlus, Users, XCircle } from "lucide-react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useConfirmationDialog } from "@/components/ui/confirmation-dialog"
import { ManageEmptyState, ManageListRow, ManageMetricCard, ManageMetricGrid, ManagePage, ManagePageHeader, ManageSurface } from "@/components/manage/manage-responsive"
import { createWorkspaceInvitation, removeWorkspaceMember, resendWorkspaceInvitation, revokeWorkspaceInvitation, updateWorkspaceMember } from "@/app/manage/team/actions"

type Role = "admin" | "manager" | "staff"
type Member = { id: string; userId: string; email: string; name: string | null; role: string; createdAt: string; isOwner: boolean }
type Invitation = { id: string; email: string; role: string; expiresAt: string; status: string; emailDeliveryStatus: string }
type TeamData = { workspace: { id: string; name: string; slug: string }; currentRole: string; members: Member[]; invitations: Invitation[]; entitlements: { planName: string; limits: Record<string, number | null | undefined> }; usage: { users: number; pendingInvitations: number; seatUsage: number } }
type ActionResult = { success: boolean; message?: string; warning?: string | null }

const roles: Role[] = ["admin", "manager", "staff"]
const inputClass = "h-11 rounded-xl border-slate-200 bg-white dark:border-white/10 dark:bg-white/[0.04]"

function roleTone(role: string) {
  if (role === "owner") return "border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"
  if (role === "admin") return "border-violet-200 bg-violet-50 text-violet-700 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-200"
  return "border-slate-200 bg-slate-50 text-slate-600 dark:border-white/10 dark:bg-white/[0.05] dark:text-slate-300"
}

export function TeamManagement({ initialData }: { initialData: TeamData }) {
  const [data] = useState(initialData)
  const [inviteOpen, setInviteOpen] = useState(false)
  const [editMember, setEditMember] = useState<Member | null>(null)
  const [email, setEmail] = useState("")
  const [role, setRole] = useState<Role>("staff")
  const [busy, setBusy] = useState(false)
  const pending = data.invitations.filter((item) => item.status === "pending")
  const memberLimit = Object.prototype.hasOwnProperty.call(data.entitlements.limits, "core.members") ? data.entitlements.limits["core.members"] : undefined
  const canInvite = memberLimit === null || typeof memberLimit === "number" && data.usage.seatUsage < memberLimit
  const { showConfirmation, ConfirmationDialogComponent } = useConfirmationDialog()

  async function run(action: () => Promise<ActionResult>, successMessage = "Team updated") {
    setBusy(true)
    const result = await action()
    setBusy(false)
    if (!result.success) toast.error(result.message || "The team action could not be completed.")
    else { toast.success(result.warning || successMessage); window.location.reload() }
  }

  function askRemove(member: Member) {
    showConfirmation({
      title: `Remove ${member.name || member.email}?`,
      description: "They will lose access to this workspace immediately.",
      confirmText: "Remove member",
      variant: "destructive",
      onConfirm: () => void run(() => removeWorkspaceMember(member.id), "Member removed"),
    })
  }

  return <ManagePage>
    <ManagePageHeader eyebrow="Workspace" title="Team" description={`${data.workspace.name} · manage access and invitations.`} actions={<Button type="button" className="min-h-11 rounded-xl" onClick={() => setInviteOpen(true)} disabled={!canInvite}><UserPlus className="h-4 w-4" />Invite member</Button>} />
    <ManageMetricGrid>
      <ManageMetricCard label="Members" value={data.members.length} detail="Current access" icon={Users} />
      <ManageMetricCard label="Pending" value={pending.length} detail="Invitations" icon={Clock3} />
      <ManageMetricCard label="Seats" value={`${data.usage.seatUsage}${memberLimit === undefined ? " / —" : memberLimit === null ? "" : ` / ${memberLimit}`}`} detail={memberLimit === undefined ? "Limit unavailable" : memberLimit === null ? "Unlimited" : "Plan limit"} icon={ShieldCheck} />
      <ManageMetricCard label="Your role" value={data.currentRole} detail="Workspace access" icon={Crown} />
    </ManageMetricGrid>
    {memberLimit === undefined ? <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />The current plan's team-seat limit is unavailable.</div> : !canInvite ? <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-800 dark:border-amber-400/20 dark:bg-amber-500/10 dark:text-amber-200"><XCircle className="mt-0.5 h-4 w-4 shrink-0" />The current plan has no available team seats.</div> : null}
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(18rem,.8fr)]">
      <ManageSurface className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-3 dark:border-white/10 sm:px-4"><div><h2 className="text-sm font-semibold text-slate-950 dark:text-white">Members</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Roles can be changed from each member’s menu.</p></div><Users className="h-4 w-4 text-violet-600 dark:text-violet-300" /></div>
        <div className="divide-y divide-slate-100 dark:divide-white/10">
          {data.members.length === 0 ? <ManageEmptyState title="No members yet" description="Invite someone to start collaborating." compact /> : data.members.map((member) => <ManageListRow key={member.id} title={member.name || member.email} subtitle={member.name ? member.email : undefined} meta={<Badge className={`rounded-full text-[10px] ${roleTone(member.role)}`}>{member.role}</Badge>} action={member.isOwner ? <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-300"><Crown className="h-3.5 w-3.5" />Owner</span> : <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon" className="h-10 w-10 shrink-0" aria-label={`Actions for ${member.email}`}><MoreHorizontal className="h-4 w-4" /></Button></DropdownMenuTrigger><DropdownMenuContent align="end"><DropdownMenuItem onSelect={() => setEditMember(member)}>Change role</DropdownMenuItem><DropdownMenuItem className="text-rose-600 focus:text-rose-600" onSelect={() => askRemove(member)}><Trash2 className="h-4 w-4" />Remove member</DropdownMenuItem></DropdownMenuContent></DropdownMenu>} />)}
        </div>
      </ManageSurface>
      <ManageSurface className="overflow-hidden">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100 px-3.5 py-3 dark:border-white/10 sm:px-4"><div><h2 className="text-sm font-semibold text-slate-950 dark:text-white">Pending invitations</h2><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Invitations expire after seven days.</p></div><Mail className="h-4 w-4 text-violet-600 dark:text-violet-300" /></div>
        {pending.length === 0 ? <ManageEmptyState icon={CheckCircle2} title="All caught up" description="There are no pending invitations." compact /> : <div className="divide-y divide-slate-100 dark:divide-white/10">{pending.map((invitation) => <ManageListRow key={invitation.id} title={invitation.email} subtitle={`Expires ${new Date(invitation.expiresAt).toLocaleDateString()}`} meta={<Badge className="rounded-full border-emerald-200 bg-emerald-50 text-[10px] text-emerald-700">pending</Badge>} action={<div className="flex shrink-0 items-center gap-1"><Button type="button" variant="ghost" size="icon" className="h-10 w-10" aria-label={`Resend invitation to ${invitation.email}`} disabled={busy} onClick={() => void run(() => resendWorkspaceInvitation(invitation.id), "Invitation resent")}><Send className="h-4 w-4" /></Button><Button type="button" variant="ghost" size="icon" className="h-10 w-10 text-rose-600" aria-label={`Revoke invitation to ${invitation.email}`} disabled={busy} onClick={() => void run(() => revokeWorkspaceInvitation(invitation.id), "Invitation revoked")}><Trash2 className="h-4 w-4" /></Button></div>} />)}</div>}
      </ManageSurface>
    </div>
    <Dialog open={inviteOpen} onOpenChange={setInviteOpen}><DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg"><DialogHeader><DialogTitle>Invite a team member</DialogTitle><DialogDescription>Send a secure invitation to {data.workspace.name}.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><div><Label htmlFor="invite-email">Email</Label><div className="relative mt-1.5"><Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" /><Input id="invite-email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="person@example.com" disabled={busy} className={`${inputClass} pl-10`} /></div></div><div><Label htmlFor="invite-role">Role</Label><select id="invite-role" value={role} onChange={(event) => setRole(event.target.value as Role)} disabled={busy} className={`mt-1.5 w-full px-3 ${inputClass}`}><option value="admin">Admin</option><option value="manager">Manager</option><option value="staff">Staff</option></select></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setInviteOpen(false)}>Cancel</Button><Button type="button" disabled={!email.trim() || busy || !canInvite} loading={busy} onClick={() => void run(() => createWorkspaceInvitation({ email, role }), "Invitation sent")}><Send className="h-4 w-4" />Send invite</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={Boolean(editMember)} onOpenChange={(open) => { if (!open) setEditMember(null) }}><DialogContent className="w-[calc(100%-1rem)] rounded-2xl sm:max-w-md"><DialogHeader><DialogTitle>Change member role</DialogTitle><DialogDescription>{editMember?.email}</DialogDescription></DialogHeader><div><Label htmlFor="member-role">Role</Label><select id="member-role" value={editMember?.role || "staff"} onChange={(event) => setEditMember((current) => current ? { ...current, role: event.target.value } : current)} className={`mt-1.5 w-full px-3 ${inputClass}`}>{roles.map((item) => <option key={item} value={item}>{item}</option>)}</select></div><DialogFooter><Button type="button" variant="outline" onClick={() => setEditMember(null)}>Cancel</Button><Button type="button" disabled={!editMember || busy} loading={busy} onClick={() => { if (editMember) void run(() => updateWorkspaceMember({ memberId: editMember.id, role: editMember.role as Role }), "Role updated") }}>Save role</Button></DialogFooter></DialogContent></Dialog>
    {ConfirmationDialogComponent}
  </ManagePage>
}
