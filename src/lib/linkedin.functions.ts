import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { orgOf } from "./org.functions";
import { readSecrets } from "./integrations.server";
import {
  LinkedinAuthError,
  createOauthState,
  getLinkedInIntegrationId,
  getValidAccessToken,
  linkedinEnvConfigured,
  markDisconnected,
  postToLinkedIn,
} from "./linkedin.server";

export type LinkedinStatus = {
  /** True when the platform's LinkedIn app is wired up (env credentials exist). */
  configured: boolean;
  connected: boolean;
  member: string | null;
  /** The annual LinkedIn refresh window is closing — prompt a reconnect. */
  expiresSoon: boolean;
};

/**
 * Company-wide LinkedIn connection status. One account is authorised once via
 * LinkedIn's own sign-in screen; tokens live server-side and are refreshed
 * automatically until the annual refresh window lapses.
 */
export const linkedinStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<LinkedinStatus> => {
    if (!linkedinEnvConfigured()) {
      return { configured: false, connected: false, member: null, expiresSoon: false };
    }
    const orgId = await orgOf(context.userId);
    const integrationId = await getLinkedInIntegrationId(orgId);
    const secrets = await readSecrets(integrationId);
    const connected = Boolean(
      secrets["access_token"] && secrets["refresh_token"] && secrets["member_sub"],
    );
    const refreshExpiresAt = Date.parse(secrets["refresh_expires_at"] ?? "");
    const refreshLapsed = Number.isFinite(refreshExpiresAt) && refreshExpiresAt < Date.now();
    return {
      configured: true,
      connected: connected && !refreshLapsed,
      member: secrets["member_name"] ?? null,
      expiresSoon: connected && !refreshLapsed && refreshExpiresAt - 14 * 86_400_000 < Date.now(),
    };
  });

/**
 * Begin the one-time connect: creates a single-use state row and returns the
 * app URL the browser should be sent to. The heavy lifting happens in
 * /api/auth/linkedin/start and /callback.
 */
export const linkedinConnectStart = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const request = getRequest();
    const origin =
      process.env["LINKEDIN_REDIRECT_ORIGIN"] ?? (request ? new URL(request.url).origin : "");
    if (!origin)
      throw new Error("Could not determine this app's address for the LinkedIn redirect.");
    const orgId = await orgOf(context.userId);
    const stateId = await createOauthState(
      orgId,
      context.userId,
      `${origin}/api/auth/linkedin/callback`,
    );
    return `/api/auth/linkedin/start?state=${stateId}`;
  });

export const linkedinDisconnect = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await orgOf(context.userId);
    const integrationId = await getLinkedInIntegrationId(orgId);
    await markDisconnected(
      integrationId,
      "Signed out of LinkedIn. Connect again to publish job posts.",
    );
    return { ok: true };
  });

const PublishInput = z.object({
  requisitionId: z.string().uuid(),
  text: z.string().min(1).max(3000),
});

/** Publish the designed post text to LinkedIn via the company account. */
export const publishToLinkedIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PublishInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: requisition } = await context.supabase
      .from("requisitions")
      .select("id")
      .eq("id", data.requisitionId)
      .maybeSingle();
    if (!requisition) throw new Error("Requisition not found.");

    const orgId = await orgOf(context.userId);
    const integrationId = await getLinkedInIntegrationId(orgId);
    const text = data.text.trim();

    let session = await getValidAccessToken(integrationId);
    try {
      const postUrn = await postToLinkedIn(session.accessToken, session.memberSub, text);
      return { ok: true as const, postUrn };
    } catch (e) {
      if (!(e instanceof LinkedinAuthError)) throw e;
      // One refresh-and-retry before surfacing the reconnect message.
      session = await getValidAccessToken(integrationId, true);
      const postUrn = await postToLinkedIn(session.accessToken, session.memberSub, text);
      return { ok: true as const, postUrn };
    }
  });
