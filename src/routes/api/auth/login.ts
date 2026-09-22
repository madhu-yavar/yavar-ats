/**
 * POST /api/auth/login — first-party password sign-in.
 * Verifies the scrypt hash in our own Postgres and establishes the
 * atsiq_session httpOnly cookie. No Supabase/Lovable involvement.
 */
import { createFileRoute } from "@tanstack/react-router";
import { eq } from "drizzle-orm";

import { db } from "../../../server/db";
import { users } from "@db/schema";
import { verifyPassword } from "../../../server/password";
import { createSession, sessionCookie } from "../../../server/identity";

export const Route = createFileRoute("/api/auth/login")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const body = (await request.json().catch(() => ({}))) as {
            email?: string;
            password?: string;
          };
          const email = (body.email ?? "").trim().toLowerCase();
          const password = body.password ?? "";

          const [user] = await db
            .select({
              id: users.id,
              email: users.email,
              passwordHash: users.passwordHash,
              emailConfirmedAt: users.emailConfirmedAt,
            })
            .from(users)
            .where(eq(users.email, email))
            .limit(1);

          const ok = user?.passwordHash
            ? await verifyPassword(password, user.passwordHash)
            : false;
          if (!user || !ok) {
            return Response.json({ error: "Invalid email or password." }, { status: 401 });
          }
          if (!user.emailConfirmedAt) {
            return Response.json(
              { error: "Confirm your email address first — check your inbox for the link." },
              { status: 403 },
            );
          }

          const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
          const token = await createSession(user.id, {
            ip,
            userAgent: request.headers.get("user-agent"),
          });
          await db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, user.id));

          return new Response(JSON.stringify({ ok: true, email: user.email }), {
            status: 200,
            headers: { "content-type": "application/json", "set-cookie": sessionCookie(token) },
          });
        } catch (err) {
          return Response.json({ error: (err as Error).message || "Sign-in failed." }, { status: 500 });
        }
      },
    },
  },
});
