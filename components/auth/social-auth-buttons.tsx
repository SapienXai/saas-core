"use client"

import { useState } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { Button } from "@/components/ui/button"
import { useLanguage } from "@/context/language-context"

type SocialProvider = "google"

type SocialAuthButtonsProps = {
  redirectPath: string
  onError: (message: string) => void
}

function GoogleIcon() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4">
      <path fill="#4285F4" d="M21.35 12.23c0-.71-.06-1.4-.18-2.05H12v3.88h5.24a4.48 4.48 0 0 1-1.94 2.94v2.45h3.14c1.84-1.7 2.91-4.2 2.91-7.22Z" />
      <path fill="#34A853" d="M12 21.7c2.63 0 4.84-.87 6.45-2.35l-3.14-2.45c-.87.58-1.98.92-3.31.92-2.54 0-4.69-1.72-5.46-4.03H3.3v2.53A9.74 9.74 0 0 0 12 21.7Z" />
      <path fill="#FBBC05" d="M6.54 13.79a5.85 5.85 0 0 1 0-3.58V7.68H3.3a9.74 9.74 0 0 0 0 8.64l3.24-2.53Z" />
      <path fill="#EA4335" d="M12 6.18c1.43 0 2.71.49 3.72 1.45l2.79-2.79C16.84 3.27 14.63 2.3 12 2.3a9.74 9.74 0 0 0-8.7 5.38l3.24 2.53C7.31 7.9 9.46 6.18 12 6.18Z" />
    </svg>
  )
}

export function SocialAuthButtons({ redirectPath, onError }: SocialAuthButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<SocialProvider | null>(null)
  const { getTranslation } = useLanguage()

  async function continueWith(provider: SocialProvider) {
    setLoadingProvider(provider)
    onError("")

    try {
      const supabase = getSupabaseBrowserClient()

      const callbackUrl = new URL("/auth/callback", window.location.origin)
      callbackUrl.searchParams.set("next", redirectPath)

      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: { redirectTo: callbackUrl.toString() },
      })

      if (error) {
        onError(getTranslation("auth.errors.googleUnavailable"))
      }
    } catch {
      onError(getTranslation("auth.errors.serviceUnavailable"))
    } finally {
      setLoadingProvider(null)
    }
  }

  return (
    <div className="space-y-2">
      <Button
        type="button"
        variant="outline"
        className="h-[46px] w-full rounded-[10px] border-stone-200 bg-white text-[13px] font-semibold text-stone-800 shadow-none hover:bg-stone-50"
        loading={loadingProvider === "google"}
        disabled={loadingProvider !== null}
        onClick={() => void continueWith("google")}
      >
        <GoogleIcon />
        {getTranslation("auth.continueWithGoogle")}
      </Button>
    </div>
  )
}
