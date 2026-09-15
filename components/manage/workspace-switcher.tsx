"use client"

import Image from "next/image"
import Link from "next/link"
import { Check, ChevronDown, Layers3, Loader2, Plus } from "lucide-react"
import { useState } from "react"
import type { ReactNode } from "react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import { selectWorkspace } from "@/app/manage/context-actions"
import type { TranslationKey, TranslationReplacements } from "@/i18n"
import { cn } from "@/lib/utils"

type WorkspaceSwitcherProps = {
  compact: boolean
  isDark: boolean
  logoAsset: string
  onClose?: () => void
  headerAction?: ReactNode
  canCreateWorkspace: boolean
  onCreateWorkspace?: () => void
}

function getRoleLabel(role: string, getTranslation: (key: TranslationKey, replacements?: TranslationReplacements) => string) {
  switch (role) {
    case "owner":
      return getTranslation("team.roleOwner")
    case "admin":
      return getTranslation("team.roleAdmin")
    case "manager":
      return getTranslation("team.roleManager")
    case "readonly":
      return getTranslation("manage.users.form.readonly")
    case "staff":
      return getTranslation("team.roleStaff")
    default:
      return role
  }
}

export function WorkspaceSwitcher({ compact, isDark, logoAsset, onClose, headerAction, canCreateWorkspace, onCreateWorkspace }: WorkspaceSwitcherProps) {
  const { getTranslation } = useLanguage()
  const { memberships, currentWorkspace, platformRole } = useManageContext()
  const [switchingWorkspaceId, setSwitchingWorkspaceId] = useState<string | null>(null)

  const currentWorkspaceId = currentWorkspace?.id || null
  const platformOnly = Boolean(platformRole && !currentWorkspace)
  const currentWorkspaceName = currentWorkspace?.workspace?.name || (platformOnly ? getTranslation("manage.common.allWorkspaces") : getTranslation("manage.common.workspaceFallback"))
  const scopeLabel = platformOnly ? getTranslation("manage.common.platformScope") : getTranslation("manage.common.currentWorkspace")
  const workspaceOptions = memberships.length > 0
    ? memberships
    : currentWorkspace
      ? [{ workspaceId: currentWorkspace.id, role: currentWorkspace.role, workspace: currentWorkspace.workspace }]
      : []

  async function changeWorkspace(workspaceId: string) {
    if (workspaceId === currentWorkspaceId || switchingWorkspaceId) return
    setSwitchingWorkspaceId(workspaceId)
    try {
      const result = await selectWorkspace(workspaceId)
      if (result.success) window.location.reload()
    } catch (error) {
      console.error("Could not switch workspace:", error)
      setSwitchingWorkspaceId(null)
    }
  }

  return (
    <DropdownMenu>
      <div className={cn(
        "flex min-w-0 items-center",
        compact
          ? "mx-auto h-10 w-10 justify-center"
          : "flex-1 rounded-2xl bg-slate-50/70 transition-colors hover:bg-slate-100 dark:bg-white/[0.035] dark:hover:bg-white/[0.07]"
      )}>
        <DropdownMenuTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-label={scopeLabel}
            className={cn(
              "group flex min-w-0 cursor-pointer items-center text-left transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-500",
              compact
                ? "h-10 w-10 justify-center rounded-xl"
                : "flex-1 gap-3 rounded-2xl px-1.5 py-1.5"
            )}
          >
            <span className="flex min-w-0 flex-1 items-center gap-3">
              <span className={cn(
                "manage-brand-mark flex shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-500/25",
                compact ? "h-9 w-9" : "h-10 w-10"
              )}>
                <Image src={logoAsset} alt="" width={40} height={40} className="h-full w-full rounded-[inherit] object-cover" priority />
              </span>
              {!compact && (
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-bold tracking-tight text-slate-950 dark:text-white">{currentWorkspaceName}</span>
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400 dark:text-slate-500">{platformOnly ? getTranslation("manage.common.platformManagement") : getTranslation("manage.common.management")}</span>
                </span>
              )}
            </span>
            {!compact && <ChevronDown className="h-4 w-4 shrink-0 text-slate-400 transition-transform group-data-[state=open]:rotate-180" aria-hidden="true" />}
            {!compact && headerAction && (
              <div className="shrink-0" onPointerDown={(event) => event.stopPropagation()} onClick={(event) => event.stopPropagation()}>
                {headerAction}
              </div>
            )}
          </div>
        </DropdownMenuTrigger>
      </div>
      <DropdownMenuContent
        side={compact ? "right" : "bottom"}
        align={compact ? "start" : "start"}
        sideOffset={compact ? 10 : 8}
        className={cn(
          "w-[18rem] rounded-2xl border p-2 shadow-2xl shadow-slate-950/15",
          isDark ? "border-white/10 bg-[#1b1c27] text-white" : "border-slate-200 bg-white text-slate-950"
        )}
      >
        <div className={isDark ? "dark" : undefined}>
          <DropdownMenuLabel className="px-2.5 pb-1 pt-1 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            {platformOnly ? getTranslation("manage.common.platformScope") : getTranslation("manage.common.workspace")}
          </DropdownMenuLabel>
          <div className="space-y-1">
            {workspaceOptions.map((membership) => {
              const isCurrent = membership.workspaceId === currentWorkspaceId
              const isSwitching = membership.workspaceId === switchingWorkspaceId
              const workspaceName = membership.workspace?.name || getTranslation("manage.common.workspaceFallback")
              return (
                <DropdownMenuItem
                  key={membership.workspaceId}
                  disabled={isCurrent || Boolean(switchingWorkspaceId)}
                  onSelect={(event) => {
                    event.preventDefault()
                    void changeWorkspace(membership.workspaceId)
                  }}
                  className={cn(
                    "min-h-12 rounded-xl px-2.5 py-2",
                    isCurrent
                      ? "bg-violet-50 text-violet-900 dark:bg-violet-500/15 dark:text-violet-100"
                      : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-white/[0.07]"
                  )}
                >
                  <span className={cn(
                    "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                    isCurrent ? "bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-200" : "bg-slate-100 text-slate-500 dark:bg-white/[0.08] dark:text-slate-400"
                  )}>
                    <Layers3 className="h-4 w-4" aria-hidden="true" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{workspaceName}</span>
                    <span className="block truncate text-[11px] text-slate-400 dark:text-slate-500">{getRoleLabel(membership.role, getTranslation)}</span>
                  </span>
                  {isSwitching ? <Loader2 className="h-4 w-4 shrink-0 animate-spin text-violet-500" aria-label={getTranslation("manage.common.refreshing")} /> : isCurrent ? <Check className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-300" aria-hidden="true" /> : null}
                </DropdownMenuItem>
              )
            })}
          </div>
          <DropdownMenuSeparator className="my-2 bg-slate-200 dark:bg-white/10" />
          {canCreateWorkspace ? (
            <DropdownMenuItem asChild className="min-h-10 rounded-xl px-2.5 text-violet-700 focus:bg-violet-50 focus:text-violet-800 dark:text-violet-200 dark:focus:bg-violet-500/10 dark:focus:text-violet-100">
              <Link href="/onboarding/workspace" onClick={onClose}>
                <Plus className="h-4 w-4" aria-hidden="true" />
                {getTranslation("manage.common.createWorkspaceShort")}
              </Link>
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              className="min-h-10 rounded-xl px-2.5 text-violet-700 focus:bg-violet-50 focus:text-violet-800 dark:text-violet-200 dark:focus:bg-violet-500/10 dark:focus:text-violet-100"
              onSelect={() => {
                onClose?.()
                onCreateWorkspace?.()
              }}
            >
              <Plus className="h-4 w-4" aria-hidden="true" />
              {getTranslation("manage.common.createWorkspaceShort")}
            </DropdownMenuItem>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
