/**
 * Second hop of the one-time LinkedIn connect: LinkedIn sends the member back
 * here with an authorization code. Consumes the state atomically (single-use),
 * exchanges the code for tokens, stores them server-side against the org's
 * LinkedIn integration, and lands the recruiter back on /integrations.
 */
import { createFileRoute } from "@tanstack/react-router";

import {
  consumeOauthState,
  exchangeLinkedinCode,
  fetchLinkedinMember,
  getLinkedInIntegrationId,
  markConnected,
} from "@/lib/linkedin.server";
import { writeSecrets } from "@/lib/integrations.server";

async function run(request: Request) {
  const url = new URL(request.url);
  const back = (flag: string) =>
    Response.redirect(new URL(`/integrations?linkedin=${flag}`, url.origin), 302);

  const error = url.searchParams.get("error");
  if (error)
    return back(error === "user_cancelled_login" || error === "access_denied" ? "denied" : "error");

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) return back("expired");

  const consumed = await consumeOauthState(state);
  if (!consumed) return back("expired");

  try {
    const tokens = await exchangeLinkedinCode(code, consumed.redirectUri);
    const member = await fetchLinkedinMember(tokens.access_token);
    const integrationId = await getLinkedInIntegrationId(consumed.orgId);

    const memberName = member.name ?? member.email ?? "";
    const patch: Record<string, string> = {
      access_token: tokens.access_token,
      expires_at: new Date(Date.now() + tokens.expires_in * 1000).toISOString(),
      member_sub: member.sub,
      member_name: memberName,
    };
    if (tokens.refresh_token) patch["refresh_token"] = tokens.refresh_token;
    if (tokens.refresh_token_expires_in) {
      patch["refresh_expires_at"] = new Date(
        Date.now() + tokens.refresh_token_expires_in * 1000,
      ).toISOString();
    }
    await writeSecrets(integrationId, patch);
    await markConnected(integrationId, memberName);
    return back("ok");
  } catch (e) {
    console.error("LinkedIn connect failed:", e);
    return back("error");
  }
}

export const Route = createFileRoute("/api/auth/linkedin/callback")({
  server: { handlers: { GET: ({ request }) => run(request) } },
});
