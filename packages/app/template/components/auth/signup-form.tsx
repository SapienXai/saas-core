"use client"

import type React from "react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthField, AuthShell } from "@/components/auth/auth-shell"
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons"
import { PasswordField } from "@/components/auth/password-field"
import { useLanguage } from "@/context/language-context"
import { getDevMailpitUrl } from "@/lib/dev-mailpit"
import { PRODUCT_CONFIG } from "@/lib/product-config"

export function SignupForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirmation, setPasswordConfirmation] = useState("")
  const [confirmationMessage, setConfirmationMessage] = useState("")
  const [error, setError] = useState("")
  const [resending, setResending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [devMailpitUrl, setDevMailpitUrl] = useState<string | null>(null)
  const [redirectPath, setRedirectPath] = useState("/onboarding")
  const { getTranslation } = useLanguage()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requested = params.get("redirect")
    if (requested && requested.startsWith("/") && !requested.startsWith("//")) setRedirectPath(requested)
    if (params.get("confirmation") === "sent") {
      const storedEmail = window.sessionStorage.getItem("saas-core.signup.email") || ""
      if (storedEmail) {
        setEmail(storedEmail)
        window.sessionStorage.removeItem("saas-core.signup.email")
      }
      setConfirmationMessage("sent")
    }
    setHydrated(true)
    setDevMailpitUrl(getDevMailpitUrl(window.location.hostname))
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError("")
    if (password.length < 8) { event.preventDefault(); setError(getTranslation("auth.errors.passwordLength")); return }
    if (password !== passwordConfirmation) { event.preventDefault(); setError(getTranslation("auth.errors.passwordMismatch")); return }
    setSubmitting(true)
    try {
      window.sessionStorage.setItem("saas-core.signup.email", email.trim())
      const response = await fetch("/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), password, redirect: redirectPath }),
      })
      if (!response.ok) {
        setError(getTranslation("auth.errors.serviceUnavailable"))
        setSubmitting(false)
        return
      }
      // Keep the confirmation screen on a real document navigation so the
      // browser does not retain a stale form tree after the auth request.
      window.location.replace(`/signup?redirect=${encodeURIComponent(redirectPath)}&confirmation=sent`)
    } catch {
      setError(getTranslation("auth.errors.serviceUnavailable"))
      setSubmitting(false)
    }
  }

  async function resend() {
    setError("")
    setResending(true)
    try {
      const response = await fetch("/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), redirect: redirectPath }),
      })
      if (!response.ok) setError(getTranslation("auth.errors.resendFailed"))
      else setConfirmationMessage("sent")
    } catch {
      setError(getTranslation("auth.errors.serviceUnavailable"))
    } finally {
      setResending(false)
    }
  }

  function useDifferentEmail() {
    setConfirmationMessage("")
    setPassword("")
    setPasswordConfirmation("")
    setError("")
  }

  return (
    <AuthShell title={getTranslation("auth.signUpTitle")} description={getTranslation("auth.signUpSubtitle", { product: PRODUCT_CONFIG.name })} footer={<span>{getTranslation("auth.alreadyHaveAccount")} <Link className="auth-footer-link" href={`/login?redirect=${encodeURIComponent(redirectPath)}`}>{getTranslation("auth.signInAction")}</Link></span>}>
      {error && <Alert variant="destructive" className="auth-alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {confirmationMessage ? (
        <section className="auth-confirmation rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-emerald-950" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">✓</span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold">{getTranslation("auth.confirmEmail")}</h2>
              <p className="mt-1 text-[13px] leading-5 text-emerald-900">{getTranslation("auth.confirmEmailDescription")}</p>
              <p className="mt-2 break-all rounded-xl border border-emerald-200 bg-white/70 px-3 py-2 text-[13px] font-bold text-emerald-950" aria-label={getTranslation("auth.confirmEmailDestination")}>{email || getTranslation("auth.email")}</p>
            </div>
          </div>
          {devMailpitUrl && <div className="mt-3 rounded-2xl border border-dashed border-emerald-300 bg-white/60 p-3 text-emerald-950"><p className="text-xs font-bold">{getTranslation("auth.developmentInbox")}</p><p className="mt-1 text-[11px] leading-5 text-emerald-800">{getTranslation("auth.developmentInboxDescription")}</p><a className="mt-2 inline-flex h-9 items-center rounded-xl bg-emerald-900 px-3 text-xs font-bold text-white transition-colors hover:bg-emerald-800" href={devMailpitUrl} target="_blank" rel="noreferrer">{getTranslation("auth.openDevelopmentInbox")}</a></div>}
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button type="button" onClick={resend} disabled={resending} className="h-10 rounded-xl border border-emerald-300 bg-white px-3 text-xs font-bold text-emerald-900 transition-colors hover:bg-emerald-100 disabled:cursor-wait disabled:opacity-60">{resending ? getTranslation("auth.sending") : getTranslation("auth.resendEmail")}</button>
            <Link className="inline-flex h-10 items-center justify-center rounded-xl bg-emerald-900 px-3 text-xs font-bold text-white transition-colors hover:bg-emerald-800" href={`/login?redirect=${encodeURIComponent(redirectPath)}`}>{getTranslation("auth.signIn")}</Link>
          </div>
          <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-emerald-800">
            <Link className="font-semibold underline underline-offset-4" href="/forgot-password">{getTranslation("auth.forgotPassword")}</Link>
            <button type="button" onClick={useDifferentEmail} className="font-semibold underline underline-offset-4">{getTranslation("auth.useAnotherEmail")}</button>
          </div>
        </section>
      ) : (
          <div>
          <form method="post" action="/auth/signup" onSubmit={submit} className="auth-form">
            <input type="hidden" name="redirect" value={redirectPath} />
            <AuthField id="signup-email" label={getTranslation("auth.email")}>
              <div className="auth-input-shell">
                <Mail className="auth-input-icon" aria-hidden="true" strokeWidth={1.75} />
                <Input className="auth-input" id="signup-email" name="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required />
              </div>
            </AuthField>
            <AuthField id="signup-password" label={getTranslation("auth.password")}>
              <PasswordField id="signup-password" name="password" label={getTranslation("auth.password")} placeholder={getTranslation("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
            </AuthField>
            <AuthField id="signup-confirmation" label={getTranslation("auth.confirmPassword")}>
              <PasswordField id="signup-confirmation" name="password_confirmation" label={getTranslation("auth.confirmPassword")} placeholder={getTranslation("auth.passwordPlaceholder")} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required />
            </AuthField>
            <SocialAuthButtons redirectPath={redirectPath} onError={setError} />
            <Button type="submit" loading={submitting} disabled={!hydrated} className="auth-primary-button">{submitting ? getTranslation("auth.creatingAccount") : getTranslation("auth.createAccountAction")}</Button>
          </form>
        </div>
      )}
    </AuthShell>
  )
}
