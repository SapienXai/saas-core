"use client"

import type { ReactNode } from "react"
import { createPortal } from "react-dom"

export function BillingOverlayPortal({ children }: { children: ReactNode }) {
  if (typeof document === "undefined") return null

  const isDark = document.body.dataset.manageTheme === "dark"

  return createPortal(<div className={isDark ? "dark" : undefined}>{children}</div>, document.body)
}
