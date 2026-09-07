/**
 * Server-only LinkedIn plumbing via the Lovable connector gateway.
 *
 * The company LinkedIn account is connected once through Lovable's
 * connector settings (LinkedIn connector, OAuth2). The gateway injects
 * the member OAuth access token automatically — no client ID/secret in
 * server env, no token refresh logic, no per-recruiter sign-in. HR users
 * only ever see "connected" and publish job posts through that one account.
 *
 * Recruiter-facing server functions live in linkedin.functions.ts.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/linkedin";
/** Pinned REST API version; bump when LinkedIn deprecates it. */
const LINKEDIN_VERSION = "202405";
export const LINKEDIN_SCOPES = "openid profile email w_member_social";

/** Thrown when the connection is unusable and only a reconnect fixes it. */
export class LinkedinAuthError extends Error {
  constructor() {
    super(
      "The company's LinkedIn connection has expired — reconnect it in Lovable → Settings → Connectors.",
    );
  }
}

/** True when the LinkedIn connector is linked to this project. */
export function linkedinEnvConfigured(): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"] && process.env["LINKEDIN_API_KEY"]);
}

function gatewayHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env["LOVABLE_API_KEY"] ?? ""}`,
    "X-Connection-Api-Key": process.env["LINKEDIN_API_KEY"] ?? "",
    ...extra,
  };
}

/* ------------------------------------------------------------- member identity */

/**
 * Read the connected member's identity through the gateway.
 * The gateway injects the OAuth bearer token; we just pass the Lovable
 * API key + connector key for authentication.
 */
export async function fetchLinkedInMember(): Promise<{
  sub: string;
  name: string | null;
  email: string | null;
}> {
  const res = await fetch(`${GATEWAY_URL}/v2/userinfo`, { headers: gatewayHeaders() });
  const text = await res.text();
  if (!res.ok) throw new Error(`LinkedIn userinfo failed [${res.status}]: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { sub?: string; name?: string; email?: string };
  if (!body.sub) throw new Error("LinkedIn did not return a member id.");
  return { sub: body.sub, name: body.name ?? null, email: body.email ?? null };
}

/* ---------------------------------------------------------------- publishing */

/**
 * Share a text post as the connected member (w_member_social scope) through
 * the gateway. Returns the post URN when LinkedIn reports it.
 *
 * Uses the ugcPosts API (the endpoint the connector gateway documents for
 * member publishing).
 */
export async function postToLinkedIn(memberSub: string, text: string): Promise<string | null> {
  const res = await fetch(`${GATEWAY_URL}/v2/ugcPosts`, {
    method: "POST",
    headers: gatewayHeaders({
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    }),
    body: JSON.stringify({
      author: `urn:li:person:${memberSub}`,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.PostContent": {
          shareCommentary: { text },
          shareMediaCategory: "NONE",
        },
      },
      visibility: { "com.linkedin.ugc.MemberShareVisibility": "PUBLIC" },
    }),
  });
  if (res.status === 201) return res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
  const bodyText = await res.text();
  if (res.status === 401) throw new LinkedinAuthError();
  if (res.status === 403)
    throw new Error(
      "LinkedIn declined publishing — the connected account may not be allowed to post (check the connector's w_member_social scope).",
    );
  if (res.status === 429)
    throw new Error("LinkedIn rate limit reached — try again in a little while.");
  throw new Error(`LinkedIn post failed [${res.status}]: ${bodyText.slice(0, 300)}`);
}
