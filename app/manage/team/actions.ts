"use server"

import { revalidatePath } from "next/cache"
import { createSupabaseServerClient } from "@/lib/supabase/server"
import { createServiceRoleClient } from "@/lib/supabase"
import { AuthorizationError, getCurrentWorkspace, requireWorkspaceRole } from "@/lib/authorization"
import { getWorkspaceEntitlements, getWorkspaceUsage } from "@/lib/entitlements"
import {
  createInvitationToken,
  hashInvitationToken,
  INVITATION_RESEND_COOLDOWN_SECONDS,
} from "@/lib/invitations"
import { sendWorkspaceInvitationEmail } from "@/lib/invitation-email"
import { getServerLanguage } from "@/lib/server-i18n"
import { getEmailMessages } from "@/i18n/email-messages"

const INVITABLE_ROLES = new Set(["admin", "manager", "staff"])
const MANAGED_ROLES = new Set(["admin", "manager", "staff"])

function friendlyError(error: unknown) {
  const message = error instanceof Error ? error.message : ""
  const known: Record<string, string> = {
    AUTH_REQUIRED: "Please sign in to continue.",
    WORKSPACE_ACCESS_REQUIRED: "You do not have access to this workspace.",
    TEAM_MANAGEMENT_REQUIRED: "Only workspace owners and admins can manage the team.",
    ROLE_HIERARCHY_REJECTED: "You do not have permission to assign that role.",
    ALREADY_MEMBER: "This person is already a member.",
    INVITATION_ALREADY_PENDING: "An invitation is already pending for this email.",
    USER_LIMIT_REACHED: "There are no available team seats on the current plan.",
    INVALID_RESTAURANT_SELECTION: "Choose restaurants from this workspace only.",
    RESTAURANT_SELECTION_REQUIRED: "Choose at least one restaurant.",
    INVALID_INVITATION_EMAIL: "Enter a valid email address.",
    MEMBER_NOT_FOUND: "Member not found.",
    OWNER_PROTECTED: "The workspace owner cannot be changed.",
  }
  const key = Object.keys(known).find((candidate) => message.includes(candidate))
  return key ? known[key] : "We could not complete that team action."
}

function canManageTarget(actorRole: string, targetRole: string) {
  if (!MANAGED_ROLES.has(targetRole)) return false
  if (actorRole === "owner") return true
  return actorRole === "admin" && ["manager", "staff"].includes(targetRole)
}

async function currentAdminWorkspace() {
  const membership = await getCurrentWorkspace()
  if (!membership) throw new AuthorizationError("FORBIDDEN", "No active workspace is available.")
  const result = await requireWorkspaceRole(membership.workspace_id, ["owner", "admin"])
  return { ...result, workspaceId: membership.workspace_id }
}

async function loadRestaurantNames(workspaceId: string) {
  const { data, error } = await createServiceRoleClient()
    .from("restaurants")
    .select("id, name, slug, status")
    .eq("workspace_id", workspaceId)
    .order("name", { ascending: true })
  if (error) throw new Error(error.message)
  return data || []
}

function invitationStatus(invitation: { accepted_at: string | null; revoked_at: string | null; expires_at: string }) {
  if (invitation.accepted_at) return "accepted" as const
  if (invitation.revoked_at) return "revoked" as const
  return new Date(invitation.expires_at).getTime() <= Date.now() ? "expired" as const : "pending" as const
}

