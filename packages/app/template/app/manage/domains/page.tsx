import { Link2 } from "lucide-react"
import { getWorkspaceDomainManagementData } from "@/lib/domains/domain-service"
import { DomainManagement } from "@/components/manage/domain-management"

export const dynamic = "force-dynamic"

export default async function DomainsPage() {
  const data = await getWorkspaceDomainManagementData()
  return <div className="min-h-full"><div className="mx-auto max-w-5xl space-y-6"><div className="flex items-center gap-3"><div className="flex h-10 w-10 items-center justify-center rounded-xl bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-200"><Link2 className="h-5 w-5" /></div><div><p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-600 dark:text-violet-300">Workspace</p><h1 className="text-2xl font-bold tracking-tight text-slate-950 dark:text-white">Domains</h1><p className="mt-1 text-sm text-slate-500 dark:text-slate-400">Manage the addresses connected to {data.workspace.name}.</p></div></div><DomainManagement entry={{ workspace: data.workspace, domain: data.domain, instructions: data.instructions, hostedUrl: `https://${data.workspace.slug}.${process.env.SAAS_CORE_ROOT_DOMAIN || "saas.example.com"}`, customDomainEnabled: data.customDomainEnabled, customDomainTarget: data.customDomainTarget, providerConfigured: data.providerConfigured, customDomainSetupConfigured: Boolean(data.customDomainTarget) }} /></div></div>
}
