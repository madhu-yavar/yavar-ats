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
        const session = await resolveSession(request);
        if (!session) {
          return Response.json({ error: "Not signed in." }, { status: 401 });
        }
        return Response.json({ ok: true, email: session.email });
      },
    },
  },
});