export async function getTeamManagementData() {
  try {
    const { access, membership, workspaceId } = await currentAdminWorkspace()
    const service = createServiceRoleClient()
    const [workspaceResult, membersResult, invitationsResult, restaurants, entitlements, usage] = await Promise.all([
      service.from("workspaces").select("id, name, slug").eq("id", workspaceId).single(),
      service.from("workspace_members").select("id, user_id, role, restaurant_access_mode, created_at, workspace_member_restaurants(restaurant_id)").eq("workspace_id", workspaceId).order("created_at", { ascending: true }),
      service.from("workspace_invitations").select("id, email, role, restaurant_access_mode, expires_at, accepted_at, revoked_at, last_sent_at, email_delivery_status, delivery_error, created_at, workspace_invitation_restaurants(restaurant_id)").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
      loadRestaurantNames(workspaceId),
      getWorkspaceEntitlements(workspaceId),
      getWorkspaceUsage(workspaceId),
    ])
    if (workspaceResult.error || !workspaceResult.data) throw new Error(workspaceResult.error?.message || "Workspace could not be loaded.")
    if (membersResult.error) throw new Error(membersResult.error.message)
    if (invitationsResult.error) throw new Error(invitationsResult.error.message)

    const memberRows = await Promise.all((membersResult.data || []).map(async (member) => {
      const { data } = await service.auth.admin.getUserById(member.user_id)
      return {
        id: member.id,
        userId: member.user_id,
        email: data.user?.email || "Unknown email",
        name: typeof data.user?.user_metadata?.full_name === "string" ? data.user.user_metadata.full_name : null,
        role: member.role,
        restaurantAccessMode: member.restaurant_access_mode,
        restaurantIds: (member.workspace_member_restaurants || []).map((row) => row.restaurant_id),
        createdAt: member.created_at,
        isOwner: member.role === "owner",
      }
    }))

    const invitations = (invitationsResult.data || []).map((invitation) => ({
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      restaurantAccessMode: invitation.restaurant_access_mode,
      restaurantIds: (invitation.workspace_invitation_restaurants || []).map((row) => row.restaurant_id),
      expiresAt: invitation.expires_at,
      acceptedAt: invitation.accepted_at,
      revokedAt: invitation.revoked_at,
      lastSentAt: invitation.last_sent_at,
      emailDeliveryStatus: invitation.email_delivery_status,
      deliveryError: invitation.delivery_error,
      status: invitationStatus(invitation),
    }))
    const pendingCount = invitations.filter((invitation) => invitation.status === "pending").length

    return {
      success: true,
      data: {
        workspace: workspaceResult.data,
        currentRole: access.workspaceRole || membership.role || "admin",
        members: memberRows,
        invitations,
        restaurants,
        entitlements,
        usage: { ...usage, pendingInvitations: pendingCount, seatUsage: usage.users },
      },
    }
  } catch (error) {
    console.error("Reservevia team data load failed", error)
    return { success: false, message: friendlyError(error) }
  }
}

export async function createWorkspaceInvitation(input: {
  email: string
  role: "admin" | "manager" | "staff"
  restaurantAccessMode?: "all" | "selected"
  restaurantIds?: string[]
}) {
  try {
    const { access, workspaceId } = await currentAdminWorkspace()
    if (!INVITABLE_ROLES.has(input.role)) return { success: false, message: "That role cannot be invited." }
    const email = input.email.trim().toLowerCase()
    const token = createInvitationToken()
    const tokenHash = hashInvitationToken(token)
    const selectedIds = Array.from(new Set(input.restaurantIds || []))
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.rpc("create_workspace_invitation", {
      target_workspace_id: workspaceId,
      target_email: email,
      target_role: input.role,
      target_access_mode: input.role === "admin" ? "all" : input.restaurantAccessMode || "all",
      target_selected_restaurant_ids: selectedIds,
      target_token_hash: tokenHash,
    })
    if (error || !data?.[0]) {
      return { success: false, message: friendlyError(error || new Error("Invitation was not created.")) }
    }

    const service = createServiceRoleClient()
    const [{ data: workspace }, { data: inviter }] = await Promise.all([
      service.from("workspaces").select("name").eq("id", workspaceId).single(),
      service.auth.admin.getUserById(access.userId),
    ])
    const invitation = data[0]
    const language = await getServerLanguage()
    const invitationCopy = getEmailMessages(language).invitation
    const delivery = await sendWorkspaceInvitationEmail({
      to: email,
      token,
      workspaceName: workspace?.name || "your Reservevia workspace",
      inviterLabel: inviter.user?.user_metadata?.full_name || inviter.user?.email || "A workspace administrator",
      role: input.role,
      accessLabel: input.role === "admin" || input.restaurantAccessMode === "all" ? invitationCopy.allRestaurants : `${selectedIds.length} ${selectedIds.length === 1 ? invitationCopy.selectedRestaurant : invitationCopy.selectedRestaurants}`,
      expiresAt: invitation.expires_at,
      lang: language,
    })
    await service.from("workspace_invitations").update({
      email_delivery_status: delivery.success ? "sent" : "failed",
      delivery_error: delivery.success ? null : "Invitation email could not be delivered.",
      updated_at: new Date().toISOString(),
    }).eq("id", invitation.invitation_id)

    revalidatePath("/manage/team")
    return {
      success: true,
      warning: delivery.success ? null : "Invitation created, but email delivery failed. You can retry sending it.",
    }
  } catch (error) {
    console.error("Reservevia invitation creation failed", error)
    return { success: false, message: friendlyError(error) }
  }
}

