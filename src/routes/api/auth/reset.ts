import { createFileRoute } from "@tanstack/react-router";

import { applyReset } from "@/server/auth.server";
import { jsonError, jsonOk, readJson } from "@/server/http";

export const Route = createFileRoute("/api/auth/reset")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request);
        if (!body) return jsonError("Send the reset token and a new password.", 400);
        const result = await applyReset({ token: body["token"], password: body["password"] });
        if (!result.ok) return jsonError(result.error, result.status);
        return jsonOk({ message: result.message });
      },
    },
  },
});
