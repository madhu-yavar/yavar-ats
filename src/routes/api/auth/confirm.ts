import { createFileRoute } from "@tanstack/react-router";

import { confirmEmail } from "@/server/auth.server";

/** Email confirmation link target: confirms, then lands the person on sign-in. */
export const Route = createFileRoute("/api/auth/confirm")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const token = new URL(request.url).searchParams.get("token") ?? "";
        const result = await confirmEmail(token);
        const to = result.ok ? "/?confirmed=1" : "/?confirm_error=1";
        return new Response(null, {
          status: 303,
          headers: { location: to, "cache-control": "no-store" },
        });
      },
    },
  },
});