export async function resendWorkspaceInvitation(invitationId: string) {
  try {
    const { workspaceId } = await currentAdminWorkspace()
    const service = createServiceRoleClient()
    const { data: invitation, error } = await service
      .from("workspace_invitations")
      .select("id, workspace_id, email, role, restaurant_access_mode, expires_at, accepted_at, revoked_at, last_sent_at, workspace_invitation_restaurants(restaurant_id)")
      .eq("id", invitationId)
      .eq("workspace_id", workspaceId)
      .maybeSingle()
    if (error || !invitation) return { success: false, message: "Invitation not found." }
    if (invitation.accepted_at || invitation.revoked_at) return { success: false, message: "That invitation is no longer pending." }
    if (Date.now() - new Date(invitation.last_sent_at).getTime() < INVITATION_RESEND_COOLDOWN_SECONDS * 1000) {
      return { success: false, message: "Please wait a moment before resending this invitation." }
    }
    const token = createInvitationToken()
    const { error: updateError } = await service.from("workspace_invitations").update({
      token_hash: hashInvitationToken(token),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      last_sent_at: new Date().toISOString(),
      email_delivery_status: "pending",
      delivery_error: null,
      updated_at: new Date().toISOString(),
    }).eq("id", invitationId).eq("workspace_id", workspaceId)
    if (updateError) throw new Error(updateError.message)
    const { data: workspace } = await service.from("workspaces").select("name").eq("id", workspaceId).single()
    const language = await getServerLanguage()
    const invitationCopy = getEmailMessages(language).invitation
    const delivery = await sendWorkspaceInvitationEmail({
      to: invitation.email,
      token,
      workspaceName: workspace?.name || "your Reservevia workspace",
      inviterLabel: "A workspace administrator",
      role: invitation.role,
      accessLabel: invitation.restaurant_access_mode === "all" ? invitationCopy.allRestaurants : `${invitation.workspace_invitation_restaurants?.length || 0} ${invitationCopy.selectedRestaurants}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      lang: language,
    })
    await service.from("workspace_invitations").update({ email_delivery_status: delivery.success ? "sent" : "failed", delivery_error: delivery.success ? null : "Invitation email could not be delivered.", updated_at: new Date().toISOString() }).eq("id", invitationId)
    revalidatePath("/manage/team")
    return { success: true, warning: delivery.success ? null : "The invitation was renewed, but email delivery failed." }
  } catch (error) {
    console.error("Reservevia invitation resend failed", error)
    return { success: false, message: friendlyError(error) }
  }
}

export async function revokeWorkspaceInvitation(invitationId: string) {
  try {
    const { workspaceId } = await currentAdminWorkspace()
    const { error } = await createServiceRoleClient().from("workspace_invitations").update({ revoked_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq("id", invitationId).eq("workspace_id", workspaceId).is("accepted_at", null)
    if (error) throw new Error(error.message)
    revalidatePath("/manage/team")
    return { success: true }
  } catch (error) {
    return { success: false, message: friendlyError(error) }
  }
}

export async function updateWorkspaceMember(input: { memberId: string; role: "admin" | "manager" | "staff"; restaurantAccessMode?: "all" | "selected"; restaurantIds?: string[] }) {
  try {
    const { workspaceId } = await currentAdminWorkspace()
    const mode = input.role === "admin" ? "all" : input.restaurantAccessMode || "all"
    const ids = Array.from(new Set(input.restaurantIds || []))
    const supabase = await createSupabaseServerClient()
    const { error } = await supabase.rpc("update_workspace_member", {
      target_workspace_id: workspaceId,
      target_member_id: input.memberId,
      target_role: input.role,
      target_access_mode: mode,
      target_selected_restaurant_ids: ids,
    })
    if (error) throw error
    revalidatePath("/manage/team")
    return { success: true }
  } catch (error) {
    return { success: false, message: friendlyError(error) }
  }
}

export async function removeWorkspaceMember(memberId: string) {
  try {
    const { access, workspaceId } = await currentAdminWorkspace()
    const service = createServiceRoleClient()
    const { data: target } = await service.from("workspace_members").select("id, user_id, role").eq("id", memberId).eq("workspace_id", workspaceId).maybeSingle()
    if (!target) return { success: false, message: "Member not found." }
    if (target.user_id === access.userId || target.role === "owner" || !canManageTarget(access.workspaceRole || access.role, target.role)) {
      return { success: false, message: "The workspace owner cannot be removed, and you cannot remove this member." }
    }
    const { error } = await service.from("workspace_members").delete().eq("id", memberId).eq("workspace_id", workspaceId)
    if (error) throw new Error(error.message)
    revalidatePath("/manage/team")
    return { success: true }
  } catch (error) {
    return { success: false, message: friendlyError(error) }
  }
}

export async function canInviteCurrentWorkspace() {
  try {
    const { workspaceId } = await currentAdminWorkspace()
    const [entitlements, usage] = await Promise.all([getWorkspaceEntitlements(workspaceId), getWorkspaceUsage(workspaceId)])
    return { success: true, canInvite: usage.users < (entitlements.limits.users ?? Number.MAX_SAFE_INTEGER), limit: entitlements.limits.users, usage: usage.users }
  } catch {
    return { success: false, canInvite: false, limit: null, usage: 0 }
  }
}
