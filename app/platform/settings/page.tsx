import { PlatformSettingEditor } from "@/components/platform/platform-settings-controls"
import { listPlatformSettings } from "@/lib/platform-admin"
import { canWritePlatform, requirePlatformRole } from "@/lib/platform-authorization"

export const dynamic = "force-dynamic"

const DEFAULT_SETTINGS = [
  { key: "maintenance_mode", value: false },
  { key: "maintenance_message", value: "" },
  { key: "signup_enabled", value: true },
  { key: "support_email", value: "support@reservevia.com" },
  { key: "default_locale", value: "en" },
  { key: "default_timezone", value: "Europe/Istanbul" },
]

export default async function PlatformSettingsPage() {
  const [{ role }, stored] = await Promise.all([requirePlatformRole(), listPlatformSettings()])
  const storedByKey = new Map(stored.map((item: any) => [item.key, item]))
  const settings = DEFAULT_SETTINGS.map((item) => storedByKey.get(item.key) || item)
  return <div className="space-y-6"><div><p className="text-sm font-semibold text-violet-300">Operations</p><h2 className="mt-2 text-3xl font-bold text-white">Platform settings</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">Only non-secret operational flags belong here. API keys and provider secrets remain deployment environment variables.</p></div><div className="space-y-3">{settings.map((setting) => <PlatformSettingEditor key={setting.key} setting={setting} canEdit={canWritePlatform(role)} />)}</div></div>
}
