"use client"

import type React from "react"
import Link from "next/link"
import { useEffect, useState } from "react"
import { ArrowUpRight, LoaderCircle, Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthDivider, AuthField, AuthShell } from "@/components/auth/auth-shell"
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons"
import { PasswordField } from "@/components/auth/password-field"
import { useLanguage } from "@/context/language-context"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { getProductOnboardingPath, isDeferredWorkspaceProvisioning, PRODUCT_CONFIG } from "@/lib/product-config"

const RESEND_COOLDOWN_MS = 60_000

const EMAIL_PROVIDER_INBOXES: Readonly<Record<string, string>> = {
  "gmail.com": "https://mail.google.com/mail/u/0/#inbox",
  "googlemail.com": "https://mail.google.com/mail/u/0/#inbox",
  "outlook.com": "https://outlook.live.com/mail/0/inbox",
  "outlook.co.uk": "https://outlook.live.com/mail/0/inbox",
  "outlook.fr": "https://outlook.live.com/mail/0/inbox",
  "outlook.de": "https://outlook.live.com/mail/0/inbox",
  "outlook.es": "https://outlook.live.com/mail/0/inbox",
  "outlook.it": "https://outlook.live.com/mail/0/inbox",
  "outlook.jp": "https://outlook.live.com/mail/0/inbox",
  "hotmail.com": "https://outlook.live.com/mail/0/inbox",
  "hotmail.co.uk": "https://outlook.live.com/mail/0/inbox",
  "hotmail.fr": "https://outlook.live.com/mail/0/inbox",
  "hotmail.de": "https://outlook.live.com/mail/0/inbox",
  "live.com": "https://outlook.live.com/mail/0/inbox",
  "live.co.uk": "https://outlook.live.com/mail/0/inbox",
  "msn.com": "https://outlook.live.com/mail/0/inbox",
  "yahoo.com": "https://mail.yahoo.com/",
  "yahoo.co.uk": "https://mail.yahoo.com/",
  "yahoo.fr": "https://mail.yahoo.com/",
  "yahoo.de": "https://mail.yahoo.com/",
  "yahoo.es": "https://mail.yahoo.com/",
  "yahoo.it": "https://mail.yahoo.com/",
  "yahoo.ca": "https://mail.yahoo.com/",
  "yahoo.com.au": "https://mail.yahoo.com/",
  "yahoo.co.jp": "https://mail.yahoo.com/",
  "ymail.com": "https://mail.yahoo.com/",
  "rocketmail.com": "https://mail.yahoo.com/",
  "icloud.com": "https://www.icloud.com/mail/",
  "me.com": "https://www.icloud.com/mail/",
  "mac.com": "https://www.icloud.com/mail/",
  "proton.me": "https://mail.proton.me/u/0/inbox",
  "protonmail.com": "https://mail.proton.me/u/0/inbox",
  "protonmail.ch": "https://mail.proton.me/u/0/inbox",
  "pm.me": "https://mail.proton.me/u/0/inbox",
}

export function getSupportedEmailAppUrl(emailAddress: string) {
  const parts = emailAddress.trim().toLowerCase().split("@")
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null
  const domain = parts[1]
  return domain ? EMAIL_PROVIDER_INBOXES[domain] ?? null : null
}

export function getResendCooldownSeconds(sentAt: number, now = Date.now()) {
  if (!Number.isFinite(sentAt) || sentAt <= 0) return 0
  return Math.max(0, Math.ceil((sentAt + RESEND_COOLDOWN_MS - now) / 1000))
}

export function isConfirmedEmailUser(
  user: { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null } | null | undefined,
  emailAddress: string,
) {
  return Boolean(
    user?.email && user.email.trim().toLowerCase() === emailAddress.trim().toLowerCase()
    && (user.email_confirmed_at || user.confirmed_at),
  )
}

