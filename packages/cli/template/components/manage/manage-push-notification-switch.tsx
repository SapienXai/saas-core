"use client"

import { Bell } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { useManagePushNotifications, type ManagePushNotificationStatus } from "@/context/manage-push-notifications-context"
import { useLanguage } from "@/context/language-context"

type Props = {
  variant?: "surface" | "header"
  className?: string
}

function statusLabel(status: ManagePushNotificationStatus, t: ReturnType<typeof useLanguage>["getTranslation"]) {
  if (status === "enabled") return t("manage.push.enabled")
  if (status === "denied") return t("manage.push.blocked")
  if (status === "unsupported") return t("manage.push.unsupported")
  if (status === "unconfigured") return t("manage.push.unconfigured")
  if (status === "ineligible") return t("manage.push.unavailablePlan")
  if (status === "loading") return t("manage.push.updating")
  if (status === "checking") return t("manage.push.checking")
  return t("manage.push.enable")
}

export function ManagePushNotificationSwitch({ variant = "surface", className }: Props) {
  const { getTranslation } = useLanguage()
  const { status, message, enable, disable } = useManagePushNotifications()
  const active = status === "enabled"
  const unavailable = ["checking", "unsupported", "unconfigured", "ineligible", "denied", "loading"].includes(status)
  const isHeader = variant === "header"

  return (
    <div className={cn(
      "manage-push-notification-switch rounded-xl px-3 py-2.5",
      isHeader
        ? "manage-push-notification-switch-header bg-white/10 text-white"
        : "manage-push-notification-switch-surface border border-slate-200 bg-slate-50 text-slate-900 dark:border-white/15 dark:bg-white/[0.08] dark:text-white",
      className,
    )}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-lg", isHeader ? "bg-white/10 text-sky-200" : "bg-violet-100 text-violet-600 dark:bg-violet-500/15 dark:text-violet-300")}>
            <Bell className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[11px] font-bold">{getTranslation("manage.push.title")}</p>
            <p className={cn("truncate text-[10px]", isHeader ? "text-white/60" : "text-slate-500 dark:text-slate-400")}>{statusLabel(status, getTranslation)}</p>
          </div>
        </div>
        <Switch
          checked={active}
          disabled={unavailable}
          onCheckedChange={(checked) => void (checked ? enable() : disable())}
          aria-label={active ? getTranslation("manage.push.disableAria") : getTranslation("manage.push.enableAria")}
          className={isHeader ? "data-[state=unchecked]:bg-white/25" : "data-[state=checked]:bg-violet-600"}
        />
      </div>
      {message && <p className={cn("mt-2 text-[10px] leading-4", isHeader ? "text-rose-200" : "text-rose-600")}>{message}</p>}
    </div>
  )
}
