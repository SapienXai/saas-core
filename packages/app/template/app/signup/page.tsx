import { SignupForm } from "@/components/auth/signup-form"
import { getPlatformUrl } from "@/lib/platform-urls"

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ confirmation?: string | string[]; error?: string | string[] }> }) {
  const query = await searchParams
  const confirmation = Array.isArray(query.confirmation) ? query.confirmation[0] : query.confirmation
  const error = Array.isArray(query.error) ? query.error[0] : query.error
  const initialConfirmationMessage = confirmation === "sent" ? "sent" : confirmation === "expired" || error === "invalid_confirmation" ? "expired" : ""
  return <SignupForm backHref={getPlatformUrl("/")} initialConfirmationMessage={initialConfirmationMessage} />
}
