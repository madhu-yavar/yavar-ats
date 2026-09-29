/**
 * Board-sync poller — the cron half of application ingestion. Walks every
 * enabled board connection (plus orgs with a live LinkedIn connection), pulls
 * applications where the board's contract allows polling, and pushes each one
 * through the same idempotent event store as the webhook transport.
 */
import { and, eq, inArray, isNotNull } from "drizzle-orm";

import { db } from "../db";
import { orgLinkedinConnections, sourceIntegrations } from "@db/schema";
import {
  ingestPolledApplication,
  lastPolledAt,
  purgeOldEvents,
  recordSyncRun,
  retryPendingEvents,
} from "./ingest.server";
import { getBoardAdapter, loadBoardConnection, isBoardProvider } from "./registry";
import { BOARD_PROVIDERS } from "./types";

export type PollSummary = {
  connections: number;
  polled: number;
  accepted: number;
  duplicates: number;
  failed: number;
  eventsRetried: number;
  eventsPurged: number;
  errors: string[];
};

export async function pollAllBoards(opts: { max?: number }): Promise<PollSummary> {
  const limit = Math.min(opts.max ?? 25, 50);
  const summary: PollSummary = {
    connections: 0,
    polled: 0,
    accepted: 0,
    duplicates: 0,
    failed: 0,
    eventsRetried: 0,
    eventsPurged: 0,
    errors: [],
  };

  // Enabled board integrations, plus orgs whose LinkedIn account is connected
  // (that connection lives outside source_integrations).
  const rows = await db
    .select({
      orgId: sourceIntegrations.orgId,
      integrationId: sourceIntegrations.id,
      provider: sourceIntegrations.provider,
    })
    .from(sourceIntegrations)
    .where(
      and(
        eq(sourceIntegrations.enabled, true),
        inArray(sourceIntegrations.provider, BOARD_PROVIDERS),
        isNotNull(sourceIntegrations.orgId),
      ),
    );

  const linkedinOrgs = await db
    .select({ orgId: orgLinkedinConnections.orgId })
    .from(orgLinkedinConnections);

  type Target = { orgId: string; integrationId: string | null; provider: string };
  const targets: Target[] = [];
  for (const row of rows) {
    if (row.orgId) {
      targets.push({ orgId: row.orgId, integrationId: row.integrationId, provider: row.provider });
    }
  }
  for (const conn of linkedinOrgs) {
    // LinkedIn rows are usually enabled anyway; add the org only if absent.
    if (!targets.some((t) => t.orgId === conn.orgId && t.provider === "linkedin")) {
      const [row] = await db
        .select({ id: sourceIntegrations.id })
        .from(sourceIntegrations)
        .where(
          and(
            eq(sourceIntegrations.orgId, conn.orgId),
            eq(sourceIntegrations.provider, "linkedin"),
          ),
        )
        .limit(1);
      targets.push({ orgId: conn.orgId, integrationId: row?.id ?? null, provider: "linkedin" });
    }
  }

  for (const target of targets) {
    if (!isBoardProvider(target.provider)) continue;
    summary.connections += 1;
    try {
      const conn = await loadBoardConnection(target.orgId, target.provider);
      const adapter = getBoardAdapter(target.provider);
      const caps = await adapter.capabilities(conn);
      if (caps.applicationsMode !== "polling" || caps.applications !== true) {
        await recordSyncRun({
          orgId: target.orgId,
          integrationId: target.integrationId ?? "",
          provider: target.provider,
          ok: true,
          polledAt: null,
          stats: { skipped: 1 },
        });
        continue;
      }
      const since = target.integrationId ? await lastPolledAt(target.integrationId) : null;
      const found = await adapter.pollApplications(conn, { since, limit });
      summary.polled += found.length;
      let accepted = 0;
      let duplicates = 0;
      let failed = 0;
      for (const normalized of found) {
        const outcome = await ingestPolledApplication({
          orgId: target.orgId,
          integrationId: target.integrationId ?? "",
          provider: target.provider,
          normalized,
        });
        if (outcome.status === "accepted") accepted += 1;
        else if (outcome.status === "duplicate") duplicates += 1;
        else failed += 1;
      }
      summary.accepted += accepted;
      summary.duplicates += duplicates;
      summary.failed += failed;
      await recordSyncRun({
        orgId: target.orgId,
        integrationId: target.integrationId ?? "",
        provider: target.provider,
        ok: true,
        stats: { found: found.length, accepted, duplicates, failed },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : "poll failed";
      summary.errors.push(`${target.provider}/${target.orgId.slice(0, 8)}: ${message}`);
      await recordSyncRun({
        orgId: target.orgId,
        integrationId: target.integrationId ?? "",
        provider: target.provider,
        ok: false,
        error: message,
      }).catch(() => undefined);
    }
  }

  // Crash recovery + PII retention.
  summary.eventsRetried = await retryPendingEvents(limit).catch(() => 0);
  summary.eventsPurged = await purgeOldEvents().catch(() => 0);
  return summary;
}
