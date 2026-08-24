import type { ReactNode } from "react"
function getStatusLabel(status: string): { tone: StatusTone } {
  if (["active", "verified", "connected", "processed", "pass"].includes(status)) return { tone: "success" }
  if (["past_due", "pending", "processing", "warning"].includes(status)) return { tone: "warning" }
  if (["failed", "error", "blocked"].includes(status)) return { tone: "danger" }
  return { tone: "neutral" }
}
type StatusTone = "neutral" | "success" | "warning" | "danger" | "info"

export type WorkspaceOption = { id: string; name: string; slug: string }
export type AppShellProps = { productName: string; userEmail?: string | null; nav?: Array<{ label: string; href: string; active?: boolean }>; workspaces?: WorkspaceOption[]; currentWorkspaceId?: string; children: ReactNode }

export function AppShell({ productName, userEmail, nav = [], workspaces = [], currentWorkspaceId, children }: AppShellProps) {
  return <div className="saas-shell">
    <aside className="saas-sidebar" aria-label="Application navigation">
      <a className="saas-brand" href="/app"><span className="saas-brand-mark">S</span><span><strong>{productName}</strong><small>Workspace platform</small></span></a>
      {workspaces.length > 0 && <WorkspaceSwitcher workspaces={workspaces} {...(currentWorkspaceId ? { currentId: currentWorkspaceId } : {})} />}
      <nav className="saas-nav">{nav.map((item) => <a className={item.active ? "active" : ""} href={item.href} key={item.href}>{item.label}</a>)}</nav>
      <div className="saas-sidebar-footer"><span>{userEmail ?? "Signed in"}</span><a href="/api/auth/signout">Sign out</a></div>
    </aside>
    <div className="saas-main"><header className="saas-mobile-header"><a className="saas-brand" href="/app"><span className="saas-brand-mark">S</span><strong>{productName}</strong></a><a href="/app/settings">Settings</a></header>{children}</div>
  </div>
}

export function WorkspaceSwitcher({ workspaces, currentId, name = "Workspace" }: { workspaces: WorkspaceOption[]; currentId?: string; name?: string }) {
  return <form className="saas-switcher" action="/api/workspaces/select" method="post"><label><span>{name}</span><select name="workspaceId" defaultValue={currentId ?? workspaces[0]?.id ?? ""} aria-label="Workspace">{workspaces.map((workspace) => <option value={workspace.id} key={workspace.id}>{workspace.name}</option>)}</select></label><button className="saas-button secondary" type="submit">Switch workspace</button></form>
}

export function StatusBadge({ status }: { status: string }) {
  const tone = getStatusLabel(status).tone
  return <span className={`saas-badge ${tone}`}>{status.replaceAll("_", " ")}</span>
}

export function PlanCard({ name, planKey = name.toLowerCase(), price, features, current = false, action, interval = "month" }: { name: string; planKey?: string; price: string; features: string[]; current?: boolean; action?: string; interval?: "month" | "year" }) {
  const control = current ? <button type="button" disabled>Selected</button> : action ? <form action={action} method="post"><input type="hidden" name="planKey" value={planKey} /><input type="hidden" name="interval" value={interval} /><button type="submit">Choose plan</button></form> : <button type="button" disabled title="Billing action is not configured">Billing unavailable</button>
  return <article className={`saas-plan-card ${current ? "current" : ""}`}><div className="saas-card-kicker">{current ? "Current plan" : "Available plan"}</div><h3>{name}</h3><strong className="saas-plan-price">{price}</strong><ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>{control}</article>
}

export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const ratio = limit === null ? 0 : Math.min(1, limit === 0 ? 1 : used / limit)
  return <div className="saas-usage"><div><span>{label}</span><strong>{limit === null ? `${used} · Unlimited` : `${used} / ${limit}`}</strong></div>{limit !== null && <div className="saas-progress" aria-label={`${label} usage`}><span style={{ width: `${ratio * 100}%` }} /></div>}</div>
}

export function BillingStatus({ status, plan }: { status: string; plan: string }) { return <div className="saas-billing-status"><StatusBadge status={status} /><strong>{plan}</strong><span>Local Core state controls access.</span></div> }
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) { return <div className="saas-empty"><strong>{title}</strong><p>{description}</p>{action}</div> }
export function LoadingState({ label = "Loading" }: { label?: string }) { return <div className="saas-state" role="status">{label}…</div> }
export function ErrorState({ title = "Something went wrong", description }: { title?: string; description: string }) { return <div className="saas-state error"><strong>{title}</strong><p>{description}</p></div> }
