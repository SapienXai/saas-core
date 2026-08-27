"use client"

import { useRouter } from "next/navigation"
import { useState } from "react"
import { WorkspaceUpgradeModal } from "@/components/manage/workspace-upgrade-modal"

type Props = {
  currentPlan: string
  currentWorkspaceName?: string | null
  ownedWorkspaceId?: string | null
}

export function WorkspaceCreationBlocked({ currentPlan, currentWorkspaceName, ownedWorkspaceId }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(true)

  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-[#f7f4ef] px-4 py-8">
      <WorkspaceUpgradeModal
        open={open}
        onOpenChange={(open) => {
          setOpen(open)
          if (!open) router.replace("/manage")
        }}
        currentPlan={currentPlan}
        currentWorkspaceName={currentWorkspaceName}
        ownedWorkspaceId={ownedWorkspaceId}
        onUpgrade={() => setOpen(false)}
      />
    </main>
  )
}
