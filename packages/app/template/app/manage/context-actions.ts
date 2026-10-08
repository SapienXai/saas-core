"use server"
import { cookies } from "next/headers"
import { requireProductCapability, requireWorkspaceAccess } from "@/lib/authorization"
import { getWorkspaceUsage } from "@/lib/entitlements"
export async function selectWorkspace(workspaceId: string) { await requireProductCapability("workspaceManagement"); await requireWorkspaceAccess(workspaceId); (await cookies()).set("saas_core_workspace_id", workspaceId, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 90, path: "/" }); return { success: true } }
export async function getManagementUsage(workspaceId: string) { try { await requireWorkspaceAccess(workspaceId); return { success: true, data: await getWorkspaceUsage(workspaceId) } } catch { return { success: false, data: null } } }
