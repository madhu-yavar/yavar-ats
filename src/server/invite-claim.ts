/**
 * Invite claiming — shared by login (auto-claim on first sign-in) and the
 * claim server function. An invite is the org_members row created when a
 * colleague is added: status "invited", user_id null, carrying the role they
 * will receive. Claiming binds the signed-in user to that row and grants the
 * role. The org must be active; archived/pending tenants keep their invites
 * waiting.
 */
import { and, eq, ilike, isNull } from "drizzle-orm";

import { db } from "./db";
import { organizations, orgMembers, userRoles } from "@db/schema";
import { writeAudit } from "./audit";

export interface ClaimedInvite {
  orgId: string;
  orgName: string;
  role: string | null;
}

export async function claimPendingInviteForUser(
  userId: string,
  email: string,
): Promise<ClaimedInvite | null> {
  const normalized = email.trim().toLowerCase();

  const [invite] = await db
    .select({
      id: orgMembers.id,
      orgId: orgMembers.orgId,
      invitedRole: orgMembers.invitedRole,
      orgName: organizations.name,
      orgStatus: organizations.status,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(
      and(
        ilike(orgMembers.email, normalized),
        isNull(orgMembers.userId),
        eq(orgMembers.status, "invited"),
      ),
    )
    .orderBy(orgMembers.createdAt)
    .limit(1);
  if (!invite) return null;
  // A pending tenant keeps its invites waiting — the member joins on approval.
  if (invite.orgStatus !== "active") return null;

  // user_id is null in the guard, so a race claims exactly once.
  const claimed = await db
    .update(orgMembers)
    .set({ userId, status: "active", joinedAt: new Date() })
    .where(and(eq(orgMembers.id, invite.id), isNull(orgMembers.userId)))
    .returning({ id: orgMembers.id });
  if (!claimed.length) return null;

  if (invite.invitedRole) {
    try {
      await db.insert(userRoles).values({ userId, role: invite.invitedRole, orgId: invite.orgId });
    } catch {
      // role already granted by a racing claim — membership is what matters
    }
  }

  await writeAudit({
    actor: normalized,
    actorUserId: userId,
    orgId: invite.orgId,
    action: "member.claimed_invite",
    entityType: "org_member",
    entityId: invite.id,
    detail: { role: invite.invitedRole },
  });

  return { orgId: invite.orgId, orgName: invite.orgName, role: invite.invitedRole };
}
