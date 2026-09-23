/**
 * DELETE /api/auth/session — destroys the session row and clears the cookie.
 * (The legacy bearer→cookie exchange that used to live at POST was removed
 * with the Supabase era; sign-in is POST /api/auth/login.)
 */
import { createFileRoute } from "@tanstack/react-router";

import { clearSessionCookie, destroySession } from "../../../server/identity";

export const Route = createFileRoute("/api/auth/session")({
  server: {
    handlers: {
      DELETE: async ({ request }) => {
        await destroySession(request);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": clearSessionCookie(request),
          },
        });
      },
    },
  },
});
