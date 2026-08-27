"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { ReserveviaAuthShell } from "@/components/auth/reservevia-auth-shell"
import { AuthDivider } from "@/components/auth/reservevia-auth-shell"
import { SocialAuthButtons } from "@/components/auth/social-auth-buttons"
import { PasswordField } from "@/components/auth/password-field"
import { useLanguage } from "@/context/language-context"

export function LoginForm() {
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [submitting, setSubmitting] = useState(false)
  const [redirectPath, setRedirectPath] = useState("/manage")
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
    <ReserveviaAuthShell
      title={getTranslation("auth.welcomeBack")}
      description={getTranslation("auth.signInDescription")}
      footer={<span>{getTranslation("auth.newToReservevia")} <Link className="font-semibold text-stone-950 underline-offset-4 hover:underline" href={`/signup?redirect=${encodeURIComponent(redirectPath)}`}>{getTranslation("auth.createAccount")}</Link></span>}
    >
      {error && <Alert variant="destructive" className="mb-4 rounded-[11px] border-rose-200 bg-rose-50 px-3.5 py-2.5 text-[12px] text-rose-900"><AlertDescription>{error}</AlertDescription></Alert>}
      <SocialAuthButtons redirectPath={redirectPath} onError={setError} />
      <div className="my-4"><AuthDivider /></div>
      <form method="post" action="/auth/signin" onSubmit={() => setSubmitting(true)} className="space-y-3">
        <input type="hidden" name="redirect" value={redirectPath} />
        <div className="space-y-1"><Label className="text-[12px] font-semibold" htmlFor="login-email">{getTranslation("auth.email")}</Label><Input className="h-[42px] rounded-[10px] border-stone-200 bg-white px-3.5 text-[13px] shadow-none placeholder:text-stone-400 focus-visible:border-stone-950 focus-visible:ring-4 focus-visible:ring-stone-950/10" id="login-email" name="email" type="email" placeholder="you@example.com" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required /></div>
        <div className="space-y-1"><Label className="text-[12px] font-semibold" htmlFor="login-password">{getTranslation("auth.password")}</Label><PasswordField id="login-password" name="password" label={getTranslation("auth.password")} placeholder={getTranslation("auth.passwordPlaceholder")} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required /></div>
        <div className="flex items-center justify-between gap-3 pt-0.5 text-[11px] text-stone-500"><label className="inline-flex items-center gap-2"><input type="checkbox" className="h-3.5 w-3.5 rounded border-stone-300 accent-stone-950" /> <span>{getTranslation("auth.rememberMe")}</span></label><Link href="/forgot-password" className="font-semibold transition-colors hover:text-stone-950">{getTranslation("auth.forgotPassword")}</Link></div>
        <Button type="submit" loading={submitting} className="h-[42px] w-full rounded-[10px] bg-stone-950 text-[13px] font-semibold text-white shadow-[0_8px_18px_rgba(28,25,23,0.15)] hover:bg-stone-800">{submitting ? getTranslation("auth.signingIn") : getTranslation("auth.signIn")}</Button>
      </form>
    </ReserveviaAuthShell>
  )
}
