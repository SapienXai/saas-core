import { headers } from "next/headers"
import { SignupForm } from "@/components/auth/signup-form"
import { usesNeonBackend } from "@/lib/backend"
import { getTrustedHostFromHeaders, isDevelopmentTunnelHostname, isLocalDevelopmentHostname, isLoopbackDevelopmentHostname } from "@/lib/domains/hostname"
import { getPlatformUrl } from "@/lib/platform-urls"

async function usesLocalInbox() {
  if (process.env.NODE_ENV !== "development") return false
  const host = getTrustedHostFromHeaders(await headers())?.hostname
  if (!host || (!isLocalDevelopmentHostname(host) && !isDevelopmentTunnelHostname(host))) return false

  if (usesNeonBackend()) return !process.env.RESEND_API_KEY
  const supabaseUrl = URL.parse(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || "")
  return isLoopbackDevelopmentHostname(supabaseUrl?.hostname)
}

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ confirmation?: string | string[]; error?: string | string[] }> }) {
  const query = await searchParams
  const confirmation = Array.isArray(query.confirmation) ? query.confirmation[0] : query.confirmation
  const error = Array.isArray(query.error) ? query.error[0] : query.error
  const initialConfirmationMessage = confirmation === "sent" ? "sent" : confirmation === "expired" || error === "invalid_confirmation" ? "expired" : ""
  return <SignupForm backHref={getPlatformUrl("/")} initialConfirmationMessage={initialConfirmationMessage} localInbox={await usesLocalInbox()} />
}
