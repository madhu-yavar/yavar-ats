/**
 * Board adapter registry + connection loading.
 *
 * A BoardConnection bundles the integration row (config), the decrypted
 * credentials and — for LinkedIn — the org's live OAuth token. Nothing here is
 * client-reachable directly: server functions in boards.functions.ts and the
 * public webhook/cron routes are the only callers.
 */
import { and, eq } from "drizzle-orm";

import { db } from "../db";
import { orgLinkedinConnections, organizations, sourceIntegrations } from "@db/schema";
import { readSecrets, type IntegrationConfig } from "../../lib/integrations.server";
import { linkedinOrgToken, linkedinEnvConfigured } from "../../lib/linkedin.server";
import { indeedAdapter } from "./indeed";
import { linkedinAdapter } from "./linkedin";
import { naukriAdapter } from "./naukri";
import {
  BOARD_PROVIDERS,
  type BoardAdapter,
  type BoardConnection,
  type BoardProviderId,
} from "./types";

export function isBoardProvider(provider: string): provider is BoardProviderId {
  return (BOARD_PROVIDERS as string[]).includes(provider);
}

export function getBoardAdapter(provider: BoardProviderId): BoardAdapter {
  switch (provider) {
    case "linkedin":
      return linkedinAdapter;
    case "indeed":
      return indeedAdapter;
    case "naukri":
      return naukriAdapter;
  }
}

/** Resolve the org+integration behind a webhook delivery token. */
export async function integrationForWebhookToken(
  provider: string,
  token: string,
): Promise<{ orgId: string; integrationId: string } | null> {
  if (!token || token.length < 20) return null;
  const { createHash } = await import("node:crypto");
  const hash = createHash("sha256").update(token).digest("hex");
  const [row] = await db
    .select({
      orgId: sourceIntegrations.orgId,
      integrationId: sourceIntegrations.id,
      enabled: sourceIntegrations.enabled,
    })
    .from(sourceIntegrations)
    .where(
      and(eq(sourceIntegrations.webhookTokenHash, hash), eq(sourceIntegrations.provider, provider)),
    )
    .limit(1);
  // Org status is checked here so a paused org stops accepting deliveries;
  // ON DELETE SET NULL keeps the event rows resolvable for forensics anyway.
  if (!row || !row.orgId || !row.enabled) return null;
  const [org] = await db
    .select({ status: organizations.status })
    .from(organizations)
    .where(eq(organizations.id, row.orgId))
    .limit(1);
  if (!org || org.status !== "active") return null;
  return { orgId: row.orgId, integrationId: row.integrationId };
}

/** Load the decrypted connection for one org + board. Throws when unusable. */
export async function loadBoardConnection(
  orgId: string,
  provider: BoardProviderId,
): Promise<BoardConnection> {
  const [row] = await db
    .select({
      id: sourceIntegrations.id,
      config: sourceIntegrations.config,
      enabled: sourceIntegrations.enabled,
    })
    .from(sourceIntegrations)
    .where(and(eq(sourceIntegrations.orgId, orgId), eq(sourceIntegrations.provider, provider)))
    .limit(1);

  const secrets = row ? await readSecrets(row.id) : {};
  const conn: BoardConnection = {
    orgId,
    provider,
    integrationId: row?.id ?? "",
    enabled: row?.enabled ?? false,
    config: ((row?.config as IntegrationConfig) ?? {}) as BoardConnection["config"],
    secrets,
  };

  if (provider === "linkedin" && linkedinEnvConfigured()) {
    try {
      const { accessToken, memberSub } = await linkedinOrgToken(orgId);
      conn.accessToken = accessToken;
      conn.memberSub = memberSub;
    } catch {
      // Not connected / refresh failed — capabilities() reports it honestly.
    }
  }
  return conn;
}

/** Whether the org has a LinkedIn account connection at all. */
export async function hasLinkedInConnection(orgId: string): Promise<boolean> {
  const [row] = await db
    .select({ orgId: orgLinkedinConnections.orgId })
    .from(orgLinkedinConnections)
    .where(eq(orgLinkedinConnections.orgId, orgId))
    .limit(1);
  return Boolean(row);
}
