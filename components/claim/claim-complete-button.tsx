"use client"

import { useEffect, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { Check, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/context/language-context"

export function ClaimCompleteButton({ restaurantId, token }: { restaurantId: string; token?: string | null }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const [hydrated, setHydrated] = useState(false)
  const router = useRouter()
  const { getTranslation } = useLanguage()
  useEffect(() => setHydrated(true), [])
  function submit() {
    startTransition(async () => {
      try {
        const response = await fetch("/api/claim/complete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ restaurantId, token }),
        })
        const result = await response.json() as { success?: boolean; status?: string }
        if (result.success) router.replace("/manage")
        else setMessage(result.status === "email_not_verified" ? getTranslation("public.claim.emailNotVerified") : result.status === "shared_domain_manual_review" ? getTranslation("public.claim.sharedDomainReview") : result.status === "email_mismatch" ? getTranslation("public.claim.emailMismatch") : getTranslation("public.claim.failed"))
      } catch {
        setMessage(getTranslation("public.claim.failed"))
      }
    })
  }
  return <div className="space-y-3"><Button type="button" onClick={submit} disabled={!hydrated || pending} className="min-h-11 w-full bg-slate-950 text-white hover:bg-slate-800">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{pending ? getTranslation("public.claim.verifying") : getTranslation("public.claim.verify")}</Button>{message ? <p className="text-sm leading-6 text-amber-800">{message}</p> : null}</div>
}
