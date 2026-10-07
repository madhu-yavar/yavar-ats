/**
 * POST /api/auth/join — accept an organisation invitation via the signed
 * join link from the invite email. Proves mailbox ownership (the link arrived
 * in the invitee's inbox), sets the first password, confirms the email,
 * claims the membership with the invited role, and signs the user in.
 */
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../../../server/db";
import { organizations, orgMembers, userRoles, users } from "@db/schema";
import { hashPassword } from "../../../server/password";
import { passwordProblem } from "../../../lib/password-policy";
import { verifyActionToken } from "../../../server/action-token";
import { createSession, sessionCookie } from "../../../server/identity";
import { writeAudit } from "../../../server/audit";

export const Route = createFileRoute("/api/auth/join")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            token?: string;
            password?: string;
            fullName?: string;
          };
          const token = (body.token ?? "").trim();
          const password = body.password ?? "";
          const fullName = (body.fullName ?? "").trim() || null;
          if (!token) return Response.json({ error: "Join link missing." }, { status: 400 });

          const verified = verifyActionToken(token, "org-invite");
          if (!verified) {
            return Response.json(
              { error: "This invitation link is invalid or has expired — ask for a new invite." },
              { status: 400 },
            );
          }
          const memberId = verified.userId;

          const policyProblem = passwordProblem(password);
          if (policyProblem) return Response.json({ error: policyProblem }, { status: 400 });

          const [member] = await db
            .select({
              id: orgMembers.id,
              orgId: orgMembers.orgId,
              email: orgMembers.email,
              invitedRole: orgMembers.invitedRole,
              orgName: organizations.name,
              orgStatus: organizations.status,
            })
            .from(orgMembers)
            .innerJoin(organizations, eq(organizations.id, orgMembers.orgId))
            .where(and(eq(orgMembers.id, memberId), isNull(orgMembers.userId)))
            .limit(1);
          if (!member) {
            return Response.json(
              { error: "This invitation has already been used or was removed." },
              { status: 410 },
            );
          }
          if (member.orgStatus !== "active") {
            return Response.json(
              { error: `${member.orgName} is not active yet — try again once it is live.` },
              { status: 400 },
            );
          }

          const email = member.email.toLowerCase();
          const passwordHash = await hashPassword(password);

          const [existing] = await db
            .select({ id: users.id, confirmed: users.emailConfirmedAt })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

          let userId: string;
          if (existing) {
            // The join link proves mailbox ownership — setting a first password
            // on an unconfirmed account is safe. A confirmed account keeps its
            // password and simply claims the invite after signing in.
            if (existing.confirmed) {
              return Response.json(
                {
                  ok: true,
                  existing: true,
                  email,
                  message: "You already have an ATSIQ account — sign in and the invitation will be applied.",
                },
                { headers: { "content-type": "application/json" } },
              );
            }
            await db
              .update(users)
              .set({ passwordHash, emailConfirmedAt: new Date(), fullName })
              .where(eq(users.id, existing.id));
            userId = existing.id;
          } else {
            const [created] = await db
              .insert(users)
              .values({ email, passwordHash, fullName, emailConfirmedAt: new Date() })
              .returning({ id: users.id });
            if (!created) throw new Error("Could not create the account.");
            userId = created.id;
          }

          const claimed = await db
            .update(orgMembers)
            .set({ userId, status: "active", joinedAt: new Date() })
            .where(and(eq(orgMembers.id, member.id), isNull(orgMembers.userId)))
            .returning({ id: orgMembers.id });
          if (!claimed.length) {
            return Response.json(
              { error: "This invitation has already been used." },
              { status: 410 },
            );
          }
          if (member.invitedRole) {
            try {
              await db
                .insert(userRoles)
                .values({ userId, role: member.invitedRole, orgId: member.orgId });
            } catch {
              /* racing claim already granted the role */
            }
          }

          await writeAudit({
            actor: email,
            actorUserId: userId,
            orgId: member.orgId,
            action: "member.joined_via_invite",
            entityType: "org_member",
            entityId: member.id,
            detail: { role: member.invitedRole },
          });

          const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
          const sessionToken = await createSession(userId, {
            ip,
            userAgent: request.headers.get("user-agent"),
          });

          return new Response(JSON.stringify({ ok: true, email, orgName: member.orgName }), {
            status: 200,
            headers: {
              "content-type": "application/json",
              "set-cookie": sessionCookie(sessionToken, request),
            },
          });
        } catch (err) {
          console.error("Invite join failed", err);
          return Response.json(
            { error: "Joining is temporarily unavailable. Please try again in a moment." },
            { status: 503 },
          );
        }
      },
    },
  },
});
