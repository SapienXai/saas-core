import { getWorkspaceDomainManagementData } from "@/lib/domains/domain-service"
import { DomainManagement } from "@/components/manage/domain-management"
import { ManagePage, ManagePageHeader } from "@/components/manage/manage-responsive"

export const dynamic = "force-dynamic"

export default async function DomainsPage() {
  const data = await getWorkspaceDomainManagementData()
  return <ManagePage><ManagePageHeader eyebrow="Workspace" title="Domains" description={`Manage the addresses connected to ${data.workspace.name}.`} /><DomainManagement entry={{ workspace: data.workspace, domain: data.domain, instructions: data.instructions, hostedUrl: `https://${data.workspace.slug}.${process.env.SAAS_CORE_ROOT_DOMAIN || "saas.example.com"}`, customDomainEnabled: data.customDomainEnabled, customDomainTarget: data.customDomainTarget, providerConfigured: data.providerConfigured, customDomainSetupConfigured: Boolean(data.customDomainTarget) }} /></ManagePage>
}
