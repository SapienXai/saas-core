import { Activity, CheckCircle2, CircleAlert, Database, Globe2, Users, WalletCards } from "lucide-react"
import { ManageDataView, ManageEmptyState, ManageListRow, ManageMetricCard, ManageMetricGrid, ManagePage, ManageSurface, ManageToolbar } from "@/components/manage/manage-responsive"
import { PlatformPageHeader, PlatformStatusBadge } from "@/components/platform/platform-primitives"

export function formatPlatformTimestamp(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return `${new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "UTC" }).format(date)} UTC`
}

function PlatformCell({ columnKey, value }: { columnKey: string; value: unknown }) {
  if (columnKey === "status" || columnKey === "verification_state") return <PlatformStatusBadge status={String(value || "unknown")} />
  if ((columnKey.endsWith("_at") || columnKey.endsWith("_date")) && typeof value === "string") return <time dateTime={value} title={value}>{formatPlatformTimestamp(value)}</time>
  if (typeof value === "boolean") return value ? "Yes" : "No"
  if (Array.isArray(value)) return value.length > 0 ? value.join(" · ") : "None"
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, entry]) => {
      const label = key.replace(/^core\./, "").replaceAll(".", " ").replace(/(^|\s)\S/g, (character) => character.toUpperCase())
      const display = entry === null ? "Unlimited" : typeof entry === "boolean" ? (entry ? "Yes" : "No") : String(entry)
      return `${label}: ${display}`
    }).join(" · ")
  }
  return String(value ?? "—")
}

export function PlatformOverview({ counts, role }: { counts: { workspaces: number; users: number; subscriptions: number; domains: number; events24h: number }; role: string }) {
  const canBilling = role === "platform_owner" || role === "billing_admin"
  const cards = [["Workspaces", counts.workspaces, Users, "/platform/workspaces"], ["Members", counts.users, Users, "/platform/users"], ...(canBilling ? [["Subscriptions", counts.subscriptions, WalletCards, "/platform/billing"] as const] : []), ["Connected domains", counts.domains, Globe2, "/platform/domains"], ["Audit events · 24h", counts.events24h, Activity, "/platform/audit"]] as const
  return <ManagePage><PlatformPageHeader eyebrow="Platform" title="Overview" description="A focused operational view across workspaces, access, billing and domains." /><ManageMetricGrid wide>{cards.map(([label, value, Icon, href]) => <ManageMetricCard key={label} label={label} value={value} icon={Icon} href={href} detail={label === "Audit events · 24h" ? "Recent activity" : "All workspaces"} />)}</ManageMetricGrid><ManageSurface className="p-3.5 sm:p-4"><div className="flex items-start gap-3"><span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-300"><CheckCircle2 className="h-4 w-4" aria-hidden="true" /></span><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h2 className="text-sm font-semibold text-slate-950 dark:text-white">Platform access is active</h2><PlatformStatusBadge status="active" /></div><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">Signed in with the <span className="font-semibold text-slate-800 dark:text-slate-200">{role.replaceAll("_", " ")}</span> role.</p></div></div></ManageSurface></ManagePage>
}

export function PlatformHealth({ counts, role }: { counts: { workspaces: number; users: number; domains: number; events24h: number }; role: string }) {
  return <ManagePage><PlatformPageHeader eyebrow="Platform" title="System health" description="A concise check of the management data surfaces available to this operator." /><ManageMetricGrid><ManageMetricCard label="Management data" value="Available" detail={role.replaceAll("_", " ")} icon={CheckCircle2} /><ManageMetricCard label="Workspaces" value={counts.workspaces} detail="Readable records" icon={Database} /><ManageMetricCard label="Domains" value={counts.domains} detail="Tracked records" icon={Globe2} /><ManageMetricCard label="Audit · 24h" value={counts.events24h} detail="Recent events" icon={Activity} /></ManageMetricGrid><ManageSurface className="p-3.5 sm:p-4"><div className="flex items-start gap-3"><CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600 dark:text-emerald-300" /><div><h2 className="text-sm font-semibold text-slate-950 dark:text-white">Core management checks are responding</h2><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">The management records available to this operator are responding normally.</p></div></div></ManageSurface></ManagePage>
}

