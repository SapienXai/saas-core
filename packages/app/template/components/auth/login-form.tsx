"use client"

import Link from "next/link"
import { useEffect, useState, type FormEvent } from "react"
import { Mail } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthDivider, AuthField, AuthShell } from "@/components/auth/auth-shell"
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons"
import { PasswordField } from "@/components/auth/password-field"
import { useLanguage } from "@/context/language-context"

export function LoginForm({ backHref = "/" }: { backHref?: string } = {}) {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [redirectPath, setRedirectPath] = useState("/app")
  const { getTranslation } = useLanguage()

  useEffect(() => {
    const requestedRedirect = new URLSearchParams(window.location.search).get("redirect")
    if (requestedRedirect && requestedRedirect.startsWith("/") && !requestedRedirect.startsWith("//")) setRedirectPath(requestedRedirect)
    // The explicit logout flow already clears the browser session before
    // navigating here. Avoid another auth round-trip on the login screen.
    const message = new URLSearchParams(window.location.search).get("error")
    if (message === "oauth_failed") {
      setError(getTranslation("auth.errors.oauthFailed"))
    } else if (message === "oauth_exchange_failed") {
      setError(getTranslation("auth.errors.oauthExchangeFailed"))
    } else if (message === "oauth_session_missing") {
      setError(getTranslation("auth.errors.oauthSessionMissing"))
    } else if (message === "invalid_confirmation" || message?.toLowerCase().includes("confirmation link")) {
      setError(getTranslation("auth.errors.invalidConfirmation"))
    } else if (message) {
      setError(getTranslation("auth.errors.generic"))
    }
  }, [getTranslation])

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    setError("")
    setSubmitting(true)
    try {
      const response = await fetch("/auth/signin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ email: email.trim(), password, redirect: redirectPath }),
      })

      if (!response.ok) {
        let errorCode = ""
        try {
          const payload = await response.json() as { error?: unknown }
          if (typeof payload.error === "string") errorCode = payload.error
        } catch {
          // Use the existing generic message for non-JSON error responses.
        }
        setError(errorCode === "service_unavailable"
          ? getTranslation("auth.errors.serviceUnavailable")
          : getTranslation("auth.errors.generic"))
        setSubmitting(false)
        return
      }

      const continuationResponse = await fetch(`/auth/continue?redirect=${encodeURIComponent(redirectPath)}`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
        cache: "no-store",
      })
      if (!continuationResponse.ok) {
        setError(getTranslation("auth.errors.serviceUnavailable"))
        setSubmitting(false)
        return
      }

      const continuation = await continuationResponse.json() as { redirectTo?: unknown }
      const destination = continuation.redirectTo
      if (typeof destination !== "string" || !destination.startsWith("/") || destination.startsWith("//")) {
        setError(getTranslation("auth.errors.serviceUnavailable"))
        setSubmitting(false)
        return
      }

      window.location.replace(destination)
    } catch {
      setError(getTranslation("auth.errors.serviceUnavailable"))
      setSubmitting(false)
    }
  }

  return (
    <AuthShell
      showBrand
      layout="account"
      backHref={backHref}
      title={getTranslation("auth.signInTitle")}
      description={getTranslation("auth.signInSubtitle")}
      footer={<span>{getTranslation("auth.dontHaveAccount")} {" "}<Link className="auth-footer-link" href={`/signup?redirect=${encodeURIComponent(redirectPath)}`}>{getTranslation("auth.signUpAction")}</Link></span>}
    >
      {error && <Alert variant="destructive" className="auth-alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <form method="post" action="/auth/signin" onSubmit={submit} aria-busy={submitting} className="auth-form auth-form--account">
        <input type="hidden" name="redirect" value={redirectPath} />
        <SocialAuthButtons redirectPath={redirectPath} onError={setError} />
        <AuthDivider />
        <AuthField id="login-email" label={getTranslation("auth.email")}>
          <div className="auth-input-shell">
            <Mail className="auth-input-icon" aria-hidden="true" strokeWidth={1.75} />
            <Input className="auth-input" id="login-email" name="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" inputMode="email" required />
          </div>
        </AuthField>
        <AuthField id="login-password" label={getTranslation("auth.password")}>
          <PasswordField id="login-password" name="password" label={getTranslation("auth.password")} placeholder={getTranslation("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
        </AuthField>
        <div className="auth-form-meta"><Link href="/forgot-password" className="auth-muted-link">{getTranslation("auth.forgotPassword")}</Link></div>
        <Button type="submit" loading={submitting} className="auth-primary-button">{submitting ? getTranslation("auth.signingIn") : getTranslation("auth.signInAction")}</Button>
      </form>
    </AuthShell>
  )
}
