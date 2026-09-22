/**
 * POST /api/auth/reset — sets a new password from a signed reset token and
 * revokes every existing session for that user.
 */
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";

import { db } from "../../../server/db";
import { sessions, users } from "@db/schema";
import { verifyActionToken } from "../../../server/action-token";
import { hashPassword } from "../../../server/password";

export const Route = createFileRoute("/api/auth/reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            token?: string;
            password?: string;
          };
          const password = body.password ?? "";
          if (password.length < 8) {
            return Response.json(
              { error: "Password must be at least 8 characters." },
              { status: 400 },
            );
          }
          const verified = verifyActionToken(body.token ?? "", "password-reset");
          if (!verified) {
            return Response.json(
              { error: "This reset link has expired. Request a new one." },
              { status: 400 },
            );
          }

          const passwordHash = await hashPassword(password);
          const [row] = await db
            .update(users)
            .set({ passwordHash, emailConfirmedAt: new Date() })
            .where(eq(users.id, verified.userId))
            .returning({ id: users.id });
          if (!row) {
            return Response.json({ error: "Account not found." }, { status: 404 });
          }
          await db.delete(sessions).where(eq(sessions.userId, verified.userId));

          return Response.json({
            ok: true,
            message: "Password updated — sign in with your new password.",
          });
        } catch (err) {
          return Response.json(
            { error: (err as Error).message || "Could not update the password." },
            { status: 500 },
          );
        }
      },
    },
  },
});
