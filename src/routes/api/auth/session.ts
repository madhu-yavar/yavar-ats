/**
 * Cookie-session endpoints for the httpOnly session era.
 *
 * POST /api/auth/session — the client calls this right after a successful
 *   supabase-js sign-in: the bearer JWT is verified server-side and exchanged
 *   for an httpOnly session cookie. From then on, server functions
 *   authenticate from the cookie, not from localStorage.
 * DELETE /api/auth/session — destroys the session row and clears the cookie.
 */
import { createFileRoute } from "@tanstack/react-router";

import { clearSessionCookie, destroySession, exchangeTokenForSession } from "../../../server/identity";

export const Route = createFileRoute("/api/auth/session")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const exchange = await exchangeTokenForSession(request);
        if (!exchange.ok) {
          return Response.json({ error: "Invalid or expired credentials." }, { status: 401 });
        }
        return new Response(JSON.stringify({ ok: true, email: exchange.email }), {
          status: 200,
          headers: { "content-type": "application/json", "set-cookie": exchange.cookie },
        });
      },
      DELETE: async ({ request }) => {
        await destroySession(request);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json", "set-cookie": clearSessionCookie() },
        });
      },
    },
  },
});
