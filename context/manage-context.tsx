"use client"

import type React from "react"
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react"
import { getSupabaseBrowserClient } from "@/lib/supabase/client"
import { setManageOfflineCacheScope } from "@/lib/manage-offline-cache"
import { getManagementUsage } from "@/app/manage/context-actions"

type ManageUser = {
  id: string
  email: string
  name: string
}

export type ManageWorkspacePlan = {
  key: string
  name: string
  monthlyPriceUsdCents: number
  features?: { multiRestaurant?: boolean }
  limits?: { restaurants: number | null; users: number | null; reservationsPerPeriod: number | null }
  scheduledPlan?: {
    key: string
    name: string
    effectiveAt: string
    limits: { restaurants: number | null; users: number | null; reservationsPerPeriod: number | null }
  } | null
  restaurantCount?: number
}

export type ManageInitialContext = {
  user: ManageUser
  role: string | null
  platformRole: string | null
  isSuperAdmin: boolean
  memberships: Array<{ workspaceId: string; role: string; workspace?: { id: string; name: string; slug: string; status: string } | null }>
  currentWorkspace: {
    id: string
    role: string
    accessMode: string
    publicBrandUrl?: string | null
    workspace?: { id: string; name: string; slug: string; status: string } | null
    plan?: ManageWorkspacePlan | null
    usage?: { restaurants: number; users: number; reservationsCreated: number; periodStart: string; periodEnd: string } | null
  } | null
  ownedWorkspaceId: string | null
  restaurants: Array<{ id: string; name: string; slug: string; status: string; workspace_id?: string | null; meal_only_reservations?: boolean }>
  activeRestaurantId: string | null
  canCreateWorkspace: boolean
}

type ManageContextType = ManageInitialContext & {
  loading: boolean
  refreshRole: (force?: boolean) => Promise<void>
  updateCurrentWorkspacePlan: (plan: ManageWorkspacePlan) => void
}

const defaultValue: ManageContextType = {
  user: { id: "", email: "", name: "" },
  role: null,
  platformRole: null,
  isSuperAdmin: false,
  loading: true,
  refreshRole: async () => {},
  updateCurrentWorkspacePlan: () => {},
  memberships: [],
  currentWorkspace: null,
  ownedWorkspaceId: null,
  restaurants: [],
  activeRestaurantId: null,
  canCreateWorkspace: false,
}

const ManageContext = createContext<ManageContextType>(defaultValue)

