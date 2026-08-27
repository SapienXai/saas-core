import { getPwaManagementData } from "./actions"
import { PwaManagement } from "./pwa-management"
import { getServerLanguage, translateServer } from "@/lib/server-i18n"

export const dynamic = "force-dynamic"

export default async function PwaPage() {
  const language = await getServerLanguage()
  const result = await getPwaManagementData()
  if (!result.success) {
    return <main className="mx-auto max-w-3xl p-6 text-sm text-slate-600">{translateServer(language, "manage.pwa.settingsLoadError")}</main>
  }
  return <PwaManagement initialData={result.data} />
}
