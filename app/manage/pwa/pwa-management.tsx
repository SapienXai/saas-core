"use client"

/* eslint-disable @next/next/no-img-element */

import { useMemo, useRef, useState, type ChangeEvent } from "react"
import Link from "next/link"
import { Bell, Check, Download, ImagePlus, Save, Smartphone, Trash2 } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
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
  const { installed, canInstall, installing, install } = useManagePwaInstall()
  const inputRef = useRef<HTMLInputElement>(null)
  const canConfigure = initialData.customPWA && ["owner", "admin"].includes(initialData.role)

  const installMessage = useMemo(() => {
    if (installed) return t("manage.pwa.installMessageInstalled")
    if (canInstall) return t("manage.pwa.installMessageReady")
    return t("manage.pwa.installMessageManual")
  }, [canInstall, installed, t])

  async function save() {
    setBusy(true)
    const result = await savePwaSettings({ appName, themeColor, backgroundColor })
    setBusy(false)
    if (!result.success) toast.error(t("manage.pwa.settingsSaveError"))
    else {
      toast.success(t("manage.pwa.settingsSaved"))
      setBranding({
        ...branding,
        appName: appName.trim() || branding.appName,
        shortName: (appName.trim() || branding.appName).slice(0, 24),
        themeColor,
        backgroundColor,
      })
    }
  }

  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    setBusy(true)
    const formData = new FormData()
    formData.set("icon", file)
    const result = await uploadPwaIcon(formData)
    setBusy(false)
    if (!result.success) toast.error(t("manage.pwa.iconUploadError"))
    else {
      toast.success(t("manage.pwa.iconUploaded"))
      window.location.reload()
    }
    event.target.value = ""
  }

  async function removeIcon() {
    setBusy(true)
    const result = await removePwaIcon()
    setBusy(false)
    if (!result.success) toast.error(t("manage.pwa.iconRemoveError"))
    else {
      toast.success(t("manage.pwa.iconRemoved"))
      window.location.reload()
    }
  }

  return (
    <main className="min-h-full bg-slate-50/70 p-4 dark:bg-[#101116] sm:p-6 lg:p-8">
      <div className="mx-auto max-w-4xl space-y-6">
        <div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-violet-600">SaaS Core</p>
          <h1 className="mt-2 text-2xl font-bold tracking-tight text-slate-950 dark:text-white">{t("manage.pwa.title")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500 dark:text-slate-400">{t("manage.pwa.description", { workspace: initialData.workspace.name })}</p>
        </div>

        <div className="grid gap-5 lg:grid-cols-[1.15fr_.85fr]">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Smartphone className="h-5 w-5" /> {t("manage.pwa.branding")}</CardTitle></CardHeader>
            <CardContent className="space-y-5">
              {!initialData.customPWA && <div className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm text-violet-900">{t("manage.pwa.customBrandingUnavailable")} <Link className="font-semibold underline" href={planHref}>{t("manage.pwa.viewPlans")}</Link></div>}
              {initialData.customPWA && <>
                <label className="block text-sm font-medium">{t("manage.pwa.appName")}<input value={appName} onChange={(event) => setAppName(event.target.value)} disabled={!canConfigure || busy} maxLength={60} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 dark:border-white/10 dark:bg-white/[0.04]" placeholder={branding.appName} /></label>
                <div>
                  <p className="text-sm font-medium">{t("manage.pwa.appIcon")}</p>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <div className="flex h-16 w-16 items-center justify-center overflow-hidden rounded-2xl border bg-slate-50"><img src={branding.iconUrl} alt={t("manage.pwa.effectiveAppIcon")} className="h-full w-full object-cover" /></div>
                    {canConfigure && <>
                      <input ref={inputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif,image/avif" onChange={upload} className="sr-only" />
                      <Button type="button" variant="outline" onClick={() => inputRef.current?.click()} loading={busy}><ImagePlus className="h-4 w-4" /> {busy ? t("manage.pwa.uploading") : t("manage.pwa.uploadIcon")}</Button>
                      {initialData.branding.customIconUrl && <Button type="button" variant="ghost" onClick={() => void removeIcon()} loading={busy}><Trash2 className="h-4 w-4" /> {busy ? t("manage.pwa.removing") : t("manage.pwa.removeCustomIcon")}</Button>}
                    </>}
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <label className="block text-sm font-medium">{t("manage.pwa.themeColor")}<input type="text" value={themeColor} onChange={(event) => setThemeColor(event.target.value)} disabled={!canConfigure || busy} pattern="^#[0-9a-fA-F]{6}$" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 uppercase dark:border-white/10 dark:bg-white/[0.04]" /></label>
                  <label className="block text-sm font-medium">{t("manage.pwa.backgroundColor")}<input type="text" value={backgroundColor} onChange={(event) => setBackgroundColor(event.target.value)} disabled={!canConfigure || busy} pattern="^#[0-9a-fA-F]{6}$" className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 uppercase dark:border-white/10 dark:bg-white/[0.04]" /></label>
                </div>
                {canConfigure && <Button type="button" onClick={() => void save()} loading={busy} className="gap-2"><Save className="h-4 w-4" /> {busy ? t("manage.pwa.saving") : t("manage.pwa.saveBranding")}</Button>}
              </>}
            </CardContent>
          </Card>

          <div className="space-y-5">
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Download className="h-5 w-5" /> {t("manage.pwa.installAppTitle")}</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 dark:border-white/10 dark:bg-white/[0.04]"><img src={branding.iconUrl} alt="" className="h-12 w-12 rounded-xl object-cover" /><div className="min-w-0"><p className="truncate font-semibold">{branding.appName}</p><p className="text-xs text-slate-500">{t("manage.pwa.workspaceManagement")}</p></div></div>
                <p className="text-sm text-slate-600 dark:text-slate-300">{installMessage}</p>
                {canInstall && !installed && <Button type="button" onClick={() => void install()} loading={installing} className="w-full gap-2"><Download className="h-4 w-4" /> {installing ? t("manage.pwa.installing") : t("manage.pwa.installAppTitle")}</Button>}
                {!canInstall && !installed && <p className="text-xs text-slate-500">{t("manage.pwa.iosInstallHint")}</p>}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle className="flex items-center gap-2"><Bell className="h-5 w-5" /> {t("manage.push.title")}</CardTitle></CardHeader>
              <CardContent><ManagePushNotificationSwitch /></CardContent>
            </Card>
          </div>
        </div>

        <Card>
              <CardHeader><CardTitle>{t("manage.pwa.preview")}</CardTitle></CardHeader>
          <CardContent>
            <div className="flex items-center gap-4 rounded-2xl border p-4" style={{ borderColor: branding.themeColor }}>
              <img src={branding.iconUrl} alt="" className="h-14 w-14 rounded-2xl object-cover" />
              <div>
                <p className="font-semibold">{branding.appName}</p>
                <p className="text-sm text-slate-500">{t("manage.pwa.previewDescription")}</p>
                <div className="mt-2 flex items-center gap-2 text-xs text-slate-500"><Check className="h-3.5 w-3.5" /> {t("manage.pwa.previewCheck")}</div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </main>
  )
}
