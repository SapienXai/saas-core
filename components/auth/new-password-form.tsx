"use client"

import type React from "react"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthShell } from "@/components/auth/auth-shell"
import { useLanguage } from "@/context/language-context"

export function NewPasswordForm() {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmation, setConfirmation] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const { getTranslation } = useLanguage()

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError("")
    if (password.length < 8 || password !== confirmation) { setError(password.length < 8 ? getTranslation("auth.errors.passwordLength") : getTranslation("auth.errors.passwordMismatch")); return }
    setLoading(true)
    const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({ password })
    setLoading(false)
    if (updateError) { setError(getTranslation("auth.errors.invalidReset")); return }
    router.replace("/login?reset=success")
  }

  return <AuthShell title={getTranslation("auth.newPasswordTitle")} description={getTranslation("auth.newPasswordDescription")} footer={null}>
    {error && <Alert variant="destructive" className="mb-4 rounded-xl border-rose-200 bg-rose-50 px-3.5 py-3 text-[13px] text-rose-900"><AlertDescription>{error}</AlertDescription></Alert>}
    <form onSubmit={submit} className="space-y-4"><div className="space-y-1.5"><Label className="text-[13px] font-semibold" htmlFor="new-password">{getTranslation("auth.newPassword")}</Label><Input className="h-11 rounded-xl border-stone-200 bg-stone-50/60 px-3.5 shadow-none focus-visible:border-stone-950 focus-visible:ring-4 focus-visible:ring-stone-950/10" id="new-password" name="new_password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></div><div className="space-y-1.5"><Label className="text-[13px] font-semibold" htmlFor="new-password-confirmation">{getTranslation("auth.confirmPassword")}</Label><Input className="h-11 rounded-xl border-stone-200 bg-stone-50/60 px-3.5 shadow-none focus-visible:border-stone-950 focus-visible:ring-4 focus-visible:ring-stone-950/10" id="new-password-confirmation" name="new_password_confirmation" type="password" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required /></div><Button className="h-11 w-full rounded-xl bg-stone-950 text-sm font-semibold text-white shadow-[0_8px_18px_rgba(28,25,23,0.15)] hover:bg-stone-800" loading={loading}>{loading ? getTranslation("auth.updating") : getTranslation("auth.updatePassword")}</Button></form>
  </AuthShell>
}
