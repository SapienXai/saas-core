"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { acceptInvitation } from "@/app/invite/accept/actions"
import { useLanguage } from "@/context/language-context"
import { formatDate as formatLocalizedDate } from "@/i18n"

export function InvitationAcceptance({ invitation, userEmail }: { invitation: { email: string; role: string; restaurant_access_mode: string; expires_at: string; workspaces?: { name: string } | { name: string }[] | null }; userEmail: string }) {
  const router = useRouter()
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)
  const { currentLang, getTranslation, translateMessage } = useLanguage()
  const workspaceName = Array.isArray(invitation.workspaces) ? invitation.workspaces[0]?.name : invitation.workspaces?.name
  async function submit() {
    setLoading(true); setError("")
    const result = await acceptInvitation()
    if (!result.success) { setError(translateMessage(result.message || getTranslation("invitation.error"))); setLoading(false); return }
    router.replace("/manage")
  }
  const accessLabel = invitation.restaurant_access_mode === "all" ? getTranslation("invitation.allRestaurants") : getTranslation("invitation.selectedRestaurant")
  const expiryDate = formatLocalizedDate(invitation.expires_at, currentLang)
  return <main className="flex min-h-screen items-center justify-center bg-[#f7f4ef] px-4 py-8"><Card className="w-full max-w-lg"><CardHeader><p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Reservevia</p><CardTitle className="text-2xl">{getTranslation("invitation.join", { workspace: workspaceName || getTranslation("manage.common.workspace") })}</CardTitle></CardHeader><CardContent className="space-y-5"><p className="text-sm leading-6 text-stone-600">{getTranslation("invitation.invitedAs", { email: invitation.email, role: invitation.role, access: accessLabel })}</p>{userEmail.toLowerCase() !== invitation.email.toLowerCase() && <Alert variant="destructive"><AlertDescription>{getTranslation("invitation.wrongAccount", { current: userEmail, invited: invitation.email })}</AlertDescription></Alert>}{error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}<Button className="h-12 w-full rounded-xl bg-stone-950 text-white hover:bg-stone-800" onClick={submit} loading={loading} disabled={userEmail.toLowerCase() !== invitation.email.toLowerCase()}>{loading ? getTranslation("invitation.joining") : getTranslation("invitation.accept")}</Button><p className="text-center text-xs text-stone-500">{getTranslation("invitation.expires", { date: expiryDate })}</p></CardContent></Card></main>
}
