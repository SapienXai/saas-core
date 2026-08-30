"use client"

/* eslint-disable @next/next/no-img-element */

import { useMemo, useRef, useState, type ChangeEvent } from "react"
import Link from "next/link"
import { Bell, Check, Download, ImagePlus, Pencil, Smartphone, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { ManageDisclosure, ManageListRow, ManagePage, ManagePageHeader, ManageSurface } from "@/components/manage/manage-responsive"
import { useManagePwaInstall } from "@/context/manage-pwa-install-context"
import { ManagePushNotificationSwitch } from "@/components/manage/manage-push-notification-switch"
import { useLanguage } from "@/context/language-context"
import { useManageContext } from "@/context/manage-context"
import { getPlanNavigationHref } from "@/lib/plan-navigation"
import { removePwaIcon, savePwaSettings, uploadPwaIcon, type PwaManagementData } from "./actions"

export function PwaManagement({ initialData }: { initialData: PwaManagementData }) {
  const { getTranslation } = useLanguage()
  const { currentWorkspace, ownedWorkspaceId } = useManageContext()
  const planHref = getPlanNavigationHref({ currentWorkspaceId: currentWorkspace?.id, ownedWorkspaceId })
  const t = getTranslation
  const [appName, setAppName] = useState(initialData.settings?.app_name || "")
  const [themeColor, setThemeColor] = useState(initialData.settings?.theme_color || "#1e40af")
  const [backgroundColor, setBackgroundColor] = useState(initialData.settings?.background_color || "#ffffff")
  const [branding, setBranding] = useState(initialData.branding)
  const [busy, setBusy] = useState(false)
  const [editOpen, setEditOpen] = useState(false)
  const { installed, canInstall, installing, install } = useManagePwaInstall()
  const inputRef = useRef<HTMLInputElement>(null)
  const canConfigure = initialData.customPWA && ["owner", "admin"].includes(initialData.role)
  const installMessage = useMemo(() => installed ? t("manage.pwa.installMessageInstalled") : canInstall ? t("manage.pwa.installMessageReady") : t("manage.pwa.installMessageManual"), [canInstall, installed, t])

  async function save() {
    setBusy(true)
    const result = await savePwaSettings({ appName, themeColor, backgroundColor })
    setBusy(false)
    if (!result.success) toast.error(t("manage.pwa.settingsSaveError"))
    else { toast.success(t("manage.pwa.settingsSaved")); setBranding({ ...branding, appName: appName.trim() || branding.appName, shortName: (appName.trim() || branding.appName).slice(0, 24), themeColor, backgroundColor }); setEditOpen(false) }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    const formData = new FormData(); formData.set("icon", file)
    const result = await uploadPwaIcon(formData)
    setBusy(false)
    if (!result.success) toast.error(t("manage.pwa.iconUploadError")); else { toast.success(t("manage.pwa.iconUploaded")); window.location.reload() }
    event.target.value = ""
  }

  async function removeIcon() {
    setBusy(true)
    const result = await removePwaIcon()
    setBusy(false)
    if (!result.success) toast.error(t("manage.pwa.iconRemoveError")); else { toast.success(t("manage.pwa.iconRemoved")); window.location.reload() }
  }

  return <ManagePage>
    <ManagePageHeader eyebrow="Workspace" title={t("manage.pwa.title")} description={t("manage.pwa.description", { workspace: initialData.workspace.name })} actions={canConfigure ? <Button type="button" className="min-h-11 rounded-xl" onClick={() => setEditOpen(true)}><Pencil className="h-4 w-4" />Edit branding</Button> : undefined} />
    {!initialData.customPWA ? <div className="flex items-start gap-3 rounded-xl border border-violet-200 bg-violet-50 p-3.5 text-sm text-violet-950 dark:border-violet-400/20 dark:bg-violet-500/10 dark:text-violet-100"><Smartphone className="mt-0.5 h-4 w-4 shrink-0" /><div><p className="font-semibold">{t("manage.pwa.customBrandingUnavailable")}</p><Link className="mt-1 inline-flex text-xs font-bold underline" href={planHref}>{t("manage.pwa.viewPlans")}</Link></div></div> : null}
    <ManageSurface className="overflow-hidden">
      <div className="flex items-center gap-3 border-b border-slate-100 px-3.5 py-3.5 dark:border-white/10 sm:px-4"><div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-slate-200 bg-slate-50 dark:border-white/10 dark:bg-white/[0.04]"><img src={branding.iconUrl} alt={t("manage.pwa.effectiveAppIcon")} className="h-full w-full object-cover" /></div><div className="min-w-0 flex-1"><p className="truncate text-base font-semibold text-slate-950 dark:text-white">{branding.appName}</p><p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{t("manage.pwa.workspaceManagement")}</p></div><span className="rounded-full border border-slate-200 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:border-white/10 dark:text-slate-300">{installed ? "Installed" : "Web app"}</span></div>
      <div className="divide-y divide-slate-100 dark:divide-white/10"><ManageListRow icon={Download} title={installed ? "App installed" : "Install the management app"} subtitle={installMessage} action={canInstall && !installed ? <Button type="button" className="min-h-10 rounded-xl" onClick={() => void install()} loading={installing}><Download className="h-4 w-4" />Install</Button> : null} /><ManageListRow icon={Bell} title={t("manage.push.title")} subtitle="Stay informed about workspace activity." action={<ManagePushNotificationSwitch />} /></div>
    </ManageSurface>
    <ManageDisclosure title="Appearance preview" summary="Current branding" defaultOpen><div className="flex items-center gap-3 rounded-xl border p-3.5" style={{ borderColor: branding.themeColor, backgroundColor: branding.backgroundColor }}><img src={branding.iconUrl} alt="" className="h-12 w-12 rounded-xl object-cover" /><div className="min-w-0"><p className="truncate font-semibold text-slate-950">{branding.appName}</p><p className="mt-0.5 text-xs text-slate-600">{t("manage.pwa.previewDescription")}</p><div className="mt-1.5 flex items-center gap-1.5 text-xs text-slate-600"><Check className="h-3.5 w-3.5" />{t("manage.pwa.previewCheck")}</div></div></div></ManageDisclosure>
    {canConfigure ? <Dialog open={editOpen} onOpenChange={setEditOpen}><DialogContent className="w-[calc(100%-1rem)] max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg"><DialogHeader><DialogTitle>Edit app branding</DialogTitle><DialogDescription>Update the name, icon and colors shown when this workspace is installed.</DialogDescription></DialogHeader><div className="grid gap-4 py-2"><label className="grid gap-1.5 text-sm font-medium">{t("manage.pwa.appName")}<input value={appName} onChange={(event) => setAppName(event.target.value)} disabled={busy} maxLength={60} className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 dark:border-white/10 dark:bg-white/[0.04]" placeholder={branding.appName} /></label><div><p className="text-sm font-medium">{t("manage.pwa.appIcon")}</p><div className="mt-1.5 flex flex-wrap items-center gap-2"><img src={branding.iconUrl} alt={t("manage.pwa.effectiveAppIcon")} className="h-12 w-12 rounded-xl object-cover" /><input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={upload} className="sr-only" /><Button type="button" variant="outline" onClick={() => inputRef.current?.click()} loading={busy}><ImagePlus className="h-4 w-4" />{t("manage.pwa.uploadIcon")}</Button>{initialData.branding.customIconUrl ? <Button type="button" variant="ghost" onClick={() => void removeIcon()} loading={busy} className="text-rose-600"><Trash2 className="h-4 w-4" />{t("manage.pwa.removeCustomIcon")}</Button> : null}</div></div><div className="grid gap-3 sm:grid-cols-2"><label className="grid gap-1.5 text-sm font-medium">{t("manage.pwa.themeColor")}<input type="text" value={themeColor} onChange={(event) => setThemeColor(event.target.value)} disabled={busy} pattern="^#[0-9a-fA-F]{6}$" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 uppercase dark:border-white/10 dark:bg-white/[0.04]" /></label><label className="grid gap-1.5 text-sm font-medium">{t("manage.pwa.backgroundColor")}<input type="text" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} disabled={busy} pattern="^#[0-9a-fA-F]{6}$" className="h-11 w-full rounded-xl border border-slate-200 bg-white px-3 uppercase dark:border-white/10 dark:bg-white/[0.04]" /></label></div></div><DialogFooter><Button type="button" variant="outline" onClick={() => setEditOpen(false)}>Cancel</Button><Button type="button" onClick={() => void save()} loading={busy}><Check className="h-4 w-4" />{t("manage.pwa.saveBranding")}</Button></DialogFooter></DialogContent></Dialog> : null}
  </ManagePage>
}
