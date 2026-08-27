"use client"

import { useState, useTransition } from "react"
import Link from "next/link"
import { Check, Download, FileSpreadsheet, Loader2, Plus, Upload, X } from "lucide-react"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { confirmPlatformRestaurantImportAction, previewPlatformRestaurantImportAction, syncPlatformRestaurantWebsiteAssetsAction } from "@/app/platform/actions"
import { PlatformAddRestaurantWizard } from "@/components/platform/platform-add-restaurant-wizard"

type Props = { canWrite: boolean }

export function PlatformRestaurantControls({ canWrite }: Props) {
  const [createOpen, setCreateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  if (!canWrite) return null
  return (
    <>
      <Button type="button" onClick={() => setCreateOpen(true)} className="min-h-11 gap-2 bg-violet-500 text-white hover:bg-violet-400"><Plus className="h-4 w-4" />Add restaurant</Button>
      <Button type="button" variant="outline" onClick={() => setImportOpen(true)} className="min-h-11 gap-2 border-white/10 bg-white/[0.04] text-slate-200 hover:bg-white/[0.08]"><Upload className="h-4 w-4" />Import Excel</Button>
      <PlatformAddRestaurantWizard open={createOpen} onOpenChange={setCreateOpen} />
      <ImportRestaurantDialog open={importOpen} onOpenChange={setImportOpen} />
    </>
  )
}

function ImportRestaurantDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [mode, setMode] = useState<"create" | "update">("create")
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload")
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const [result, setResult] = useState<any>(null)
  const [assetResult, setAssetResult] = useState<any>(null)
  const [pending, startTransition] = useTransition()

  function reset() { setMode("create"); setStep("upload"); setFile(null); setPreview(null); setResult(null); setAssetResult(null) }
  function close(next: boolean) { if (!pending) { if (!next) reset(); onOpenChange(next) } }
  function upload() {
    if (!file) return
    const form = new FormData()
    form.set("file", file)
    form.set("mode", mode)
    startTransition(async () => {
      const response = await previewPlatformRestaurantImportAction(form)
      if (response.success) { setPreview(response); setStep("preview") } else toast.error(response.message)
    })
  }
  function confirm() {
    if (!preview?.batch?.id) return
    startTransition(async () => {
      const response = await confirmPlatformRestaurantImportAction(preview.batch.id)
      if (response.success) {
        setResult(response)
        setStep("result")
        const restaurantIds = (response.rows || []).filter((row: any) => row.row_status === "created" || row.row_status === "updated").map((row: any) => row.restaurant_id).filter(Boolean)
        if (restaurantIds.length) {
          const assets = await syncPlatformRestaurantWebsiteAssetsAction(restaurantIds)
          if (assets.success) setAssetResult(assets)
          else toast.error(assets.message)
        }
      } else toast.error(response.message)
    })
  }
  const rows = preview?.rows || []
  const summary = { total: rows.length, ready: rows.filter((row: any) => row.status === "ready").length, warnings: rows.filter((row: any) => row.status === "warning").length, errors: rows.filter((row: any) => row.status === "error").length, valid: rows.filter((row: any) => row.status !== "error").length }
  const updateMode = mode === "update"
  return <Dialog open={open} onOpenChange={close}><DialogContent className="max-h-[min(92dvh,52rem)] overflow-y-auto border-white/10 bg-slate-950 text-white sm:max-w-5xl sm:rounded-2xl"><DialogHeader><DialogTitle className="flex items-center gap-2 text-white"><FileSpreadsheet className="h-5 w-5 text-emerald-300" />{updateMode ? "Update restaurants from Excel" : "Import restaurants from Excel"}</DialogTitle><DialogDescription className="text-slate-400">{updateMode ? "Existing platform restaurants are matched by slug or unique business email. Their restaurant and workspace IDs remain unchanged." : "Server-side validation creates a private batch snapshot. Nothing is created until you confirm."}</DialogDescription></DialogHeader>
    {step === "upload" ? <div className="space-y-5"><div className="grid gap-3 sm:grid-cols-2"><button type="button" onClick={() => setMode("create")} className={`rounded-2xl border p-4 text-left transition ${!updateMode ? "border-violet-400/60 bg-violet-500/[0.12]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}><p className="text-sm font-semibold text-white">Create new restaurants</p><p className="mt-1 text-xs text-slate-400">Add new platform-created restaurants and workspaces.</p></button><button type="button" onClick={() => setMode("update")} className={`rounded-2xl border p-4 text-left transition ${updateMode ? "border-amber-400/60 bg-amber-500/[0.12]" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"}`}><p className="text-sm font-semibold text-white">Update existing restaurants</p><p className="mt-1 text-xs text-slate-400">Match by public slug or unique business email. No duplicates are created.</p></button></div><div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4"><div><p className="text-sm font-semibold text-white">Start with the official template</p><p className="mt-1 text-xs text-slate-500">.xlsx only · up to 500 rows · macros and formula cells are rejected</p></div><Button asChild variant="outline" className="min-h-10 gap-2 border-white/10 text-slate-200"><a href="/api/platform/restaurants/import-template"><Download className="h-4 w-4" />Download template</a></Button></div><label htmlFor="restaurant-import-file" className="flex min-h-40 cursor-pointer flex-col items-center justify-center rounded-2xl border border-dashed border-violet-400/30 bg-violet-500/[0.06] px-5 text-center hover:bg-violet-500/[0.1]"><Upload className="h-7 w-7 text-violet-300" /><span className="mt-3 text-sm font-semibold text-white">Choose an .xlsx workbook</span><span className="mt-1 text-xs text-slate-500">The same uploader accepts the current 22-column list and the simpler Reservevia template.</span><input id="restaurant-import-file" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(event) => setFile(event.target.files?.[0] || null)} /></label>{file ? <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm"><span className="truncate text-slate-300">{file.name}</span><button type="button" onClick={() => setFile(null)} className="text-slate-500 hover:text-white" aria-label="Remove file"><X className="h-4 w-4" /></button></div> : null}<DialogFooter><Button type="button" disabled={!file || pending} onClick={upload} className="min-h-11 bg-violet-500 text-white hover:bg-violet-400">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}Validate and preview</Button></DialogFooter></div> : null}
    {step === "preview" ? <div className="space-y-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-4">{[["Total", summary.total, "text-slate-200"], ["Ready", summary.ready, "text-emerald-300"], ["Warnings", summary.warnings, "text-amber-300"], ["Errors", summary.errors, "text-rose-300"]].map(([label, value, color]) => <div key={String(label)} className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-3"><p className="text-[10px] uppercase tracking-[0.14em] text-slate-600">{label}</p><p className={`mt-1 text-xl font-semibold ${color}`}>{value}</p></div>)}</div><div className="overflow-x-auto rounded-2xl border border-white/10"><table className={updateMode ? "min-w-[900px] w-full text-left text-sm" : "min-w-[760px] w-full text-left text-sm"}><thead className="border-b border-white/10 bg-white/[0.03] text-[10px] uppercase tracking-[0.12em] text-slate-500"><tr><th className="px-3 py-3">Row</th><th className="px-3 py-3">Restaurant</th>{updateMode ? <th className="px-3 py-3">Match</th> : null}<th className="px-3 py-3">Business email</th><th className="px-3 py-3">Domain</th><th className="px-3 py-3">Slug</th><th className="px-3 py-3">Status</th><th className="px-3 py-3">Messages</th></tr></thead><tbody className="divide-y divide-white/10">{rows.map((row: any) => <tr key={row.excelRowNumber}><td className="px-3 py-3 text-slate-500">{row.excelRowNumber}</td><td className="px-3 py-3 font-medium text-white">{row.payload.name}</td>{updateMode ? <td className="px-3 py-3 text-xs text-slate-300">{row.matchName ? <><span className="block font-medium text-white">{row.matchName}</span><span className="text-slate-500">by {row.matchMethod === "public_slug" ? "slug" : "business email"}</span></> : <span className="text-rose-300">No match</span>}</td> : null}<td className="px-3 py-3 text-slate-300">{row.payload.business_contact_email}</td><td className="px-3 py-3 text-slate-300">{row.payload.official_domain}</td><td className="px-3 py-3 text-slate-300">{row.payload.slug}</td><td className="px-3 py-3"><span className={row.status === "error" ? "text-rose-300" : row.status === "warning" ? "text-amber-300" : "text-emerald-300"}>{row.status === "error" ? "Error" : row.status === "warning" ? "Warning" : "Ready"}</span></td><td className="max-w-[18rem] px-3 py-3 text-xs text-slate-500">{row.messages?.join(" ") || "—"}</td></tr>)}</tbody></table></div><DialogFooter className="gap-2 sm:gap-2"><Button type="button" variant="outline" onClick={() => setStep("upload")} className="min-h-11 border-white/10 text-slate-300">Back</Button><Button type="button" disabled={pending || summary.valid === 0} onClick={confirm} className="min-h-11 bg-emerald-500 text-slate-950 hover:bg-emerald-400">{pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}{updateMode ? `Update ${summary.valid} valid restaurants` : `Import ${summary.valid} valid restaurants`}</Button></DialogFooter></div> : null}
    {step === "result" ? <div className="space-y-4"><div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/[0.08] p-4"><p className="font-semibold text-white">{updateMode ? "Update finished" : "Import finished"}</p><p className="mt-1 text-sm text-slate-300">{updateMode ? `Updated ${result?.batch?.updated_rows || 0}` : `Created ${result?.batch?.created_rows || 0}`} · Failed {result?.batch?.failed_rows || 0} · Invalid {result?.batch?.invalid_rows || 0}</p><p className="mt-2 text-xs text-slate-400">{pending ? "Finding and securely copying website data and images…" : assetResult ? `${assetResult.results.filter((item: any) => item.result?.logo?.status === "imported" || item.result?.primary?.status === "imported").length} restaurants received website assets. ${assetResult.results.filter((item: any) => item.enrichment?.updatedFields?.length).length} profiles were completed from missing official website data.${assetResult.results.filter((item: any) => item.enrichment && !item.enrichment.success).length ? " Some website fields could not be saved and can be retried." : ""} Missing images do not block the import.` : "Website data enrichment is still pending."}</p></div><div className="space-y-2">{(result?.rows || []).map((row: any) => <div key={row.id || row.excel_row_number} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-3 text-sm"><span className="text-slate-300">Excel row {row.excel_row_number}</span>{row.publicUrl ? <Link href={row.publicUrl} target="_blank" className="text-violet-300 hover:text-violet-200">Open public page</Link> : <span className="text-rose-300">{row.failure_reason || "Failed"}</span>}</div>)}</div><DialogFooter><Button type="button" disabled={pending} onClick={() => close(false)} className="min-h-11 bg-white text-slate-950 hover:bg-slate-100">{pending ? "Processing website data…" : "Done"}</Button></DialogFooter></div> : null}
  </DialogContent></Dialog>
}
