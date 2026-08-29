"use client"

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

export function LoginForm() {
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

  return (
    <AuthShell
      showBrand
      title={getTranslation("auth.signInTitle")}
      description={getTranslation("auth.signInSubtitle")}
      footer={<span>{getTranslation("auth.dontHaveAccount")} {" "}<Link className="auth-footer-link" href={`/signup?redirect=${encodeURIComponent(redirectPath)}`}>{getTranslation("auth.register")}</Link></span>}
    >
      {error && <Alert variant="destructive" className="auth-alert"><AlertDescription>{error}</AlertDescription></Alert>}
      <form method="post" action="/auth/signin" onSubmit={(event) => { if (submitting) { event.preventDefault(); return }; setSubmitting(true) }} className="auth-form">
        <input type="hidden" name="redirect" value={redirectPath} />
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
        <SocialAuthButtons redirectPath={redirectPath} onError={setError} />
        <Button type="submit" loading={submitting} className="auth-primary-button">{submitting ? getTranslation("auth.signingIn") : getTranslation("auth.signInAction")}</Button>
      </form>
    </AuthShell>
  )
}
