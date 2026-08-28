"use client"
import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { getManagementUsage } from "@/app/manage/context-actions"
type ManageUser = { id: string; email: string; name: string }
export type ManageWorkspacePlan = { key: string; name: string; pricing?: Record<string, { amount: number | null; currency: string }>; features?: Record<string, boolean>; limits?: Record<string, number | null>; scheduledPlan?: { key: string; name: string; effectiveAt: string; limits: Record<string, number | null> } | null }
export type ManageUsage = { workspaces: number; users: number; metrics: Record<string, number>; periodStart: string; periodEnd: string }
export type ManagePlanCatalogItem = { key: string; name: string; sortOrder: number; metadata?: Record<string, unknown> }
export type ManageInitialContext = { user: ManageUser; role: string | null; platformRole: string | null; isSuperAdmin: boolean; memberships: Array<{ workspaceId: string; role: string; workspace?: { id: string; name: string; slug: string; status: string } | null }>; currentWorkspace: { id: string; role: string; workspace?: { id: string; name: string; slug: string; status: string } | null; plan?: ManageWorkspacePlan | null; usage?: ManageUsage | null; customPwaEnabled?: boolean; pushNotificationsEnabled?: boolean } | null; planCatalog: ManagePlanCatalogItem[]; ownedWorkspaceId: string | null; canCreateWorkspace: boolean }
type ManageContextType = ManageInitialContext & { loading: boolean; refreshRole: (force?: boolean) => Promise<void>; updateCurrentWorkspacePlan: (plan: ManageWorkspacePlan) => void }
const emptyUser = { id: "", email: "", name: "" }
const defaultValue: ManageContextType = { user: emptyUser, role: null, platformRole: null, isSuperAdmin: false, loading: true, refreshRole: async () => {}, updateCurrentWorkspacePlan: () => {}, memberships: [], currentWorkspace: null, planCatalog: [], ownedWorkspaceId: null, canCreateWorkspace: false }
const ManageContext = createContext<ManageContextType>(defaultValue)
export function ManageProvider({ children, initialContext }: { children: React.ReactNode; initialContext?: ManageInitialContext | null }) {
  const supabase = getSupabaseBrowserClient(); const [state, setState] = useState<ManageInitialContext>(initialContext || { user: emptyUser, role: null, platformRole: null, isSuperAdmin: false, memberships: [], currentWorkspace: null, planCatalog: [], ownedWorkspaceId: null, canCreateWorkspace: false }); const [loading, setLoading] = useState(!initialContext)
  useEffect(() => { if (initialContext) { setState(initialContext); setLoading(false) } }, [initialContext])
  const updateCurrentWorkspacePlan = useCallback((plan: ManageWorkspacePlan) => setState((current) => ({ ...current, currentWorkspace: current.currentWorkspace ? { ...current.currentWorkspace, plan: { ...current.currentWorkspace.plan, ...plan } } : null })), [])
  const refreshRole = useCallback(async (force = false) => { if (initialContext && !force) { setLoading(false); return }; setLoading(true); try { const { data } = await supabase.auth.getSession(); if (!data.session?.user) { setState((current) => ({ ...current, user: emptyUser, role: null, platformRole: null, isSuperAdmin: false, memberships: [], currentWorkspace: null, ownedWorkspaceId: null })); return }; const response = await fetch("/api/me/role", { cache: "no-store" }); const json = await response.json(); setState((current) => ({ ...current, ...json, user: json.user || current.user, memberships: Array.isArray(json.memberships) ? json.memberships : [], currentWorkspace: json.currentWorkspace || null })) } catch { setState((current) => ({ ...current, role: null, platformRole: null, memberships: [], currentWorkspace: null })) } finally { setLoading(false) } }, [initialContext, supabase])
  useEffect(() => { void refreshRole() }, [refreshRole])
  const workspaceId = state.currentWorkspace?.id
  const workspaceHasUsage = Boolean(state.currentWorkspace?.usage)
  useEffect(() => { if (!workspaceId || workspaceHasUsage) return; let active = true; void getManagementUsage(workspaceId).then((result) => { if (active && result.success && result.data) setState((current) => current.currentWorkspace ? { ...current, currentWorkspace: { ...current.currentWorkspace, usage: result.data } } : current) }).catch(() => undefined); return () => { active = false } }, [workspaceHasUsage, workspaceId])
  const value = useMemo(() => ({ ...state, loading, refreshRole, updateCurrentWorkspacePlan }), [state, loading, refreshRole, updateCurrentWorkspacePlan])
  return <ManageContext.Provider value={value}>{children}</ManageContext.Provider>
}
export function useManageContext() { return useContext(ManageContext) }
