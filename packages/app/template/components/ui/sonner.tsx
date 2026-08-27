"use client"

import { useTheme } from "@/components/theme-provider"
import { Toaster as Sonner } from "sonner"

type ToasterProps = React.ComponentProps<typeof Sonner>

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      position="top-right"
      closeButton
      duration={3500}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:w-[min(360px,calc(100vw-1.5rem))] group-[.toaster]:min-h-0 group-[.toaster]:rounded-xl group-[.toaster]:border-slate-200 group-[.toaster]:bg-white group-[.toaster]:p-3 group-[.toaster]:shadow-lg group-[.toaster]:shadow-slate-950/10",
          title: "group-[.toast]:text-[13px] group-[.toast]:font-semibold group-[.toast]:leading-5",
          description: "group-[.toast]:text-xs group-[.toast]:leading-5 group-[.toast]:text-muted-foreground",
          actionButton:
            "group-[.toast]:h-7 group-[.toast]:rounded-md group-[.toast]:bg-primary group-[.toast]:px-2.5 group-[.toast]:text-xs group-[.toast]:text-primary-foreground",
          cancelButton:
            "group-[.toast]:h-7 group-[.toast]:rounded-md group-[.toast]:bg-muted group-[.toast]:px-2.5 group-[.toast]:text-xs group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
