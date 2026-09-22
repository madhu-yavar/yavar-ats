import { createFileRoute } from "@tanstack/react-router";

import { signIn } from "@/server/auth.server";
import { clientIpOf, jsonError, readJson } from "@/server/http";

export const Route = createFileRoute("/api/auth/signin")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const body = await readJson(request);
        if (!body) return jsonError("Send an email and password.", 400);
        const result = await signIn({
          email: body["email"],
          password: body["password"],
          ip: clientIpOf(request),
          userAgent: request.headers.get("user-agent"),
        });
        if (!result.ok) return jsonError(result.error, result.status);
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "cache-control": "no-store",
            ...(result.cookie ? { "set-cookie": result.cookie } : {}),
          },
        });
      },
    },
  },
});
