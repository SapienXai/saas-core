# Reservevia team and multi-restaurant management

Phase 7 completes the first paid team-seat and Business multi-location workflow without changing the reservation engine or making `admin_profiles` a second authorization source.

## Membership model

```text
Supabase Auth user
  └── workspace_members (one role per workspace)
        ├── restaurant_access_mode = all | selected
        └── workspace_member_restaurants (selected IDs)
```

`workspace_members` remains authoritative. `owner` and `admin` are workspace-wide. `manager` and `staff` may be workspace-wide (`all`) or limited to normalized selected restaurant rows. `readonly` remains a legacy compatibility role and is not an invitation option. Roles are not duplicated per restaurant.

Owner permissions are protected: ownership transfer, multiple owners, and owner demotion/removal are intentionally deferred. Owners may manage Admin/Manager/Staff. Admins may manage Manager/Staff but cannot create or modify an Owner or another Admin. Managers and Staff have no team, billing, domain, or restaurant-creation authority.

## Invitations

`workspace_invitations` contains the workspace, normalized email, invited role, access mode, inviter, SHA-256 token hash, seven-day expiry, delivery state, and accepted/revoked timestamps. The plaintext token exists only in the invitation URL/email. `workspace_invitation_restaurants` stores selected access as normalized rows.

The active invitation uniqueness index prevents duplicate pending invitations for the same workspace/email. Pending invitations reserve user capacity. The `create_workspace_invitation` SECURITY DEFINER function locks the workspace subscription, rechecks membership plus pending-seat limits, validates role hierarchy and restaurant ownership, and creates the invitation/assignments transactionally. The `accept_workspace_invitation` function locks the invitation and subscription, checks expiry/revocation/replay, compares the authenticated Supabase email, rechecks the current seat limit, then creates membership and assignments atomically. A user can join multiple workspaces through invitations but can self-create only one customer workspace.

Resend rotates the token hash, invalidates the prior link, extends expiry, and observes a short cooldown. Revoke preserves minimal lifecycle history while immediately freeing the reserved seat. Invitation delivery is a Reservevia system email, separate from reservation notification entitlements; provider failure leaves the pending invitation available for retry.

## Authorization and RLS

All team writes are server actions or authenticated RPCs. Browser clients cannot insert/update/delete memberships, invitations, selected-access rows, or invitation assignments. `update_workspace_member` performs role and access-mode changes, workspace restaurant validation, membership update, mapping replacement, and owner/hierarchy checks in one transaction.

The same access predicate is used at the application and database layers:

- Owner/Admin: all restaurants in the workspace.
- Manager/Staff with `all`: all restaurants in the workspace.
- Manager/Staff with `selected`: only mapped restaurant IDs.

The predicate propagates to restaurants, reservations, reservation areas, restaurant media/settings, push subscriptions, Storage assets, and domain reads. Workspace and commercial tables remain workspace-scoped. A user’s role in Workspace A never grants access to Workspace B.

Existing Felix members are backfilled to `restaurant_access_mode = all`, preserving their historical access to all four inherited restaurants. No Felix production system or database is touched.

## Management UX

`/manage/team` is the Owner/Admin team surface. It displays active members, pending invitations, roles, restaurant access, invitation expiry/delivery status, and `active members + pending invitations / plan user limit`. Single-restaurant customers see a short form with no unnecessary location complexity. Multi-restaurant invitations can choose all or selected restaurants; single-restaurant access is automatically scoped to that restaurant.

The old `/manage/users` path redirects to `/manage/team`. There is no global user directory. Removing a member removes only the workspace membership and selected mappings; it never deletes the Supabase Auth account or another workspace membership.

The management shell has compact HttpOnly-preference switchers for current workspace and active restaurant. A user with one workspace and one accessible restaurant sees neither selector. `All Restaurants` is available only on aggregate-capable views; restaurant profile, domains, booking settings, seating/areas, and other settings require a specific authorized restaurant. Preferences are not authorization and are revalidated on every server action/query.

## Business restaurants

The existing restaurant creation action now represents both the initial onboarding restaurant and later Business additions. A later restaurant is created unpublished with safe reservation defaults and then uses the existing profile editor. The action derives the workspace from the authenticated Owner/Admin membership, checks `multiRestaurant`, checks the database-backed restaurant limit, and validates a global stable slug. Free/Starter/Pro second-restaurant requests are rejected. Business allows only up to its catalog limit for new resources; grandfathered Felix resources remain intact and do not make the fourth restaurant disappear.

The restaurant list provides a simple multi-location overview with public/profile management links. Dashboard, reservation, and report reads are scoped to accessible restaurant IDs before data is returned, and rows retain restaurant identity when multiple locations are shown. Public URLs and custom domains remain restaurant-owned and continue to use the Phase 6 resolver/public URL service.

## Test boundary and future work

The local integration suite covers seat reservation, role hierarchy, hashed tokens, wrong-email acceptance, replay prevention, direct-write blocking, selected restaurant RLS, transactional member scope updates, Business restaurant-limit concurrency, and multi-restaurant isolation. Remaining future work includes ownership transfer, invitations with richer product analytics, custom permission matrices, enterprise directory integration, restaurant archive/deletion lifecycle, and a more advanced aggregate dashboard.
