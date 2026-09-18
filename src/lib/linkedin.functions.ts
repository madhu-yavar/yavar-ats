import { createServerFn } from "@tanstack/react-start";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "../server/db";
import { orgLinkedinConnections, requisitions } from "@db/schema";
import { requireOrg, requireRole } from "./auth.middleware";
import type { LinkedinCapability } from "./linkedin.server";
import {
  LinkedinAuthError,
  authorizeUrl,
  fetchMember,
  linkedinEnvConfigured,
  postAsMember,
  probeCapabilities,
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

/** Per-organisation LinkedIn connection status. */
export const linkedinStatus = createServerFn({ method: "GET" })
  .middleware([requireOrg])
  .handler(async ({ context }): Promise<LinkedinStatus> => {
    const base: LinkedinStatus = {
      configured: linkedinEnvConfigured(),
      connected: false,
      member: null,
      memberEmail: null,
      connectedAt: null,
      expiresSoon: false,
    };
    if (!base.configured) return base;

    const [row] = await db
      .select({
        memberName: orgLinkedinConnections.memberName,
        memberEmail: orgLinkedinConnections.memberEmail,
        connectedAt: orgLinkedinConnections.connectedAt,
        expiresAt: orgLinkedinConnections.expiresAt,
      })
      .from(orgLinkedinConnections)
      .where(eq(orgLinkedinConnections.orgId, context.orgId))
      .limit(1);
    if (!row) return base;

    const expiresAt = row.expiresAt ? row.expiresAt.getTime() : null;
    return {
      ...base,
      connected: true,
      member: row.memberName ?? null,
      memberEmail: row.memberEmail ?? null,
      connectedAt: row.connectedAt ? row.connectedAt.toISOString() : null,
      expiresSoon: expiresAt !== null && expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000,
    };
  });

/** Start the one-time sign-in: returns the LinkedIn URL to open. */
export const startLinkedInConnect = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ origin: z.string().url() }).parse(data))
  .handler(async ({ data, context }) => {
    if (!linkedinEnvConfigured())
      throw new Error(
        "LinkedIn is not set up on this platform yet — ask your ATSIQ administrator.",
      );
    const state = signState({
      orgId: context.orgId,
      userId: context.userId,
      origin: data.origin,
      ts: Date.now(),
    });
    return { url: authorizeUrl(state) };
  });

/** Forget this organisation's LinkedIn account. */
export const disconnectLinkedIn = createServerFn({ method: "POST" })
  .middleware([requireRole("hr_head")])
  .handler(async ({ context }) => {
    await db.delete(orgLinkedinConnections).where(eq(orgLinkedinConnections.orgId, context.orgId));
    return { ok: true as const };
  });

/**
 * Read the organisation's stored token, refreshing it when LinkedIn issued a
 * refresh token and the access token is close to expiry.
 */
async function orgToken(orgId: string): Promise<{ accessToken: string; memberSub: string }> {
  const { decryptSecret, encryptSecret } = await import("../server/crypto");
  const [row] = await db
    .select({
      memberSub: orgLinkedinConnections.memberSub,
      accessToken: orgLinkedinConnections.accessToken,
      refreshToken: orgLinkedinConnections.refreshToken,
      expiresAt: orgLinkedinConnections.expiresAt,
    })
    .from(orgLinkedinConnections)
    .where(eq(orgLinkedinConnections.orgId, orgId))
    .limit(1);
  if (!row) throw new Error("This organisation has not connected LinkedIn yet.");

  const expiresAt = row.expiresAt ? row.expiresAt.getTime() : 0;
  if (expiresAt && expiresAt - Date.now() < 5 * 60 * 1000) {
    if (!row.refreshToken) throw new LinkedinAuthError();
    const next = await refreshAccessToken(decryptSecret(row.refreshToken));
    await db
      .update(orgLinkedinConnections)
      .set({
        accessToken: encryptSecret(next.access_token),
        refreshToken: next.refresh_token ? encryptSecret(next.refresh_token) : row.refreshToken,
        expiresAt: new Date(Date.now() + next.expires_in * 1000),
        updatedAt: new Date(),
      })
      .where(eq(orgLinkedinConnections.orgId, orgId));
    return { accessToken: next.access_token, memberSub: row.memberSub };
  }
  return { accessToken: decryptSecret(row.accessToken), memberSub: row.memberSub };
}

const PublishInput = z.object({
  requisitionId: z.string().uuid(),
  text: z.string().min(1).max(3000),
});

/** Publish the designed post text to the organisation's own LinkedIn account. */
export const publishToLinkedIn = createServerFn({ method: "POST" })
  .middleware([requireRole("hr_head")])
  .inputValidator((data: unknown) => PublishInput.parse(data))
  .handler(async ({ data, context }) => {
    const [requisition] = await db
      .select({ id: requisitions.id })
      .from(requisitions)
      .where(and(eq(requisitions.id, data.requisitionId), eq(requisitions.orgId, context.orgId)))
      .limit(1);
    if (!requisition) throw new Error("Requisition not found.");

    const { accessToken, memberSub } = await orgToken(context.orgId);
    // Confirms the token still works and keeps the stored identity honest.
    await fetchMember(accessToken);
    const postUrn = await postAsMember(accessToken, memberSub, data.text.trim());
    return { ok: true as const, postUrn };
  });

/** Ask LinkedIn what this organisation's connection is actually allowed to do. */
export const linkedinCapabilities = createServerFn({ method: "GET" })
  .middleware([requireOrg])
  .handler(async ({ context }): Promise<LinkedinCapability[]> => {
    const [row] = await db
      .select({ scope: orgLinkedinConnections.scope })
      .from(orgLinkedinConnections)
      .where(eq(orgLinkedinConnections.orgId, context.orgId))
      .limit(1);
    if (!row) return [];
    const { accessToken } = await orgToken(context.orgId);
    return probeCapabilities(accessToken, row.scope ?? null);
  });
