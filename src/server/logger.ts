/**
 * Structured application log — the write side of the superadmin observability
 * console. Everything lands in `app_logs`: HTTP request timings, server-fn
 * outcomes, email send attempts, AI trace summaries, client-side errors, and
 * anything routed through console.error/warn (patched in error-capture.ts).
 *
 * Fail-open contract: logApp never throws and never logs through the patched
 * console (a module-scoped fallback captured before error-capture.ts patches
 * it), so a logging outage can never break a request, a send, or an AI call.
 * Server-only.
 */
import { sql } from "drizzle-orm";

import type { AppLogLevel, AppLogSource } from "@db/schema";

const MESSAGE_CAP = 2_000;
const DETAIL_CAP = 8_000;
/** Rows older than this are swept from app_logs + ai_traces. */
const RETENTION_DAYS = 14;
const PURGE_EVERY_MS = 30 * 60_000;

/** Bound before error-capture.ts patches console — recursion-proof sink. */
const fallbackConsoleError = console.error.bind(console);

export interface LogContext {
  /** Structured context or a stack string — capped at DETAIL_CAP chars. */
  detail?: unknown;
  orgId?: string | null;
  userId?: string | null;
  route?: string | null;
  statusCode?: number | null;
  durationMs?: number | null;
}

export function logApp(
  level: AppLogLevel,
  source: AppLogSource,
  message: string,
  ctx: LogContext = {},
): void {
  // Fire-and-forget: dynamic imports keep this module loadable from anywhere
  // (including error-capture.ts, which runs before the server boots) and keep
  // a logging failure strictly inside this promise.
  void (async () => {
    try {
      const [{ db }, { appLogs }] = await Promise.all([import("./db"), import("@db/schema")]);
      await db.insert(appLogs).values({
        level,
        source,
        message: message.slice(0, MESSAGE_CAP),
        detail: capDetail(ctx.detail),
        orgId: ctx.orgId ?? null,
        userId: ctx.userId ?? null,
        route: ctx.route ?? null,
        statusCode: ctx.statusCode ?? null,
        durationMs: ctx.durationMs ?? null,
      });
    } catch (e) {
      fallbackConsoleError("[logger] app_logs write failed:", message, e);
    }
  })();

  void maybePurge();
}

/** Flattens any value into a jsonb-safe string under the detail cap. */
function capDetail(detail: unknown): string | null {
  if (detail == null) return null;
  let text: string;
  if (typeof detail === "string") {
    text = detail;
  } else {
    try {
      text = JSON.stringify(detail, (_, v) => (typeof v === "bigint" ? String(v) : v));
    } catch {
      text = String(detail);
    }
    if (text == null || text === "undefined") text = String(detail);
  }
  const sliced = text.slice(0, DETAIL_CAP);
  return text.length > DETAIL_CAP ? `${sliced}…[truncated]` : sliced;
}

let lastPurgeAt = 0;

/** Opportunistic retention sweep — at most one attempt per PURGE_EVERY_MS. */
async function maybePurge(): Promise<void> {
  if (Date.now() - lastPurgeAt < PURGE_EVERY_MS) return;
  lastPurgeAt = Date.now();
  try {
    const { db } = await import("./db");
    const cutoff = sql.raw(`now() - interval '${RETENTION_DAYS} days'`);
    await db.execute(
      sql`delete from app_logs where created_at < ${cutoff} and id in (
            select id from app_logs where created_at < ${cutoff} limit 5000)`,
    );
    await db.execute(
      sql`delete from ai_traces where created_at < ${cutoff} and id in (
            select id from ai_traces where created_at < ${cutoff} limit 5000)`,
    );
  } catch {
    // Retention is best-effort; the next insert retries in 30 minutes.
  }
}