type PlatformColumn = { key: string; label: string; mobile?: boolean }
type PlatformCollectionProps = { title: string; description: string; rows: Array<Record<string, unknown>>; columns: PlatformColumn[]; query?: string; searchHref?: string; searchPlaceholder?: string }

export function PlatformCollection({ title, description, rows, columns, query = "", searchHref, searchPlaceholder = "Search records" }: PlatformCollectionProps) {
  const primary = columns[0]
  const mobileColumns = columns.slice(1).filter((column) => column.mobile !== false).slice(0, 3)
  const keyFor = (row: Record<string, unknown>, index: number) => String(row.id || row.key || row.user_id || `${title}-${index}`)
  const search = searchHref ? <ManageToolbar><form method="get" action={searchHref} className="flex min-w-0 gap-2"><label htmlFor={`platform-search-${title.replaceAll(/\s+/g, "-").toLowerCase()}`} className="sr-only">{searchPlaceholder}</label><input id={`platform-search-${title.replaceAll(/\s+/g, "-").toLowerCase()}`} name="query" defaultValue={query} placeholder={searchPlaceholder} className="h-10 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none transition placeholder:text-slate-400 focus:border-violet-500 focus:ring-4 focus:ring-violet-500/10 dark:border-white/10 dark:bg-white/[0.04] dark:text-white" /><button type="submit" className="min-h-10 rounded-lg bg-violet-600 px-3 text-xs font-bold text-white transition hover:bg-violet-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-500">Search</button></form></ManageToolbar> : null
  const desktop = <table className="w-full text-left text-sm"><thead className="border-b border-slate-200/80 text-[10px] uppercase tracking-[0.12em] text-slate-500 dark:border-white/10 dark:text-slate-400"><tr>{columns.map((column) => <th key={column.key} className="px-4 py-2.5 font-bold">{column.label}</th>)}</tr></thead><tbody className="divide-y divide-slate-100 dark:divide-white/10">{rows.map((row, index) => <tr key={keyFor(row, index)} className="text-slate-700 dark:text-slate-300">{columns.map((column) => <td key={column.key} className="max-w-[22rem] truncate px-4 py-3"><PlatformCell columnKey={column.key} value={row[column.key]} /></td>)}</tr>)}</tbody></table>
  const mobile = <div className="divide-y divide-slate-100 dark:divide-white/10">{rows.map((row, index) => <ManageListRow key={keyFor(row, index)} title={<PlatformCell columnKey={primary.key} value={row[primary.key]} />} subtitle={mobileColumns.map((column) => <span key={column.key} className="mr-2"><span className="font-medium text-slate-400">{column.label}:</span> <PlatformCell columnKey={column.key} value={row[column.key]} /></span>)} />)}</div>
  return <ManagePage><PlatformPageHeader eyebrow="Platform" title={title} description={description} /><div className="space-y-2.5">{search}<ManageSurface className="overflow-hidden"><ManageDataView desktop={desktop} mobile={mobile} />{rows.length === 0 && <ManageEmptyState icon={Database} title="No records found" description={query ? "Try a broader search." : "There is nothing to show yet."} compact />}</ManageSurface><p className="text-xs text-slate-500 dark:text-slate-400">{rows.length} record{rows.length === 1 ? "" : "s"} · latest available data</p></div></ManagePage>
}

export function PlatformAttention({ title = "Attention", description = "No open operational signals are currently reported." }: { title?: string; description?: string }) {
  return <ManagePage><PlatformPageHeader eyebrow="Platform" title={title} description={description} /><ManageSurface className="p-3.5 sm:p-4"><div className="flex items-start gap-3"><CircleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-300" aria-hidden="true" /><div><h2 className="text-sm font-semibold text-slate-950 dark:text-white">Nothing needs attention</h2><p className="mt-1 text-xs leading-5 text-slate-600 dark:text-slate-400">When a persisted platform issue is available, it will appear here with a direct action.</p></div></div></ManageSurface></ManagePage>
}
