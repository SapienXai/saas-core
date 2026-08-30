import { Activity, CheckCircle2, CircleAlert, Database, Globe2, Users, WalletCards } from "lucide-react"
import { ManageDataView, ManageMetricCard, ManageMetricGrid } from "@/components/manage/manage-responsive"
import { PlatformPageHeader, PlatformSurface, PlatformStatusBadge } from "@/components/platform/platform-primitives"

export function formatPlatformTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date)} UTC`
}

function PlatformCell({ columnKey, value }: { columnKey: string; value: unknown }) {
  if (columnKey === "status") return <PlatformStatusBadge status={String(value || "unknown")} />
  if ((columnKey.endsWith("_at") || columnKey.endsWith("_date")) && typeof value === "string") return <time dateTime={value} title={value}>{formatPlatformTimestamp(value)}</time>
  return String(value ?? "—")
}

export function PlatformOverview({ counts, role }: { counts: { workspaces: number; users: number; subscriptions: number; domains: number; events24h: number }; role: string }) {
  const cards = [["Workspaces", counts.workspaces, Users], ["Members", counts.users, Users], ["Subscriptions", counts.subscriptions, WalletCards], ["Connected domains", counts.domains, Globe2], ["Audit events · 24h", counts.events24h, Activity]] as const
  return <div className="space-y-5"><PlatformPageHeader eyebrow="Platform" title="Operational overview" description="A compact read on workspaces, access, billing, domains and activity." /><ManageMetricGrid wide>{cards.map(([label, value, Icon]) => <ManageMetricCard key={label} label={label} value={value} icon={Icon} detail={label === "Audit events · 24h" ? "Recent platform activity" : "Across all workspaces"} />)}</ManageMetricGrid><PlatformSurface className="p-4 sm:p-5"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" /></span><div><h3 className="font-semibold text-slate-950 dark:text-white">Platform access is active</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">Signed in with the <span className="font-semibold text-slate-800 dark:text-slate-200">{role}</span> role. Sensitive changes remain server-authorized and audited.</p></div></div></PlatformSurface></div>
}

export function PlatformCollection({ title, description, rows, columns }: { title: string; description: string; rows: Array<Record<string, unknown>>; columns: Array<{ key: string; label: string }> }) {
  const desktop = <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead className="border-b border-slate-200 text-xs uppercase tracking-[0.12em] text-slate-500 dark:border-white/10"><tr>{columns.map((column) => <th key={column.key} className="px-4 py-3 font-semibold">{column.label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-white/10">{rows.map((row, index) => <tr key={String(row.id || row.key || row.user_id || index)} className="text-slate-700 dark:text-slate-300">{columns.map((column) => <td key={column.key} className="max-w-[20rem] truncate px-4 py-3.5"><PlatformCell columnKey={column.key} value={row[column.key]} /></td>)}</tr>)}</tbody></table></div>
  const mobile = <div className="divide-y divide-slate-100 dark:divide-white/10">{rows.map((row, index) => <article key={String(row.id || row.key || row.user_id || index)} className="space-y-2.5 p-3.5"><div className="min-w-0 truncate text-sm font-semibold text-slate-900 dark:text-white"><PlatformCell columnKey={columns[0]?.key || "value"} value={row[columns[0]?.key || "value"]} /></div><div className="grid grid-cols-2 gap-x-4 gap-y-2">{columns.slice(1).map((column) => <div key={column.key} className="min-w-0"><p className="truncate text-[10px] font-bold uppercase tracking-[0.1em] text-slate-400 dark:text-slate-500">{column.label}</p><div className="mt-0.5 truncate text-xs text-slate-700 dark:text-slate-200"><PlatformCell columnKey={column.key} value={row[column.key]} /></div></div>)}</div></article>)}</div>
  return <div className="space-y-5"><PlatformPageHeader eyebrow="Platform" title={title} description={description} /><PlatformSurface className="overflow-hidden"><ManageDataView desktop={desktop} mobile={mobile} />{rows.length === 0 && <div className="p-10 text-center text-sm text-slate-500"><Database className="mx-auto mb-3 h-5 w-5" />No records yet.</div>}</PlatformSurface></div>
}

export function PlatformAttention({ title = "Attention", description = "Review operational signals and recent activity." }: { title?: string; description?: string }) { return <PlatformSurface className="p-5"><div className="flex items-start gap-3"><CircleAlert className="h-5 w-5 text-amber-600 dark:text-amber-300" /><div><h3 className="font-semibold text-slate-950 dark:text-white">{title}</h3><p className="mt-1 text-sm text-slate-600 dark:text-slate-400">{description}</p></div></div></PlatformSurface> }
