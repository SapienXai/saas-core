import { SignupForm } from "@/components/auth/signup-form"
import { getPlatformUrl } from "@/lib/platform-urls"

export default function SignupPage() {
  return <SignupForm backHref={getPlatformUrl("/")} />
}
