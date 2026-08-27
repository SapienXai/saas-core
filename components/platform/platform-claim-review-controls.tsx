"use client"

import { useState, useTransition } from "react"
import { Check, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
import { approvePlatformRestaurantClaimAction, rejectPlatformRestaurantClaimAction } from "@/app/platform/actions"

export function PlatformClaimReviewControls({ claimId, canWrite }: { claimId: string; canWrite: boolean }) {
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()
  function run(action: "approve" | "reject") {
    if (action === "reject" && reason.trim().length < 3) { toast.error("Add a rejection reason."); return }
    startTransition(async () => {
      const result = action === "approve" ? await approvePlatformRestaurantClaimAction(claimId, reason) : await rejectPlatformRestaurantClaimAction(claimId, reason)
      if (result.success) { toast.success(action === "approve" ? "Claim approved" : "Claim rejected"); window.location.reload() } else toast.error(result.message)
    })
  }
  if (!canWrite) return null
  return <div className="mt-3 space-y-2"><Textarea value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Reason for the decision" className="min-h-16 border-white/10 bg-white/[0.04] text-white placeholder:text-slate-600" /><div className="flex flex-wrap gap-2"><Button type="button" disabled={pending} onClick={() => run("approve")} className="min-h-10 gap-2 bg-emerald-500 text-slate-950 hover:bg-emerald-400">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}Approve</Button><Button type="button" disabled={pending} onClick={() => run("reject")} variant="outline" className="min-h-10 gap-2 border-rose-400/30 text-rose-300 hover:bg-rose-500/10"><X className="h-4 w-4" />Reject</Button></div></div>
}
