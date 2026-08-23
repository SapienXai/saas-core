export { InMemorySaaSStore } from "@sapienx/saas-core"
export type { Membership, Workspace, WorkspaceStatus } from "@sapienx/saas-core"

export function workspaceSelector(workspaces: readonly { id: string; name: string; slug: string }[], currentId: string | null) {
  return workspaces.map((workspace) => ({ ...workspace, current: workspace.id === currentId }))
}
