"use client"

import type React from "react"
import Link from "next/link"
import { useState } from "react"
import { useRouter } from "next/navigation"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthField, AuthShell } from "@/components/auth/auth-shell"
import { PasswordField } from "@/components/auth/password-field"
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
    if (loading) return
    setError("")
    if (password.length < 8 || password !== confirmation) { setError(password.length < 8 ? getTranslation("auth.errors.passwordLength") : getTranslation("auth.errors.passwordMismatch")); return }
    setLoading(true)
    const { error: updateError } = await getSupabaseBrowserClient().auth.updateUser({ password })
    setLoading(false)
    if (updateError) { setError(getTranslation("auth.errors.invalidReset")); return }
    router.replace("/login?reset=success")
  }

  return <AuthShell title={getTranslation("auth.newPasswordTitle")} description={getTranslation("auth.newPasswordDescription")} footer={<Link className="auth-footer-link" href="/login">{getTranslation("auth.backToSignIn")}</Link>}>
    {error && <Alert variant="destructive" className="auth-alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <form onSubmit={submit} className="auth-form">
      <AuthField id="new-password" label={getTranslation("auth.newPassword")}>
        <PasswordField id="new-password" name="new_password" label={getTranslation("auth.newPassword")} placeholder={getTranslation("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
      </AuthField>
      <AuthField id="new-password-confirmation" label={getTranslation("auth.confirmPassword")}>
        <PasswordField id="new-password-confirmation" name="new_password_confirmation" label={getTranslation("auth.confirmPassword")} placeholder={getTranslation("auth.passwordPlaceholder")} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required />
      </AuthField>
      <Button type="submit" className="auth-primary-button" loading={loading}>{loading ? getTranslation("auth.updating") : getTranslation("auth.updatePassword")}</Button>
    </form>
  </AuthShell>
}