export function ManageProvider({ children, initialContext }: { children: React.ReactNode; initialContext?: ManageInitialContext | null }) {
  const supabase = getSupabaseBrowserClient()
  const [user, setUser] = useState<ManageUser>(initialContext?.user || { id: "", email: "", name: "" })
  const [role, setRole] = useState<string | null>(initialContext?.role ?? null)
  const [platformRole, setPlatformRole] = useState<string | null>(initialContext?.platformRole ?? null)
  const [isSuperAdmin, setIsSuperAdmin] = useState(Boolean(initialContext?.isSuperAdmin))
  const [loading, setLoading] = useState(!initialContext)
  const [memberships, setMemberships] = useState<ManageContextType["memberships"]>(initialContext?.memberships || [])
  const [currentWorkspace, setCurrentWorkspace] = useState<ManageContextType["currentWorkspace"]>(initialContext?.currentWorkspace || null)
  const [ownedWorkspaceId, setOwnedWorkspaceId] = useState<string | null>(initialContext?.ownedWorkspaceId || null)
  const [restaurants, setRestaurants] = useState<ManageContextType["restaurants"]>(initialContext?.restaurants || [])
  const [activeRestaurantId, setActiveRestaurantId] = useState<string | null>(initialContext?.activeRestaurantId || null)
  const [canCreateWorkspace, setCanCreateWorkspace] = useState(initialContext?.canCreateWorkspace ?? false)

  useEffect(() => {
    if (!initialContext) return
    setUser(initialContext.user)
    setRole(initialContext.role)
    setPlatformRole(initialContext.platformRole)
    setIsSuperAdmin(initialContext.isSuperAdmin)
    setMemberships(initialContext.memberships)
    setCurrentWorkspace(initialContext.currentWorkspace)
    setOwnedWorkspaceId(initialContext.ownedWorkspaceId)
    setRestaurants(initialContext.restaurants)
    setActiveRestaurantId(initialContext.activeRestaurantId)
    setCanCreateWorkspace(initialContext.canCreateWorkspace)
    setLoading(false)
  }, [initialContext])

  const updateCurrentWorkspacePlan = useCallback((plan: ManageWorkspacePlan) => {
    setCurrentWorkspace((current) => {
      if (!current) return current
      return {
        ...current,
        plan: {
          ...(current.plan || {}),
          ...plan,
          restaurantCount: plan.restaurantCount ?? current.plan?.restaurantCount,
        },
      }
    })
  }, [])

  const refreshRole = useCallback(async (force = false) => {
    // The server layout already authenticated and resolved this request's
    // access context. Avoid an extra auth round-trip during first hydration;
    // forced refreshes still revalidate the browser session when needed.
    if (initialContext && !force) {
      setLoading(false)
      return
    }
    setLoading(true)
    try {
      const { data } = await supabase.auth.getSession()
      const sessionUser = data.session?.user
      if (sessionUser) {
        setUser({
          id: sessionUser.id,
          email: sessionUser.email || "",
          name: typeof sessionUser.user_metadata?.full_name === "string" ? sessionUser.user_metadata.full_name : "",
        })
      }
      if (!sessionUser) {
        setUser({ id: "", email: "", name: "" })
        setRole(null)
        setPlatformRole(null)
        setIsSuperAdmin(false)
        setMemberships([]); setCurrentWorkspace(null); setRestaurants([]); setActiveRestaurantId(null)
        setOwnedWorkspaceId(null)
        return
      }

      const res = await fetch("/api/me/role", { cache: "no-store" })
      const json = await res.json()
      if (json?.user && typeof json.user.id === "string") {
        setUser({
          id: json.user.id,
          email: typeof json.user.email === "string" ? json.user.email : "",
          name: typeof json.user.name === "string" ? json.user.name : "",
        })
      }
      setRole(json?.role ?? null)
      setPlatformRole(json?.platformRole ?? null)
      setIsSuperAdmin(Boolean(json?.isSuperAdmin))
      setMemberships(Array.isArray(json?.memberships) ? json.memberships : [])
      setCurrentWorkspace(json?.currentWorkspace || null)
      setOwnedWorkspaceId(typeof json?.ownedWorkspaceId === "string" ? json.ownedWorkspaceId : null)
      setRestaurants(Array.isArray(json?.restaurants) ? json.restaurants : [])
      setActiveRestaurantId(json?.activeRestaurantId || null)
      if (typeof json?.canCreateWorkspace === "boolean") setCanCreateWorkspace(json.canCreateWorkspace)
    } catch {
      setRole(null)
      setPlatformRole(null)
      setIsSuperAdmin(false)
      setMemberships([]); setCurrentWorkspace(null); setRestaurants([]); setActiveRestaurantId(null)
      setOwnedWorkspaceId(null)
    } finally {
      setLoading(false)
    }
  }, [initialContext, supabase])

  useEffect(() => {
    refreshRole()
  }, [refreshRole])

  useEffect(() => {
    setManageOfflineCacheScope(user.id && currentWorkspace?.id ? `${user.id}:${currentWorkspace.id}` : null)
  }, [currentWorkspace?.id, user.id])

  useEffect(() => {
    const workspaceId = currentWorkspace?.id
    if (!workspaceId || currentWorkspace?.usage) return
    let active = true
    void getManagementUsage(workspaceId).then((result) => {
      if (!active || !result.success || !result.data) return
      setCurrentWorkspace((current) => current ? { ...current, usage: result.data } : current)
    }).catch(() => undefined)
    return () => { active = false }
  }, [currentWorkspace?.id, currentWorkspace?.usage])

  const value = useMemo(
    () => ({ user, role, platformRole, isSuperAdmin, loading, refreshRole, updateCurrentWorkspacePlan, memberships, currentWorkspace, ownedWorkspaceId, restaurants, activeRestaurantId, canCreateWorkspace }),
    [user, role, platformRole, isSuperAdmin, loading, refreshRole, updateCurrentWorkspacePlan, memberships, currentWorkspace, ownedWorkspaceId, restaurants, activeRestaurantId, canCreateWorkspace]
  )

  return <ManageContext.Provider value={value}>{children}</ManageContext.Provider>
}

export function useManageContext() {
  return useContext(ManageContext)
}
