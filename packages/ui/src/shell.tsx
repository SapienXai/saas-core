import type { ReactNode } from "react"
import { AppShellClient } from "./shell-client.js"
import type { WorkspaceOption } from "./views.js"

export type NavIconName = "layout-dashboard" | "users" | "credit-card" | "shield-check" | "settings" | "activity" | "globe" | "bell" | "folder" | "chart" | "help" | "plus" | "circle"
export type NavItem = { label: string; href: string; icon?: NavIconName | string; badge?: string; active?: boolean; disabled?: boolean }
export type NavigationGroup = { label: string; items: NavItem[] }
export type AppShellProps = { productName: string; userEmail?: string | null; nav?: NavItem[]; navigationGroups?: NavigationGroup[]; workspaces?: WorkspaceOption[]; currentWorkspaceId?: string; brand?: { name?: string; logo?: string; icon?: string }; children: ReactNode }

export function AppShell(props: AppShellProps) {
  return <AppShellClient {...props} />
}

export function AuthShell({ productName, brand, children }: { productName: string; brand?: AppShellProps["brand"]; children: ReactNode }) {
  return <main className="sc-auth-page"><div className="sc-auth-glow" aria-hidden="true" /><section className="sc-auth-card"><a className="sc-brand" href="/"><span className="sc-brand-mark">{brand?.icon ?? productName.slice(0, 1).toUpperCase()}</span><span className="sc-brand-copy"><strong>{brand?.name ?? productName}</strong><small>Secure workspace platform</small></span></a>{children}</section></main>
}
