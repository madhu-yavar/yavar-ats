/**
 * Server-only LinkedIn plumbing: the company-wide one-time-connect OAuth
 * lifecycle (state rows, token exchange/refresh) and member-post publishing.
 *
 * The LinkedIn app itself belongs to the platform: LINKEDIN_CLIENT_ID and
 * LINKEDIN_CLIENT_SECRET live in server env, never in the database, and HR
 * users only ever see LinkedIn's own sign-in screen.
 *
 * Recruiter-facing server functions live in linkedin.functions.ts.
 */
import { clearSecrets, readSecrets, writeSecrets } from "./integrations.server";

const TOKEN_URL = "https://www.linkedin.com/oauth/v2/accessToken";
const USERINFO_URL = "https://api.linkedin.com/v2/userinfo";
const POSTS_URL = "https://api.linkedin.com/rest/posts";
/** Pinned REST API version; bump when LinkedIn deprecates it. */
const LINKEDIN_VERSION = "202405";
export const LINKEDIN_SCOPES = "openid profile email w_member_social";

/** Thrown when the connection is unusable and only a fresh sign-in fixes it. */
export class LinkedinAuthError extends Error {
  constructor() {
    super("The company's LinkedIn connection has expired — reconnect it on the Integrations page.");
  }
}

export function linkedinEnvConfigured(): boolean {
  return Boolean(process.env["LINKEDIN_CLIENT_ID"] && process.env["LINKEDIN_CLIENT_SECRET"]);
}

async function adminClient() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * The org's single LinkedIn integration row. Older orgs can predate a seed,
 * so create the row defensively (unique on org_id+provider).
 */
export async function getLinkedInIntegrationId(orgId: string): Promise<string> {
  const db = await adminClient();
  const { data: existing } = await db
    .from("source_integrations")
    .select("id")
    .eq("org_id", orgId)
    .eq("provider", "linkedin")
    .maybeSingle();
  if (existing) return existing.id;

  const { error } = await db
    .from("source_integrations")
    .upsert(
      { org_id: orgId, provider: "linkedin", label: "LinkedIn Talent Solutions" },
      { onConflict: "org_id,provider" },
    );
  if (error) throw new Error(error.message);
  const { data: created } = await db
    .from("source_integrations")
    .select("id")
    .eq("org_id", orgId)
    .eq("provider", "linkedin")
    .maybeSingle();
  if (!created) throw new Error("LinkedIn integration row could not be created.");
  return created.id;
}

/* ------------------------------------------------------------- oauth state */

export async function createOauthState(
  orgId: string,
  userId: string,
  redirectUri: string,
): Promise<string> {
  const db = await adminClient();
  // Opportunistic cleanup — states are single-use and expire in 10 minutes.
  await db
    .from("linkedin_oauth_states" as never)
    .delete()
    .lt("expires_at", new Date(Date.now() - 86_400_000).toISOString());

  const { data, error } = await db
    .from("linkedin_oauth_states" as never)
    .insert({ org_id: orgId, user_id: userId, redirect_uri: redirectUri } as never)
    .select("id")
    .maybeSingle();
  if (error || !data) throw new Error(error?.message ?? "Could not start the LinkedIn connection.");
  return (data as { id: string }).id;
}

/** Atomically mark the state consumed; null means missing, expired or replayed. */
export async function consumeOauthState(
  stateId: string,
): Promise<{ orgId: string; redirectUri: string } | null> {
  const db = await adminClient();
  const { data } = await db
    .from("linkedin_oauth_states" as never)
    .update({ consumed_at: new Date().toISOString() } as never)
    .eq("id", stateId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("org_id, redirect_uri")
    .maybeSingle();
  const row = data as { org_id: string; redirect_uri: string } | null;
  if (!row) return null;
  return { orgId: row.org_id, redirectUri: row.redirect_uri };
}

/** The stored redirect_uri for a live (unused, unexpired) state, if any. */
export async function peekOauthState(stateId: string): Promise<string | null> {
  const db = await adminClient();
  const { data } = await db
    .from("linkedin_oauth_states" as never)
    .select("redirect_uri")
    .eq("id", stateId)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  return (data as { redirect_uri: string } | null)?.redirect_uri ?? null;
}

export async function markConnected(integrationId: string, memberName: string) {
  const db = await adminClient();
  await db
    .from("source_integrations")
    .update({
      has_credentials: true,
      last_test_status: "ok",
      last_test_message: `Connected as ${memberName}.`,
      last_tested_at: new Date().toISOString(),
    })
    .eq("id", integrationId);
}

/* --------------------------------------------------- token exchange / refresh */

type LinkedinTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope?: string;
};

