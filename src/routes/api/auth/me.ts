/**
 * GET /api/auth/me — returns the signed-in identity from the atsiq_session
 * cookie, or 401. The client uses this instead of supabase-js getSession().
 */
import { createFileRoute } from "@tanstack/react-router";

import { resolveSession } from "../../../server/identity";

export const Route = createFileRoute("/api/auth/me")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const session = await resolveSession(request);
          if (!session) {
            return Response.json({ error: "Not signed in." }, { status: 401 });
          }
          return Response.json({ ok: true, email: session.email, userId: session.userId });
        } catch (err) {
          console.error("Session lookup failed", err);
          return Response.json(
            { error: "Session service is temporarily unavailable." },
            { status: 503 },
          );
        }
      },
    },
  },
});
