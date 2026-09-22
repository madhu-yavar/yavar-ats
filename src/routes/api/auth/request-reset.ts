import { createFileRoute } from "@tanstack/react-router";

import { requestReset } from "@/server/auth.server";
import { jsonError, jsonOk, originOf, readJson } from "@/server/http";

export const Route = createFileRoute("/api/auth/request-reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request);
        if (!body) return jsonError("Send the email address to reset.", 400);
        const result = await requestReset({
          email: body["email"],
          origin: originOf(request),
        });
        return jsonOk({ message: result.message });
      },
    },
  },
});
