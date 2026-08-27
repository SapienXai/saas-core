"use client"

import type React from "react"
import Link from "next/link"
import { useState } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ReserveviaAuthShell } from "@/components/auth/reservevia-auth-shell"
import { useLanguage } from "@/context/language-context"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const { getTranslation } = useLanguage()

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setLoading(true)
    await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/auth/confirm?next=/reset-password` })
    setLoading(false)
    setSent(true)
  }

  return <ReserveviaAuthShell title={getTranslation("auth.resetTitle")} description={getTranslation("auth.resetDescription")} footer={<Link className="font-semibold text-stone-950 hover:underline" href="/login">{getTranslation("auth.backToSignIn")}</Link>}>
    {sent && <Alert className="mb-4 rounded-xl border-emerald-200 bg-emerald-50 px-3.5 py-3 text-[13px] text-emerald-900"><AlertDescription>{getTranslation("auth.resetSent")}</AlertDescription></Alert>}
    <form onSubmit={submit} className="space-y-4"><div className="space-y-1.5"><Label className="text-[13px] font-semibold" htmlFor="forgot-email">{getTranslation("auth.email")}</Label><Input className="h-11 rounded-xl border-stone-200 bg-stone-50/60 px-3.5 shadow-none focus-visible:border-stone-950 focus-visible:ring-4 focus-visible:ring-stone-950/10" id="forgot-email" name="email" type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div><Button className="h-11 w-full rounded-xl bg-stone-950 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(28,25,23,0.15)] hover:bg-stone-800" loading={loading}>{loading ? getTranslation("auth.sending") : getTranslation("auth.sendResetLink")}</Button></form>
  </ReserveviaAuthShell>
}
