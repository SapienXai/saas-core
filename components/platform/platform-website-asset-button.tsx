"use client"

import { useRouter } from "next/navigation"
import { ImageDown, Loader2 } from "lucide-react"
import { useTransition } from "react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { syncPlatformRestaurantWebsiteAssetsAction } from "@/app/platform/actions"

export function PlatformWebsiteAssetButton({ restaurantId }: { restaurantId: string }) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()

  function sync() {
    startTransition(async () => {
      const response = await syncPlatformRestaurantWebsiteAssetsAction([restaurantId])
      if (!response.success) {
        toast.error(response.message)
        return
      }
      const result = response.results[0]
      const imported = result?.result?.logo.status === "imported" || result?.result?.primary.status === "imported"
      toast.success(imported ? "Website assets imported" : result?.message || "No usable website images were found")
      router.refresh()
    })
  }

  return <Button type="button" variant="outline" onClick={sync} disabled={pending} className="min-h-10 gap-2 border-white/10 text-slate-300 hover:bg-white/[0.06]">{pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageDown className="h-3.5 w-3.5" />}{pending ? "Finding website images…" : "Import website images"}</Button>
}
