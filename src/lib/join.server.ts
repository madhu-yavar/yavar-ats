/**
 * Invitation-accept page support: verify a signed join token and describe the
 * invitation for the /join page. Server-only.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../server/db";
import { organizations, orgMembers, users } from "@db/schema";
import { verifyActionToken } from "../server/action-token";

export interface JoinInviteView {
  valid: true;
  email: string;
  orgName: string;
  roleLabel: string;
  inviterName: string | null;
}

const ROLE_LABELS: Record<string, string> = {
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  department_head: "Department head",
  hr_head: "HR head",
  president_cbo: "President / CBO",
};

export async function verifyJoinToken(token: string): Promise<JoinInviteView | null> {
  const verified = verifyActionToken(token, "org-invite");
  if (!verified) return null;

  const [member] = await db
    .select({
      email: orgMembers.email,
      invitedRole: orgMembers.invitedRole,
      invitedBy: orgMembers.invitedBy,
      orgName: organizations.name,
    })
    .from(orgMembers)
    .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
    .where(
      and(
        eq(orgMembers.id, verified.userId),
        eq(orgMembers.status, "invited"),
      ),
    )
    .limit(1);
  if (!member) return null;

  let inviterName: string | null = null;
  if (member.invitedBy) {
    const [inviter] = await db
      .select({ fullName: users.fullName })
      .from(users)
      .where(eq(users.id, member.invitedBy))
      .limit(1);
    inviterName = inviter?.fullName ?? null;
  }

  return {
    valid: true,
    email: member.email.toLowerCase(),
    orgName: member.orgName,
    roleLabel: ROLE_LABELS[member.invitedRole ?? ""] ?? "Team member",
    inviterName,
  };
}
