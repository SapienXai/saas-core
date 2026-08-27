"use client"

import type React from "react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthShell, AuthDivider } from "@/components/auth/auth-shell"
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons"
import { PasswordField } from "@/components/auth/password-field"
import { useLanguage } from "@/context/language-context"

export function SignupForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [passwordConfirmation, setPasswordConfirmation] = useState("")
  const [confirmationMessage, setConfirmationMessage] = useState("")
  const [error, setError] = useState("")
  const [resending, setResending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [redirectPath, setRedirectPath] = useState("/onboarding")
  const { getTranslation } = useLanguage()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requested = params.get("redirect")
    const plan = params.get("plan")
    const interval = params.get("interval")
    if (requested && requested.startsWith("/") && !requested.startsWith("//")) setRedirectPath(requested)
    else if (["starter", "pro", "business"].includes(plan || "") && ["month", "year"].includes(interval || "month")) setRedirectPath(`/onboarding?plan=${encodeURIComponent(plan || "")}&interval=${encodeURIComponent(interval || "month")}`)
    if (params.get("confirmation") === "sent") {
      const storedEmail = window.sessionStorage.getItem("saas-core.signup.email") || ""
      if (storedEmail) {
        setEmail(storedEmail)
        window.sessionStorage.removeItem("saas-core.signup.email")
      }
      setConfirmationMessage("sent")
    }
    setHydrated(true)
  }, [])

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
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

  function maskEmail(value: string) {
    const [localPart, domain] = value.trim().split("@")
    if (!localPart || !domain) return getTranslation("auth.email")
    const visible = localPart.length <= 2 ? localPart.slice(0, 1) : localPart.slice(0, 2)
    return `${visible}${"•".repeat(Math.max(2, localPart.length - visible.length))}@${domain}`
  }

  function useDifferentEmail() {
    setConfirmationMessage("")
    setPassword("")
    setPasswordConfirmation("")
    setError("")
  }

  return (
    <AuthShell title={getTranslation("auth.signUp")} description={getTranslation("auth.signUpDescription")} footer={<span>{getTranslation("auth.alreadyHaveAccount")} <Link className="font-semibold text-stone-950 underline-offset-4 hover:underline" href={`/login?redirect=${encodeURIComponent(redirectPath)}`}>{getTranslation("auth.signIn")}</Link></span>}>
      {error && <Alert variant="destructive" className="mb-4 rounded-[11px] border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-900"><AlertDescription>{error}</AlertDescription></Alert>}
      {confirmationMessage ? (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50/80 p-4 text-emerald-950" aria-live="polite">
          <div className="flex items-start gap-3">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">✓</span>
            <div className="min-w-0">
              <h2 className="text-sm font-bold">{getTranslation("auth.confirmEmail")}</h2>
              <p className="mt-1 text-[13px] leading-5 text-emerald-900">{getTranslation("auth.confirmEmailDescription", { email: maskEmail(email) })}</p>
            </div>
          </div>
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
          <SocialAuthButtons redirectPath={redirectPath} onError={setError} />
          <div className="my-3.5"><AuthDivider /></div>
          <form method="post" action="/auth/signup" onSubmit={submit} className="space-y-3">
            <input type="hidden" name="redirect" value={redirectPath} />
            <div className="space-y-1"><Label className="text-[12px] font-semibold" htmlFor="signup-email">{getTranslation("auth.email")}</Label><Input className="h-[42px] rounded-[10px] border-stone-200 bg-white px-3.5 text-[13px] shadow-none placeholder:text-stone-400 focus-visible:border-stone-950 focus-visible:ring-4 focus-visible:ring-stone-950/10" id="signup-email" name="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div>
            <div className="space-y-1"><Label className="text-[12px] font-semibold" htmlFor="signup-password">{getTranslation("auth.password")}</Label><PasswordField id="signup-password" name="password" label={getTranslation("auth.password")} placeholder={getTranslation("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required /></div>
            <div className="space-y-1"><Label className="text-[12px] font-semibold" htmlFor="signup-confirmation">{getTranslation("auth.confirmPassword")}</Label><PasswordField id="signup-confirmation" name="password_confirmation" label={getTranslation("auth.confirmPassword")} placeholder={getTranslation("auth.passwordPlaceholder")} value={passwordConfirmation} onChange={(event) => setPasswordConfirmation(event.target.value)} autoComplete="new-password" minLength={8} required /></div>
            <Button type="submit" loading={submitting} disabled={!hydrated} className="h-[42px] w-full rounded-[10px] bg-stone-950 text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(28,25,23,0.15)] hover:bg-stone-800">{submitting ? getTranslation("auth.creatingAccount") : getTranslation("auth.signUpAction")}</Button>
          </form>
        </div>
      )}
    </AuthShell>
  )
}
