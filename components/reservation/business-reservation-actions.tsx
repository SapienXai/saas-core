"use client"

import { useState, useTransition } from "react"
import { Check, Loader2, X } from "lucide-react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { respondToReservationAction } from "@/app/reservation/manage/[token]/actions"
import { useLanguage } from "@/context/language-context"

export function BusinessReservationActions({ token, status }: { token: string; status: string }) {
  const [pending, startTransition] = useTransition()
  const [message, setMessage] = useState<string | null>(null)
  const router = useRouter()
  const { getTranslation } = useLanguage()
  function respond(decision: "confirmed" | "cancelled") {
    startTransition(async () => {
      const result = await respondToReservationAction(token, decision)
      if (result.success) router.refresh()
      else setMessage(result.message)
    })
  }
  if (status !== "pending") return null
  return <div className="space-y-3"><div className="grid gap-2 sm:grid-cols-2"><Button type="button" disabled={pending} onClick={() => respond("confirmed")} className="min-h-11 gap-2 bg-emerald-700 text-white hover:bg-emerald-800">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{pending ? getTranslation("public.reservationManagement.processing") : getTranslation("public.reservationManagement.accept")}</Button><Button type="button" disabled={pending} onClick={() => respond("cancelled")} variant="outline" className="min-h-11 gap-2 border-rose-200 text-rose-700 hover:bg-rose-50"><X className="h-4 w-4" />{getTranslation("public.reservationManagement.decline")}</Button></div>{message ? <p className="text-sm text-rose-700">{message}</p> : null}</div>
}
