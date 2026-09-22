import { createFileRoute } from "@tanstack/react-router";

import { clearSessionCookie, destroySession } from "@/server/identity";
import { jsonOk } from "@/server/http";

export const Route = createFileRoute("/api/auth/signout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        await destroySession(request);
        return jsonOk({}, { "set-cookie": clearSessionCookie() });
      },
    },
  },
});
