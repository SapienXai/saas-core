"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ShieldAlert } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"
import { changePlatformRestaurantStatus, changePlatformUserStatus, changePlatformWorkspaceStatus } from "@/app/platform/actions"

type Target = "user" | "workspace" | "restaurant"

export function PlatformStatusButton({ target, id, status, disabled = false }: { target: Target; id: string; status: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  const nextStatus = status === "suspended" ? "active" : "suspended"
  const requiresReason = target !== "user" || nextStatus === "suspended"
  const verb = nextStatus === "suspended" ? "Suspend" : "Reactivate"
  const targetLabel = target === "user" ? "user account" : target

  function submit() {
    if (requiresReason && reason.trim().length < 3) {
      toast.error("Add a short reason before changing this status.")
      return
    }
    startTransition(async () => {
      const result = target === "user"
        ? await changePlatformUserStatus(id, nextStatus as "active" | "suspended", reason)
        : target === "workspace"
          ? await changePlatformWorkspaceStatus(id, nextStatus, reason)
          : await changePlatformRestaurantStatus(id, nextStatus, reason)
      if (result.success) {
        toast.success(`${targetLabel[0].toUpperCase()}${targetLabel.slice(1)} ${nextStatus === "suspended" ? "suspended" : "reactivated"}`)
        setOpen(false)
        setReason("")
        router.refresh()
      } else toast.error("message" in result ? String(result.message) : "Action failed")
    })
  }

  if (status === "archived") return <span className="text-xs text-slate-500">Archived</span>
  return (
    <>
      <Button type="button" variant="outline" size="sm" disabled={disabled || pending} onClick={() => setOpen(true)} className={nextStatus === "suspended" ? "min-h-9 border-rose-400/30 text-rose-300 hover:bg-rose-500/10" : "min-h-9 border-emerald-400/30 text-emerald-300 hover:bg-emerald-500/10"}>
        {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : verb}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[min(92dvh,38rem)] overflow-y-auto border-white/10 bg-slate-950 text-white sm:rounded-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-white"><ShieldAlert className={nextStatus === "suspended" ? "text-rose-300" : "text-emerald-300"} />{verb} {targetLabel}?</DialogTitle>
            <DialogDescription className="text-left text-slate-400">This is a platform-level change. It is recorded with your identity, the previous state, and the reason.</DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 text-sm font-medium text-slate-300">Reason {requiresReason ? <span className="text-rose-300">required</span> : <span className="text-slate-500">optional</span>}<Textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder={nextStatus === "suspended" ? "Why is this being suspended?" : "Why is this being reactivated?"} className="min-h-24 resize-none border-white/10 bg-white/[0.05] text-white placeholder:text-slate-600" /></label>
          <DialogFooter className="gap-2 sm:gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="min-h-11 border-white/10 text-slate-300">Cancel</Button>
            <Button type="button" onClick={submit} disabled={pending || (requiresReason && reason.trim().length < 3)} className={nextStatus === "suspended" ? "min-h-11 bg-rose-500 text-white hover:bg-rose-400" : "min-h-11 bg-emerald-500 text-slate-950 hover:bg-emerald-400"}>{pending ? "Saving…" : verb}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
