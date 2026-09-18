/**
 * google returns the connected HR admin here after consent. Public by necessity
 * (the provider is the caller); the signed state proves which organisation and
 * user started the connect, so nothing from the query string is trusted.
 */
import { createFileRoute } from "@tanstack/react-router";

import { finishProviderConnect } from "@/lib/meetings-oauth.server";

export const Route = createFileRoute("/api/public/integrations/google/callback")({
  server: {
    handlers: {
      GET: async ({ request }) => finishProviderConnect(request, "google"),
    },
  },
});
