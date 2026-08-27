"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Loader2, RefreshCw } from "lucide-react"
import { toast } from "sonner"
import { recheckPlatformDomain } from "@/app/platform/actions"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Textarea } from "@/components/ui/textarea"

export function PlatformDomainRefreshButton({ domainId }: { domainId: string }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState("")
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  function submit() {
    startTransition(async () => {
      const result = await recheckPlatformDomain(domainId, reason)
      if (result.success) { toast.success("Domain status rechecked"); setOpen(false); setReason(""); router.refresh() }
      else toast.error("message" in result ? String(result.message) : "Domain check failed")
    })
  }
  return <><Button type="button" variant="outline" onClick={() => setOpen(true)} disabled={pending} className="min-h-9 border-white/10 text-slate-300">{pending ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="mr-2 h-3.5 w-3.5" />}Recheck</Button><Dialog open={open} onOpenChange={setOpen}><DialogContent className="border-white/10 bg-slate-950 text-white sm:rounded-2xl"><DialogHeader><DialogTitle className="text-white">Recheck domain status?</DialogTitle><DialogDescription className="text-slate-400">This reads the configured provider mapping and may retry provider verification. DNS is never changed by this action.</DialogDescription></DialogHeader><label className="grid gap-2 text-sm font-medium text-slate-300">Reason <span className="text-slate-500">optional</span><Textarea autoFocus value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="What prompted this check?" className="min-h-20 resize-none border-white/10 bg-white/[0.05] text-white placeholder:text-slate-600" /></label><DialogFooter className="gap-2 sm:gap-2"><Button type="button" variant="outline" onClick={() => setOpen(false)} className="min-h-11 border-white/10 text-slate-300">Cancel</Button><Button type="button" onClick={submit} disabled={pending} className="min-h-11 bg-violet-500 text-white hover:bg-violet-400">{pending ? "Checking…" : "Recheck"}</Button></DialogFooter></DialogContent></Dialog></>
}
