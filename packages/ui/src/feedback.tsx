import type { ReactNode } from "react"
import { Badge, Button, Card, Progress } from "./primitives.js"
import { cn, formatStatus } from "./utils.js"

export type StatusTone = "neutral" | "success" | "warning" | "danger" | "info"
export function getStatusLabel(status: string): { label: string; tone: StatusTone } {
  const normalized = status.toLowerCase()
  if (["active", "verified", "connected", "processed", "pass", "healthy", "configured"].includes(normalized)) return { label: formatStatus(status), tone: "success" }
  if (["past_due", "pending", "processing", "warning", "unverified", "optional"].includes(normalized)) return { label: formatStatus(status), tone: "warning" }
  if (["failed", "error", "blocked", "restricted"].includes(normalized)) return { label: formatStatus(status), tone: "danger" }
  if (["info", "new"].includes(normalized)) return { label: formatStatus(status), tone: "info" }
  return { label: formatStatus(status), tone: "neutral" }
}

export function StatusBadge({ status, label }: { status: string; label?: string }) { const result = getStatusLabel(status); return <Badge tone={result.tone}>{label ?? result.label}</Badge> }
export function EmptyState({ title, description, action, icon = "✦" }: { title: string; description: string; action?: ReactNode; icon?: ReactNode }) { return <Card className="sc-empty-state"><div className="sc-empty-icon" aria-hidden="true">{icon}</div><h2>{title}</h2><p>{description}</p>{action}</Card> }
export function LoadingState({ label = "Loading" }: { label?: string }) { return <div className="sc-state" role="status"><span className="sc-spinner" aria-hidden="true" />{label}…</div> }
export function ErrorState({ title = "Something went wrong", description, action }: { title?: string; description: string; action?: ReactNode }) { return <div className="sc-state sc-state-error" role="alert"><strong>{title}</strong><p>{description}</p>{action}</div> }
export function UsageMeter({ label, used, limit }: { label: string; used: number; limit: number | null }) { const ratio = limit === null ? 0 : limit === 0 ? 100 : Math.min(100, (used / limit) * 100); return <div className="sc-usage"><div className="sc-usage-label"><span>{label}</span><strong>{limit === null ? `${used} · Unlimited` : `${used} / ${limit}`}</strong></div>{limit !== null && <Progress value={ratio} aria-label={`${label} usage`} />}</div> }
export function BillingStatus({ status, plan }: { status: string; plan: string }) { return <div className="sc-billing-status"><div className="sc-inline"><StatusBadge status={status} /><strong>{plan}</strong></div><span>Access follows the verified Core billing state.</span></div> }
export function PlanCard({ name, planKey = name.toLowerCase(), price, features, current = false, action, interval = "month" }: { name: string; planKey?: string; price: string; features: string[]; current?: boolean; action?: string; interval?: "month" | "year" }) { const control = current ? <Button type="button" disabled variant="secondary">Current plan</Button> : action ? <form action={action} method="post"><input type="hidden" name="planKey" value={planKey} /><input type="hidden" name="interval" value={interval} /><Button type="submit">Choose plan</Button></form> : <Button type="button" disabled variant="outline" title="Billing action is not configured">Billing unavailable</Button>; return <Card className={cn("sc-plan-card", current && "sc-plan-card-current")}><div className="sc-card-kicker">{current ? "Current plan" : "Available plan"}</div><h3>{name}</h3><strong className="sc-plan-price">{price}</strong><ul>{features.map((feature) => <li key={feature}>{feature}</li>)}</ul>{control}</Card> }
