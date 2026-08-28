"use client"

import type React from "react"
import Link from "next/link"
import { useState } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthField, AuthShell } from "@/components/auth/auth-shell"
import { useLanguage } from "@/context/language-context"
import { getBrowserAuthOrigin } from "@/lib/request-url"

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState(false)
  const [loading, setLoading] = useState(false)
  const { getTranslation } = useLanguage()

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (loading) return
    setLoading(true)
    await getSupabaseBrowserClient().auth.resetPasswordForEmail(email.trim(), { redirectTo: `${getBrowserAuthOrigin()}/auth/confirm?next=/reset-password` })
    setLoading(false)
    setSent(true)
  }

  return <AuthShell title={getTranslation("auth.resetTitle")} description={getTranslation("auth.resetDescription")} footer={<Link className="auth-footer-link" href="/login">{getTranslation("auth.backToSignIn")}</Link>}>
    {sent && <Alert className="auth-alert auth-success-alert"><AlertDescription>{getTranslation("auth.resetSent")}</AlertDescription></Alert>}
    <form onSubmit={submit} className="auth-form">
      <AuthField id="forgot-email" label={getTranslation("auth.email")}>
        <div className="auth-input-shell">
          <Mail className="auth-input-icon" aria-hidden="true" strokeWidth={1.75} />
          <Input className="auth-input" id="forgot-email" name="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required />
        </div>
      </AuthField>
      <Button type="submit" className="auth-primary-button" loading={loading}>{loading ? getTranslation("auth.sending") : getTranslation("auth.sendResetLink")}</Button>
    </form>
  </AuthShell>
}
