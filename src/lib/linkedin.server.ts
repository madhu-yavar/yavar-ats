/**
 * Server-only LinkedIn plumbing — one connection per organisation.
 *
 * Each tenant authorises its own LinkedIn account: an HR admin presses
 * "Connect LinkedIn", signs in on LinkedIn's own screen, and the resulting
 * token is stored against that organisation only. Job posts then go out from
 * that company's account — never from another tenant's, and never from the
 * platform builder's account.
 *
 * ATSIQ registers a single LinkedIn developer app (client id + secret in the
 * server environment); tenants never see or paste anything.
 */
import { createHmac, timingSafeEqual } from "crypto";

const AUTH_URL = "https://www.linkedin.com/oauth/v2/authorization";
const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const API_URL = "https://api.linkedin.com";

/** Overridable so a tenant's LinkedIn app can ask for only the products it has. */
export const LINKEDIN_SCOPES =
  process.env["LINKEDIN_SCOPES"] ?? "openid profile email w_member_social";

/** Thrown when the organisation's connection is unusable and only a re-connect fixes it. */
export class LinkedinAuthError extends Error {
  constructor() {
    super("This organisation's LinkedIn connection has expired — press Connect LinkedIn again.");
  }
}

/* -------------------------------------------------------------------- config */

export function linkedinEnvConfigured(): boolean {
  return Boolean(process.env["LINKEDIN_CLIENT_ID"] && process.env["LINKEDIN_CLIENT_SECRET"]);
}

/** The single redirect URI registered in the ATSIQ LinkedIn app. */
export function redirectUri(): string {
  return (
    process.env["LINKEDIN_REDIRECT_URI"] ?? "https://atsiq.yavar.ai/api/public/linkedin/callback"
  );
}

/* --------------------------------------------------------------------- state */

type StatePayload = { orgId: string; userId: string; origin: string; ts: number };

function stateKey(): string {
  return process.env["LINKEDIN_STATE_SECRET"] ?? "";
}

function b64url(input: string): string {
  return Buffer.from(input, "utf8").toString("base64url");
}

export function signState(payload: StatePayload): string {
  const body = b64url(JSON.stringify(payload));
  const mac = createHmac("sha256", stateKey()).update(body).digest("hex");
  return `${body}.${mac}`;
}

export function verifyState(state: string | null): StatePayload | null {
  if (!state || !state.includes(".")) return null;
  const [body, mac] = state.split(".") as [string, string];
  const expected = createHmac("sha256", stateKey()).update(body).digest("hex");
  if (mac.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as StatePayload;
    // 30-minute window: long enough for a slow sign-in, short enough to be safe.
    if (!parsed.orgId || Date.now() - parsed.ts > 30 * 60 * 1000) return null;
    return parsed;
  } catch {
    return null;
  }
}

/* ---------------------------------------------------------------------- OAuth */

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: process.env["LINKEDIN_CLIENT_ID"] ?? "",
    redirect_uri: redirectUri(),
    state,
    scope: LINKEDIN_SCOPES,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

export type TokenSet = {
  access_token: string;
  refresh_token: string | null;
  expires_in: number;
  scope: string | null;
};

async function tokenRequest(body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env["LINKEDIN_CLIENT_ID"] ?? "",
      client_secret: process.env["LINKEDIN_CLIENT_SECRET"] ?? "",
      ...body,
    }).toString(),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`LinkedIn sign-in failed [${res.status}]: ${text.slice(0, 300)}`);
  const parsed = JSON.parse(text) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
  };
  if (!parsed.access_token) throw new Error("LinkedIn did not return an access token.");
  return {
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token ?? null,
    expires_in: parsed.expires_in ?? 60 * 60 * 24 * 60,
    scope: parsed.scope ?? null,
  };
}

export function exchangeCode(code: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "authorization_code", code, redirect_uri: redirectUri() });
}

export function refreshAccessToken(refreshToken: string): Promise<TokenSet> {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: refreshToken });
}

/* ------------------------------------------------------------ member identity */

export async function fetchMember(accessToken: string): Promise<{
  sub: string;
  name: string | null;
  email: string | null;
}> {
  const res = await fetch(`${API_URL}/v2/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (res.status === 401) throw new LinkedinAuthError();
  if (!res.ok) throw new Error(`LinkedIn profile read failed [${res.status}]: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { sub?: string; name?: string; email?: string };
  if (!body.sub) throw new Error("LinkedIn did not return a member id.");
  return { sub: body.sub, name: body.name ?? null, email: body.email ?? null };
}

/* ------------------------------------------------------------------ publishing */

/** Share a text post as the organisation's connected member. */
export async function postAsMember(
  accessToken: string,
  memberSub: string,
  text: string,
): Promise<string | null> {
  const res = await fetch(`${API_URL}/v2/ugcPosts`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "X-Restli-Protocol-Version": "2.0.0",
    },
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
      "LinkedIn declined publishing — the connected account may not be allowed to post from this app.",
    );
  if (res.status === 429)
    throw new Error("LinkedIn rate limit reached — try again in a little while.");
  throw new Error(`LinkedIn post failed [${res.status}]: ${bodyText.slice(0, 300)}`);
}