function clientCredentials() {
  return {
    client_id: process.env["LINKEDIN_CLIENT_ID"] ?? "",
    client_secret: process.env["LINKEDIN_CLIENT_SECRET"] ?? "",
  };
}

/** Exchange an authorization code for the company account's tokens. */
export async function exchangeLinkedinCode(
  code: string,
  redirectUri: string,
): Promise<LinkedinTokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      ...clientCredentials(),
    }),
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`LinkedIn token exchange failed [${res.status}]: ${text.slice(0, 300)}`);
  return JSON.parse(text) as LinkedinTokenResponse;
}

export async function fetchLinkedinMember(
  accessToken: string,
): Promise<{ sub: string; name: string | null; email: string | null }> {
  const res = await fetch(USERINFO_URL, { headers: { Authorization: `Bearer ${accessToken}` } });
  const text = await res.text();
  if (!res.ok) throw new Error(`LinkedIn userinfo failed [${res.status}]: ${text.slice(0, 300)}`);
  const body = JSON.parse(text) as { sub?: string; name?: string; email?: string };
  if (!body.sub) throw new Error("LinkedIn did not return a member id.");
  return { sub: body.sub, name: body.name ?? null, email: body.email ?? null };
}

export async function markDisconnected(integrationId: string, message?: string) {
  await clearSecrets(integrationId);
  const db = await adminClient();
  await db
    .from("source_integrations")
    .update({
      has_credentials: false,
      last_test_status: "pending",
      last_test_message: message ?? "LinkedIn sign-in expired. Please connect again.",
    })
    .eq("id", integrationId);
}

/**
 * A usable access token for the company account, refreshing a lapsed one
 * (access tokens last ~60 days, refresh tokens ~1 year). forceRefresh is for
 * the one-retry-after-401 path.
 */
export async function getValidAccessToken(
  integrationId: string,
  forceRefresh = false,
): Promise<{ accessToken: string; memberSub: string }> {
  const secrets = await readSecrets(integrationId);
  const refreshToken = secrets["refresh_token"] ?? "";
  const memberSub = secrets["member_sub"] ?? "";
  if (!refreshToken || !memberSub) throw new LinkedinAuthError();

  if (!forceRefresh) {
    const accessToken = secrets["access_token"] ?? "";
    const expiresAt = Date.parse(secrets["expires_at"] ?? "");
    if (accessToken && Number.isFinite(expiresAt) && expiresAt - 60_000 > Date.now()) {
      return { accessToken, memberSub };
    }
  }

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      ...clientCredentials(),
    }),
  });
  if (!res.ok) {
    await markDisconnected(integrationId);
    throw new LinkedinAuthError();
  }
  const body = (await res.json()) as LinkedinTokenResponse;
  const patch: Record<string, string> = {
    access_token: body.access_token,
    expires_at: new Date(Date.now() + body.expires_in * 1000).toISOString(),
  };
  // LinkedIn rotates the refresh token only sometimes; keep the old one otherwise.
  if (body.refresh_token) {
    patch["refresh_token"] = body.refresh_token;
    if (body.refresh_token_expires_in) {
      patch["refresh_expires_at"] = new Date(
        Date.now() + body.refresh_token_expires_in * 1000,
      ).toISOString();
    }
  }
  await writeSecrets(integrationId, patch);
  return { accessToken: body.access_token, memberSub };
}

/* ---------------------------------------------------------------- publishing */

/**
 * Share a post as the connected member (w_member_social — self-serve scope).
 * Returns the post URN when LinkedIn reports it.
 */
export async function postToLinkedIn(
  accessToken: string,
  memberSub: string,
  text: string,
): Promise<string | null> {
  const res = await fetch(POSTS_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "LinkedIn-Version": LINKEDIN_VERSION,
      "X-Restli-Protocol-Version": "2.0.0",
    },
    body: JSON.stringify({
      author: `urn:li:person:${memberSub}`,
      commentary: text,
      visibility: "PUBLIC",
      distribution: {
        feedDistribution: "MAIN_FEED",
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: "PUBLISHED",
    }),
  });
  if (res.status === 201) return res.headers.get("x-restli-id") ?? res.headers.get("x-linkedin-id");
  const bodyText = await res.text();
  if (res.status === 401) throw new LinkedinAuthError();
  if (res.status === 403)
    throw new Error(
      "LinkedIn declined publishing — the connected account may not be allowed to post (check the app's w_member_social access).",
    );
  if (res.status === 429)
    throw new Error("LinkedIn rate limit reached — try again in a little while.");
  throw new Error(`LinkedIn post failed [${res.status}]: ${bodyText.slice(0, 300)}`);
}
