/**
 * First hop of the one-time LinkedIn connect: validates the state created by
 * the linkedinConnectStart server function and sends the browser to LinkedIn's
 * own sign-in/consent screen. Public by design — the state row is the trust
 * anchor, created only by an authenticated server function.
 */
import { createFileRoute } from "@tanstack/react-router";

import { LINKEDIN_SCOPES, linkedinEnvConfigured, peekOauthState } from "@/lib/linkedin.server";

async function run(request: Request) {
  const url = new URL(request.url);
  const back = (flag: string) =>
    Response.redirect(new URL(`/integrations?linkedin=${flag}`, url.origin), 302);

  if (!linkedinEnvConfigured()) return back("setup_pending");

  const state = url.searchParams.get("state") ?? "";
  const redirectUri = state ? await peekOauthState(state) : null;
  if (!state || !redirectUri) return back("expired");

  const authorize = new URL("https://www.linkedin.com/oauth/v2/authorization");
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", process.env["LINKEDIN_CLIENT_ID"] ?? "");
  authorize.searchParams.set("redirect_uri", redirectUri);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("scope", LINKEDIN_SCOPES);
  return Response.redirect(authorize.toString(), 302);
}

export const Route = createFileRoute("/api/auth/linkedin/start")({
  server: { handlers: { GET: ({ request }) => run(request) } },
});