export function SignupForm({ backHref = "/", initialConfirmationMessage = "" }: { backHref?: string; initialConfirmationMessage?: "sent" | "expired" | "" } = {}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [confirmationMessage, setConfirmationMessage] = useState(initialConfirmationMessage)
  const [error, setError] = useState("")
  const [resending, setResending] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [hydrated, setHydrated] = useState(false)
  const [resendCooldown, setResendCooldown] = useState(0)
  const [continuing, setContinuing] = useState(false)
  const [redirectPath, setRedirectPath] = useState(() => isDeferredWorkspaceProvisioning() ? getProductOnboardingPath() : "/onboarding")
  const { getTranslation } = useLanguage()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const requested = params.get("redirect")
    if (requested && requested.startsWith("/") && !requested.startsWith("//")) setRedirectPath(requested)
    const confirmation = params.get("confirmation")
    if (confirmation === "sent" || confirmation === "expired" || params.get("error") === "invalid_confirmation") {
      const storedEmail = window.sessionStorage.getItem("saas-core.signup.email") || ""
      if (storedEmail) setEmail(storedEmail)
      setConfirmationMessage(confirmation === "expired" || params.get("error") === "invalid_confirmation" ? "expired" : "sent")
    }
    if (params.get("error") === "email_rate_limited") {
      setError(getTranslation("auth.errors.emailRateLimited"))
    }
    setHydrated(true)
  }, [getTranslation])

  useEffect(() => {
    if (!confirmationMessage) return
    let sentAt = Number(window.sessionStorage.getItem("saas-core.signup.sentAt"))
    if (confirmationMessage === "sent" && (!Number.isFinite(sentAt) || sentAt <= 0)) {
      sentAt = Date.now()
      window.sessionStorage.setItem("saas-core.signup.sentAt", String(sentAt))
    }
    const updateCooldown = () => {
      const storedSentAt = Number(window.sessionStorage.getItem("saas-core.signup.sentAt"))
      setResendCooldown(getResendCooldownSeconds(storedSentAt, Date.now()))
    }
    updateCooldown()
    const interval = window.setInterval(updateCooldown, 1000)
    return () => window.clearInterval(interval)
  }, [confirmationMessage])

  useEffect(() => {
    if (!confirmationMessage || !email.trim()) return
    let active = true
    let navigating = false
    let checking = false
    let supabase: ReturnType<typeof getSupabaseBrowserClient>
    try {
      supabase = getSupabaseBrowserClient()
    } catch {
      return
    }
    const continueIfConfirmed = (user: { email?: string | null; email_confirmed_at?: string | null; confirmed_at?: string | null } | null | undefined) => {
      if (!active || navigating || !isConfirmedEmailUser(user, email)) return
      navigating = true
      setContinuing(true)
      window.location.replace(`/auth/continue?redirect=${encodeURIComponent(redirectPath)}`)
    }
    const checkAuthoritativeUser = async () => {
      if (!active || checking || document.visibilityState !== "visible") return
      checking = true
      try {
        const { data, error: authError } = await supabase.auth.getUser()
        if (!authError) continueIfConfirmed(data.user)
      } catch {
        // Keep the confirmation screen available if the Auth service is temporarily unreachable.
      } finally {
        checking = false
      }
    }
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      continueIfConfirmed(session?.user)
    })
    const interval = window.setInterval(() => { void checkAuthoritativeUser() }, 8000)
    const onFocus = () => { void checkAuthoritativeUser() }
    const onVisibilityChange = () => { if (document.visibilityState === "visible") void checkAuthoritativeUser() }
    window.addEventListener("focus", onFocus)
    document.addEventListener("visibilitychange", onVisibilityChange)
    void checkAuthoritativeUser()
    return () => {
      active = false
      subscription.unsubscribe()
      window.clearInterval(interval)
      window.removeEventListener("focus", onFocus)
      document.removeEventListener("visibilitychange", onVisibilityChange)
    }
  }, [confirmationMessage, email, redirectPath])

  async function getAuthFailureMessage(response: Response, fallback: string) {
    try {
      const payload = await response.json() as { error?: unknown }
      if (payload.error === "email_rate_limited") return getTranslation("auth.errors.emailRateLimited")
    } catch {
      // Keep the existing generic message for non-JSON and transport failures.
    }
    return fallback
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return
    setError("")
    if (password.length < 8) { event.preventDefault(); setError(getTranslation("auth.errors.passwordLength")); return }
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
        setError(await getAuthFailureMessage(response, getTranslation("auth.errors.serviceUnavailable")))
        setSubmitting(false)
        return
      }
      window.sessionStorage.setItem("saas-core.signup.sentAt", String(Date.now()))
      // Keep the confirmation screen on a real document navigation so the
      // browser does not retain a stale form tree after the auth request.
      window.location.replace(`/signup?redirect=${encodeURIComponent(redirectPath)}&confirmation=sent`)
    } catch {
      setError(getTranslation("auth.errors.serviceUnavailable"))
      setSubmitting(false)
    }
  }

  async function resend() {
    if (resending || resendCooldown > 0 || !email.trim()) return
    setError("")
    setResending(true)
    try {
      const response = await fetch("/auth/resend", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), redirect: redirectPath }),
      })
      if (!response.ok) setError(await getAuthFailureMessage(response, getTranslation("auth.errors.resendFailed")))
      else {
        window.sessionStorage.setItem("saas-core.signup.email", email.trim())
        window.sessionStorage.setItem("saas-core.signup.sentAt", String(Date.now()))
        setResendCooldown(60)
        setConfirmationMessage("sent")
      }
    } catch {
      setError(getTranslation("auth.errors.serviceUnavailable"))
    } finally {
      setResending(false)
    }
  }

  function useDifferentEmail() {
    setConfirmationMessage("")
    setPassword("")
    setError("")
    setResendCooldown(0)
    window.sessionStorage.removeItem("saas-core.signup.email")
    window.sessionStorage.removeItem("saas-core.signup.sentAt")
  }

  const emailAppUrl = getSupportedEmailAppUrl(email)

  return (
    <AuthShell showBrand showHeading={!confirmationMessage} sectionLabelledBy={confirmationMessage ? "signup-confirmation-title" : undefined} layout="account" backHref={backHref} title={getTranslation("auth.signUpTitle")} description={getTranslation("auth.signUpSubtitle", { product: PRODUCT_CONFIG.name })} footer={!confirmationMessage && <span>{getTranslation("auth.alreadyHaveAccount")} <Link className="auth-footer-link" href={`/login?redirect=${encodeURIComponent(redirectPath)}`}>{getTranslation("auth.signInAction")}</Link></span>}>
      {error && <Alert variant="destructive" className="auth-alert"><AlertDescription>{error}</AlertDescription></Alert>}
      {confirmationMessage ? (
        <section className={`auth-confirmation auth-confirmation--premium${confirmationMessage === "expired" ? " is-expired" : ""}`} aria-busy={resending || continuing}>
          <span className="auth-confirmation-icon" aria-hidden="true"><Mail strokeWidth={1.65} /></span>
          <div className="auth-confirmation-copy">
            <h1 id="signup-confirmation-title">{getTranslation(confirmationMessage === "expired" ? "auth.confirmationExpiredTitle" : "auth.confirmEmail")}</h1>
            <p>{getTranslation(confirmationMessage === "expired" ? "auth.confirmationExpiredDescription" : "auth.confirmEmailDescription")}</p>
          </div>
          {email && <p className="auth-confirmation-address" aria-label={getTranslation("auth.confirmEmailDestination")}>{email}</p>}
          {emailAppUrl && confirmationMessage === "sent" && <a className="auth-confirmation-email-app" href={emailAppUrl} target="_blank" rel="noopener noreferrer"><ArrowUpRight aria-hidden="true" strokeWidth={1.9} /><span>{getTranslation("auth.openEmailApp")}</span></a>}
          {emailAppUrl && confirmationMessage === "sent" && <div className="auth-confirmation-divider" aria-hidden="true"><span /><span>{getTranslation("auth.confirmationDivider")}</span><span /></div>}
          <div className="auth-confirmation-resend">
            <p>{getTranslation("auth.didNotReceiveEmail")}</p>
            {email && <button type="button" onClick={resend} disabled={resending || resendCooldown > 0 || continuing} className="auth-confirmation-resend-link" aria-live="off">
              {resending ? getTranslation("auth.sending") : resendCooldown > 0 ? getTranslation("auth.resendCountdown", { seconds: resendCooldown }) : getTranslation("auth.resendEmail")}
            </button>}
          </div>
          {continuing
            ? <p className="auth-confirmation-status" role="status"><LoaderCircle className="auth-confirmation-status-spinner" aria-hidden="true" />{getTranslation("auth.openingWorkspace")}</p>
            : confirmationMessage !== "expired" && <p className="auth-confirmation-status" role="status">{getTranslation("auth.waitingForConfirmation")}</p>}
          <button type="button" onClick={useDifferentEmail} className="auth-confirmation-change-email"><Mail aria-hidden="true" strokeWidth={1.7} />{getTranslation("auth.changeEmailAddress")}</button>
        </section>
      ) : (
          <div>
          <form method="post" action="/auth/signup" onSubmit={submit} aria-busy={submitting} className="auth-form auth-form--account">
            <input type="hidden" name="redirect" value={redirectPath} />
            <SocialAuthButtons redirectPath={redirectPath} onError={setError} />
            <AuthDivider />
            <AuthField id="signup-email" label={getTranslation("auth.email")}>
              <div className="auth-input-shell">
                <Mail className="auth-input-icon" aria-hidden="true" strokeWidth={1.75} />
                <Input className="auth-input" id="signup-email" name="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required />
              </div>
            </AuthField>
            <AuthField id="signup-password" label={getTranslation("auth.password")}>
              <PasswordField id="signup-password" name="password" label={getTranslation("auth.password")} placeholder={getTranslation("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="new-password" minLength={8} required />
            </AuthField>
            <Button type="submit" loading={submitting} disabled={!hydrated} className="auth-primary-button">{submitting ? getTranslation("auth.creatingAccount") : getTranslation("auth.createAccountAction")}</Button>
          </form>
        </div>
      )}
    </AuthShell>
  )
}
