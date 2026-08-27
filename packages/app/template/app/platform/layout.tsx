import type React from "react"
import type { Viewport } from "next"
import { redirect } from "next/navigation"
import { AuthorizationError } from "@/lib/authorization"
import { requirePlatformRole } from "@/lib/platform-authorization"
import { PlatformShell } from "@/components/platform/platform-shell"

export const dynamic = "force-dynamic"

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#020617",
}

export default async function PlatformLayout({ children }: { children: React.ReactNode }) {
  try {
    await requirePlatformRole()
  } catch (error) {
    if (error instanceof AuthorizationError && error.code === "UNAUTHENTICATED") redirect("/login?redirect=/platform")
    redirect("/app")
  }
  return <PlatformShell>{children}</PlatformShell>
}
