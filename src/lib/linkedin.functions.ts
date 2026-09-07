import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  LinkedinAuthError,
  authorizeUrl,
  fetchMember,
  linkedinEnvConfigured,
  postAsMember,
  refreshAccessToken,
  signState,
} from "./linkedin.server";

export type LinkedinStatus = {
  /** True when the ATSIQ LinkedIn app itself is set up (platform-side). */
  configured: boolean;
  /** True when this organisation has authorised its own LinkedIn account. */
  connected: boolean;
  member: string | null;
  memberEmail: string | null;
  connectedAt: string | null;
  expiresSoon: boolean;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function myOrgId(userId: string): Promise<string | null> {
  const db = await admin();
  const { data } = await db
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}

/** Per-organisation LinkedIn connection status. */
export const linkedinStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LinkedinStatus> => {
    const base: LinkedinStatus = {
      configured: linkedinEnvConfigured(),
      connected: false,
      member: null,
      memberEmail: null,
      connectedAt: null,
      expiresSoon: false,
    };
    const orgId = await myOrgId(context.userId);
    if (!orgId || !base.configured) return base;

    const db = await admin();
    const { data } = await db
      .from("org_linkedin_connections")
      .select("member_name, member_email, connected_at, expires_at")
      .eq("org_id", orgId)
      .maybeSingle();
    if (!data) return base;

    const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : null;
    return {
      ...base,
      connected: true,
      member: data.member_name ?? null,
      memberEmail: data.member_email ?? null,
      connectedAt: data.connected_at ?? null,
      expiresSoon: expiresAt !== null && expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000,
    };
  });

/** Start the one-time sign-in: returns the LinkedIn URL to open. */
export const startLinkedInConnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ origin: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    if (!linkedinEnvConfigured())
      throw new Error("LinkedIn is not set up on this platform yet — ask your ATSIQ administrator.");
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation yet.");
    const state = signState({
      orgId,
      userId: context.userId,
      origin: data.origin,
      ts: Date.now(),
    });
    return { url: authorizeUrl(state) };
  });

/** Forget this organisation's LinkedIn account. */
export const disconnectLinkedIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation yet.");
    const db = await admin();
    await db.from("org_linkedin_connections").delete().eq("org_id", orgId);
    return { ok: true as const };
  });

/**
 * Read the organisation's stored token, refreshing it when LinkedIn issued a
 * refresh token and the access token is close to expiry.
 */
async function orgToken(orgId: string): Promise<{ accessToken: string; memberSub: string }> {
  const db = await admin();
  const { data } = await db
    .from("org_linkedin_connections")
    .select("member_sub, access_token, refresh_token, expires_at")
    .eq("org_id", orgId)
    .maybeSingle();
  if (!data) throw new Error("This organisation has not connected LinkedIn yet.");

  const expiresAt = data.expires_at ? new Date(data.expires_at).getTime() : 0;
  if (expiresAt && expiresAt - Date.now() < 5 * 60 * 1000) {
    if (!data.refresh_token) throw new LinkedinAuthError();
    const next = await refreshAccessToken(data.refresh_token);
    await db
      .from("org_linkedin_connections")
      .update({
        access_token: next.access_token,
        refresh_token: next.refresh_token ?? data.refresh_token,
        expires_at: new Date(Date.now() + next.expires_in * 1000).toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("org_id", orgId);
    return { accessToken: next.access_token, memberSub: data.member_sub };
  }
  return { accessToken: data.access_token, memberSub: data.member_sub };
}

const PublishInput = z.object({
  requisitionId: z.string().uuid(),
  text: z.string().min(1).max(3000),
});

/** Publish the designed post text to the organisation's own LinkedIn account. */
export const publishToLinkedIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PublishInput.parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation yet.");

    const { data: requisition } = await context.supabase
      .from("requisitions")
      .select("id")
      .eq("id", data.requisitionId)
      .maybeSingle();
    if (!requisition) throw new Error("Requisition not found.");

    const { accessToken, memberSub } = await orgToken(orgId);
    // Confirms the token still works and keeps the stored identity honest.
    await fetchMember(accessToken);
    const postUrn = await postAsMember(accessToken, memberSub, data.text.trim());
    return { ok: true as const, postUrn };
  });
