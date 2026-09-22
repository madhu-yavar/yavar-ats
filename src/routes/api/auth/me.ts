import { createFileRoute } from "@tanstack/react-router";
import { and, eq, gt } from "drizzle-orm";

import { db } from "@/server/db";
import { sessions, users } from "@db/schema";
import { SESSION_COOKIE } from "@/server/identity";
import { jsonOk } from "@/server/http";

function cookieValue(request: Request, name: string): string | null {
  const header = request.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Who is signed in, for the client shell. Always 200; `user` is null when signed out. */
export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const raw = cookieValue(request, SESSION_COOKIE);
        if (!raw || raw.length < 32) return jsonOk({ user: null });
        const { createHash } = await import("node:crypto");
        const tokenHash = createHash("sha256").update(raw).digest("hex");
        const [row] = await db
          .select({
            id: users.id,
            email: users.email,
            fullName: users.fullName,
            emailConfirmedAt: users.emailConfirmedAt,
            sessionId: sessions.id,
          })
          .from(sessions)
          .innerJoin(users, eq(users.id, sessions.userId))
          .where(and(eq(sessions.tokenHash, tokenHash), gt(sessions.expiresAt, new Date())))
          .limit(1);
        if (!row) return jsonOk({ user: null });

        // Sliding window: every authenticated page view extends the session.
        await db
          .update(sessions)
          .set({ lastUsedAt: new Date(), expiresAt: new Date(Date.now() + 7 * 864e5) })
          .where(eq(sessions.id, row.sessionId));

        return jsonOk({
          user: {
            id: row.id,
            email: row.email,
            full_name: row.fullName,
            email_confirmed_at: row.emailConfirmedAt,
          },
        });
      },
    },
  },
});
