"use client"

import * as React from "react"
import { Toaster as Sonner } from "sonner"
import { useTheme } from "../theme.js"

export { toast } from "sonner"

export const Toaster = (props: React.ComponentProps<typeof Sonner>) => {
  const { resolvedMode } = useTheme()
  return <Sonner theme={resolvedMode} position="top-right" closeButton duration={3500} toastOptions={{ classNames: { toast: "sc-sonner-toast", title: "sc-sonner-title", description: "sc-sonner-description", actionButton: "sc-sonner-action", cancelButton: "sc-sonner-cancel" } }} {...props} />
}
