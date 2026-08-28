"use client"

import { useEffect, useState } from "react"
import { ThinkingOrb, type OrbState, type OrbTheme } from "thinking-orbs"
import { cn } from "../../lib/utils"
import { useLanguage } from "../../context/language-context"

export type OrbLoaderSize = "sm" | "md"
export type { OrbState, OrbTheme }

interface OrbLoaderProps {
  label?: string
  state?: OrbState
  size?: OrbLoaderSize
  theme?: OrbTheme
  speed?: number
  showLabel?: boolean
  className?: string
}

const orbSizes = {
  sm: 20,
  md: 64,
} as const

function useResolvedOrbTheme(theme: OrbTheme) {
  const [resolvedTheme, setResolvedTheme] = useState<OrbTheme>(theme)

  useEffect(() => {
    if (theme !== "auto") {
      setResolvedTheme(theme)
      return
    }

    const syncManagementTheme = () => {
      const managementTheme = document.body.dataset.manageTheme
      setResolvedTheme(managementTheme === "dark" || managementTheme === "light" ? managementTheme : "auto")
    }

    syncManagementTheme()
    const observer = new MutationObserver(syncManagementTheme)
    observer.observe(document.body, { attributes: true, attributeFilter: ["data-manage-theme"] })
    return () => observer.disconnect()
  }, [theme])

  return resolvedTheme
}

export function OrbLoader({
  label,
  state = "working",
  size = "md",
  theme = "auto",
  speed = 1,
  showLabel = true,
  className,
}: OrbLoaderProps) {
  const { getTranslation, translateMessage } = useLanguage()
  const resolvedTheme = useResolvedOrbTheme(theme)
  const resolvedLabel = label ? translateMessage(label) : getTranslation("common.loading")

  return (
    <span
      className={cn("flex flex-col items-center justify-center gap-3", className)}
      role="status"
      aria-live="polite"
      aria-label={resolvedLabel}
    >
      <ThinkingOrb
        state={state}
        size={orbSizes[size]}
        theme={resolvedTheme}
        speed={speed}
        className="saas-core-orb-canvas"
        aria-hidden="true"
      />
      {showLabel && <span className="text-sm text-muted-foreground">{resolvedLabel}</span>}
    </span>
  )
}

interface LoadingOverlayProps extends Omit<OrbLoaderProps, "className" | "showLabel"> {
  className?: string
}

export function LoadingOverlay({
  label,
  state = "working",
  size = "sm",
  theme = "auto",
  speed = 1,
  className,
}: LoadingOverlayProps) {
  const { getTranslation } = useLanguage()
  return (
    <div
      className={cn(
        "pointer-events-none absolute inset-0 z-10 flex items-start justify-center rounded-[inherit] bg-background/70 pt-12 backdrop-blur-[1px]",
        className,
      )}
      aria-busy="true"
    >
      <OrbLoader label={label || getTranslation("common.updating")} state={state} theme={theme} speed={speed} size={size} />
    </div>
  )
}
