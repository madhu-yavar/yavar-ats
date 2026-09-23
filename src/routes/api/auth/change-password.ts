/**
 * POST /api/auth/change-password — signed-in password change.
 * Verifies the current password, stores the new scrypt hash, and revokes every
 * OTHER session (the device making the change keeps its session).
 */
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, ne } from "drizzle-orm";

import { db } from "../../../server/db";
import { sessions, users } from "@db/schema";
import { hashPassword, verifyAnyPassword } from "../../../server/password";
import { resolveSession, SESSION_COOKIE } from "../../../server/identity";

function currentToken(request: Request): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join("="));
  }
  return null;
}

export const Route = createFileRoute("/api/auth/change-password")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const session = await resolveSession(request);
          if (!session) {
            return Response.json({ error: "Not signed in." }, { status: 401 });
          }

          const body = (await request.json().catch(() => ({}))) as {
            currentPassword?: string;
            newPassword?: string;
          };
          const currentPassword = body.currentPassword ?? "";
          const newPassword = body.newPassword ?? "";
          if (newPassword.length < 8) {
            return Response.json(
              { error: "New password must be at least 8 characters." },
              { status: 400 },
            );
          }

          const [user] = await db
            .select({ id: users.id, passwordHash: users.passwordHash })
            .from(users)
            .where(eq(users.id, session.userId))
            .limit(1);
          if (!user?.passwordHash) {
            return Response.json({ error: "Account not found." }, { status: 404 });
          }
          if (!(await verifyAnyPassword(currentPassword, user.passwordHash))) {
            return Response.json({ error: "Current password is incorrect." }, { status: 401 });
          }

          const { createHash } = await import("node:crypto");
          const keepHash = createHash("sha256")
            .update(currentToken(request) ?? "")
            .digest("hex");
          await db.transaction(async (tx) => {
            await tx
              .update(users)
              .set({ passwordHash: await hashPassword(newPassword) })
              .where(eq(users.id, user.id));
            await tx
              .delete(sessions)
              .where(and(eq(sessions.userId, user.id), ne(sessions.tokenHash, keepHash)));
          });

          return Response.json({
            ok: true,
            message: "Password updated — every other device was signed out.",
          });
        } catch (err) {
          console.error("Change password failed", err);
          return Response.json(
            { error: "Could not update the password. Please try again in a moment." },
            { status: 503 },
          );
        }
      },
    },
  },
});
