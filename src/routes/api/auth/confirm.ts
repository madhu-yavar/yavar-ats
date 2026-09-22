/**
 * GET /api/auth/confirm?token=… — marks the user's email confirmed and
 * redirects into the app to sign in.
 */
import { createFileRoute } from "@tanstack/react-router";
import { and, eq, isNull } from "drizzle-orm";

import { db } from "../../../server/db";
import { users } from "@db/schema";
import { verifyActionToken } from "../../../server/action-token";

export const Route = createFileRoute("/api/auth/confirm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const origin = process.env["PUBLIC_SITE_URL"] ?? url.origin;
        const token = url.searchParams.get("token") ?? "";
        const verified = verifyActionToken(token, "email-confirm");
        if (!verified) {
          return Response.redirect(`${origin}/?confirm=invalid`, 302);
        }
        const [row] = await db
          .update(users)
          .set({ emailConfirmedAt: new Date() })
          .where(and(eq(users.id, verified.userId), isNull(users.emailConfirmedAt)))
          .returning({ id: users.id });
        if (!row) return Response.redirect(`${origin}/?confirm=used`, 302);
        return Response.redirect(`${origin}/?confirmed=1`, 302);
      },
    },
  },
});
