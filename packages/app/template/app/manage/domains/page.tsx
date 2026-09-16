import { getWorkspaceDomainManagementData } from "@/lib/domains/domain-service"
import { DomainManagement } from "@/components/manage/domain-management"
import { ManagePage, ManagePageHeader } from "@/components/manage/manage-responsive"

export const dynamic = "force-dynamic"

export default async function DomainsPage() {
  const data = await getWorkspaceDomainManagementData()
  return <ManagePage><ManagePageHeader eyebrow="Workspace" title="Domains" description={`Manage the addresses connected to ${data.workspace.name}.`} /><DomainManagement entry={{ workspace: data.workspace, siteId: data.site.id, productKey: data.productKey, platformDomain: data.platformDomain, domain: data.domain, instructions: data.instructions, hostedUrl: data.hostedUrl, rootDomain: data.rootDomain, customDomainEnabled: data.customDomainEnabled, customDomainTarget: data.customDomainTarget, providerConfigured: data.providerConfigured, customDomainSetupConfigured: Boolean(data.customDomainTarget) }} /></ManagePage>
}
