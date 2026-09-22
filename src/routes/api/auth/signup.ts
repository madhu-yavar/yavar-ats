import { createFileRoute } from "@tanstack/react-router";

import { signUp } from "@/server/auth.server";
import { clientIpOf, jsonError, jsonOk, originOf, readJson } from "@/server/http";

export const Route = createFileRoute("/api/auth/signup")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request);
        if (!body) return jsonError("Send an email and password.", 400);
        const result = await signUp({
          email: body["email"],
          password: body["password"],
          fullName: body["fullName"],
          origin: originOf(request),
          ip: clientIpOf(request),
        });
        if (!result.ok) return jsonError(result.error, result.status);
        return jsonOk({ message: result.message });
      },
    },
  },
});
