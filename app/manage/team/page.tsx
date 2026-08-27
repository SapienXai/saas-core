import { redirect } from "next/navigation"
import { getTeamManagementData } from "@/app/manage/team/actions"
import { TeamManagement } from "@/app/manage/team/team-management"

export const dynamic = "force-dynamic"

export default async function TeamPage() {
  const result = await getTeamManagementData()
  if (!result.success || !result.data) redirect("/manage")
  return <TeamManagement initialData={result.data} />
}
