import { and, desc, eq, gte, ilike, inArray, sql } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { db } from "../server/db";
import {
  aiTraceSteps,
  aiTraces,
  aiUsageEvents,
  appLogs,
  boardSyncState,
  emailOutbox,
  hrmsSyncState,
  organizations,
  screeningPrepJobs,
  sourceIntegrations,
} from "@db/schema";
import { requirePlatformAdmin } from "./auth.middleware";

/**
 * Observability console reads — super-user only (platform_admins allowlist,
 * verified email). These are the only readers of app_logs / ai_traces; both
 * tables can carry untrusted content (stack traces, CV text), which is exactly
 * why nothing here ever runs without the middleware. Every read accepts an
 * optional orgId so the whole console re-scopes to one organisation.
 */

const ConsoleInput = z.object({
  hours: z.coerce.number().int().min(1).max(720).default(24),
  orgId: z.string().uuid().optional().nullable(),
});

const n = (v: unknown) => Number(v ?? 0);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

const CAPABILITIES = ["matching", "jd", "screening", "research", "comms", "copilot", "platform"];

/* ------------------------------------------------------------------ overview */

export type ObsOverview = Awaited<ReturnType<typeof obsOverview>>;

export const obsOverview = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((data: unknown) => ConsoleInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    const since = new Date(Date.now() - data.hours * 3_600_000);
    const logWhere = data.orgId
      ? and(gte(appLogs.createdAt, since), eq(appLogs.orgId, data.orgId))
      : gte(appLogs.createdAt, since);

    const [logs] = await db
      .select({
        errors: sql<number>`count(*) filter (where ${appLogs.level} = 'error')`,
        warns: sql<number>`count(*) filter (where ${appLogs.level} = 'warn')`,
        total: sql<number>`count(*)`,
        clientErrors: sql<number>`count(*) filter (where ${appLogs.source} = 'client' and ${appLogs.level} = 'error')`,
        emailErrors: sql<number>`count(*) filter (where ${appLogs.source} = 'email' and ${appLogs.level} = 'error')`,
        emailOk: sql<number>`count(*) filter (where ${appLogs.source} = 'email' and ${appLogs.level} = 'info')`,
      })
      .from(appLogs)
      .where(logWhere);

    // The trace is the primary AI object in this console — headline counts
    // read ai_traces; tokens still come from the per-attempt ledger.
    const traceWhere = data.orgId
      ? and(gte(aiTraces.createdAt, since), eq(aiTraces.orgId, data.orgId))
      : gte(aiTraces.createdAt, since);
    const [ai] = await db
      .select({
        calls: sql<number>`count(*)`,
        errors: sql<number>`count(*) filter (where ${aiTraces.ok} = false)`,
        totalTokens: sql<number>`coalesce((
          select sum(${aiUsageEvents.totalTokens}) from ${aiUsageEvents}
          where ${aiUsageEvents.traceId} in (select id from ${aiTraces} t where t.created_at >= ${since.toISOString()} ${data.orgId ? sql`and t.org_id = ${data.orgId}` : sql``})
        ), 0)`,
      })
      .from(aiTraces)
      .where(traceWhere);

    const [prep] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${screeningPrepJobs.status} = 'pending')`,
        running: sql<number>`count(*) filter (where ${screeningPrepJobs.status} = 'running')`,
        failed: sql<number>`count(*) filter (where ${screeningPrepJobs.status} = 'failed')`,
      })
      .from(screeningPrepJobs);

    const [mail] = await db
      .select({
        queued: sql<number>`count(*) filter (where ${emailOutbox.status} = 'queued')`,
        failed: sql<number>`count(*) filter (where ${emailOutbox.status} = 'failed')`,
      })
      .from(emailOutbox)
      .where(data.orgId ? eq(emailOutbox.orgId, data.orgId) : undefined);

    // Trend lines — hourly within a 48h window, daily beyond.
    const stamp = data.hours <= 48 ? "YYYY-MM-DD HH24:00" : "YYYY-MM-DD";
    const logBucket = sql<string>`to_char(date_trunc(${data.hours <= 48 ? "hour" : "day"}, ${appLogs.createdAt}), ${stamp})`;
    const errorSeries = await db
      .select({ bucket: logBucket, count: sql<number>`count(*)` })
      .from(appLogs)
      .where(and(logWhere, inArray(appLogs.level, ["error", "warn"])))
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const aiBucket = sql<string>`to_char(date_trunc(${data.hours <= 48 ? "hour" : "day"}, ${aiTraces.createdAt}), ${stamp})`;
    const aiSeries = await db
      .select({
        bucket: aiBucket,
        ok: sql<number>`count(*) filter (where ${aiTraces.ok} = true)`,
        errors: sql<number>`count(*) filter (where ${aiTraces.ok} = false)`,
      })
      .from(aiTraces)
      .where(traceWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`);

    const orgBreakdown = await db
      .select({
        orgId: aiTraces.orgId,
        orgName: organizations.name,
        aiCalls: sql<number>`count(*)`,
        aiErrors: sql<number>`count(*) filter (where ${aiTraces.ok} = false)`,
        totalTokens: sql<number>`coalesce((
          select sum(${aiUsageEvents.totalTokens}) from ${aiUsageEvents}
          where ${aiUsageEvents.traceId} in (select id from ${aiTraces} t where t.org_id = ${aiTraces.orgId} and t.created_at >= ${since.toISOString()})
        ), 0)`,
      })
      .from(aiTraces)
      .leftJoin(organizations, eq(organizations.id, aiTraces.orgId))
      .where(traceWhere)
      .groupBy(aiTraces.orgId, organizations.name)
      .orderBy(desc(sql`count(*)`))
      .limit(8);

    const capabilityRows = await db
      .select({
        capability: sql<string>`coalesce(${aiTraces.capability}, 'platform')`,
        calls: sql<number>`count(*)`,
        errors: sql<number>`count(*) filter (where ${aiTraces.ok} = false)`,
      })
      .from(aiTraces)
      .where(
        and(
          gte(aiTraces.createdAt, since),
          ...(data.orgId ? [eq(aiTraces.orgId, data.orgId)] : []),
        ),
      )
      .groupBy(sql`1`);

    const latestErrors = await db
      .select({
        id: appLogs.id,
        createdAt: appLogs.createdAt,
        level: appLogs.level,
        source: appLogs.source,
        message: appLogs.message,
        route: appLogs.route,
      })
      .from(appLogs)
      .where(and(logWhere, inArray(appLogs.level, ["error", "warn"])))
      .orderBy(desc(appLogs.createdAt))
      .limit(8);

    const syncStates = await db
      .select({
        kind: sql<string>`'hrms'`,
        name: sourceIntegrations.label,
        orgId: sourceIntegrations.orgId,
        orgName: organizations.name,
        lastRunAt: hrmsSyncState.lastRunAt,
        lastRunStatus: hrmsSyncState.lastRunStatus,
        lastError: hrmsSyncState.lastError,
      })
      .from(hrmsSyncState)
      .innerJoin(sourceIntegrations, eq(sourceIntegrations.id, hrmsSyncState.integrationId))
      .innerJoin(organizations, eq(organizations.id, sourceIntegrations.orgId));

    const boardStates = await db
      .select({
        kind: sql<string>`'board'`,
        name: sourceIntegrations.label,
        orgId: sourceIntegrations.orgId,
        orgName: organizations.name,
        lastRunAt: boardSyncState.lastRunAt,
        lastRunStatus: boardSyncState.lastRunStatus,
        lastError: boardSyncState.lastError,
      })
      .from(boardSyncState)
      .innerJoin(sourceIntegrations, eq(sourceIntegrations.id, boardSyncState.integrationId))
      .innerJoin(organizations, eq(organizations.id, sourceIntegrations.orgId));

    return {
      window: { hours: data.hours },
      orgId: data.orgId ?? null,
      logs: {
        errors: n(logs?.errors),
        warns: n(logs?.warns),
        total: n(logs?.total),
        clientErrors: n(logs?.clientErrors),
        emailErrors: n(logs?.emailErrors),
        emailOk: n(logs?.emailOk),
      },
      ai: { calls: n(ai?.calls), errors: n(ai?.errors), totalTokens: n(ai?.totalTokens) },
      errorSeries: errorSeries.map((r) => ({ bucket: r.bucket, count: n(r.count) })),
      aiSeries: aiSeries.map((r) => ({ bucket: r.bucket, ok: n(r.ok), errors: n(r.errors) })),
      orgBreakdown: orgBreakdown.map((r) => ({
        orgId: r.orgId,
        orgName: r.orgName ?? "Unattributed",
        aiCalls: n(r.aiCalls),
        aiErrors: n(r.aiErrors),
        totalTokens: n(r.totalTokens),
      })),
      capabilityBreakdown: CAPABILITIES.map((c) => {
        const row = capabilityRows.find((r) => r.capability === c);
        return { capability: c, calls: n(row?.calls), errors: n(row?.errors) };
      }).filter((r) => r.calls > 0),
      jobs: {
        prep: { pending: n(prep?.pending), running: n(prep?.running), failed: n(prep?.failed) },
        mail: { queued: n(mail?.queued), failed: n(mail?.failed) },
        syncs: [...syncStates, ...boardStates]
          .filter((s) => !data.orgId || s.orgId === data.orgId)
          .map((s) => ({
            kind: s.kind,
            name: s.name,
            orgName: s.orgName,
            lastRunAt: iso(s.lastRunAt),
            lastRunStatus: s.lastRunStatus,
            lastError: s.lastError,
          })),
      },
      latestErrors: latestErrors.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  });

/* ---------------------------------------------------------------------- logs */

const LogsInput = ConsoleInput.extend({
  level: z.enum(["debug", "info", "warn", "error", "all"]).default("all"),
  source: z
    .enum(["http", "server-fn", "client", "email", "ai", "cron", "auth", "job", "app", "all"])
    .default("all"),
  q: z.string().max(120).optional().nullable(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ObsLogRow = {
  id: string;
  createdAt: string;
  level: string;
  source: string;
  message: string;
  detail: string | null;
  route: string | null;
  statusCode: number | null;
  durationMs: number | null;
};

export const obsLogs = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((data: unknown) => LogsInput.parse(data ?? {}))
  .handler(async ({ data }): Promise<{ rows: ObsLogRow[]; total: number }> => {
    const conds = [gte(appLogs.createdAt, new Date(Date.now() - data.hours * 3_600_000))];
    if (data.orgId) conds.push(eq(appLogs.orgId, data.orgId));
    if (data.level !== "all") conds.push(eq(appLogs.level, data.level));
    if (data.source !== "all") conds.push(eq(appLogs.source, data.source));
    if (data.q) conds.push(ilike(appLogs.message, `%${data.q.replace(/[%_]/g, "\\$&")}%`));
    const where = and(...conds);

    const rows = await db
      .select({
        id: appLogs.id,
        createdAt: appLogs.createdAt,
        level: appLogs.level,
        source: appLogs.source,
        message: appLogs.message,
        detail: appLogs.detail,
        route: appLogs.route,
        statusCode: appLogs.statusCode,
        durationMs: appLogs.durationMs,
      })
      .from(appLogs)
      .where(where)
      .orderBy(desc(appLogs.createdAt))
      .limit(data.limit)
      .offset(data.offset);
    const [counted] = await db
      .select({ total: sql<number>`count(*)` })
      .from(appLogs)
      .where(where);
    return {
      rows: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        detail: (r.detail as string | null) ?? null,
      })),
      total: n(counted?.total),
    };
  });

/* ----------------------------------------------------------------- ai traces */

const TraceListInput = ConsoleInput.extend({
  hours: z.coerce.number().int().min(1).max(720).default(168),
  capability: z.string().max(30).optional().nullable(),
  outcome: z.enum(["all", "ok", "error"]).default("all"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export type ObsTraceRow = {
  id: string;
  createdAt: string;
  orgName: string | null;
  feature: string;
  capability: string | null;
  harness: string | null;
  ok: boolean;
  schemaValid: boolean | null;
  attempts: number;
  durationMs: number | null;
  grounded: boolean | null;
  errorMessage: string | null;
  totalTokens: number;
};

export const obsAiTraces = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((data: unknown) => TraceListInput.parse(data ?? {}))
  .handler(async ({ data }): Promise<{ rows: ObsTraceRow[]; total: number }> => {
    const conds = [gte(aiTraces.createdAt, new Date(Date.now() - data.hours * 3_600_000))];
    if (data.orgId) conds.push(eq(aiTraces.orgId, data.orgId));
    if (data.capability) conds.push(eq(aiTraces.capability, data.capability));
    if (data.outcome !== "all") conds.push(eq(aiTraces.ok, data.outcome === "ok"));
    const where = and(...conds);

    const rows = await db
      .select({
        id: aiTraces.id,
        createdAt: aiTraces.createdAt,
        orgName: organizations.name,
        feature: aiTraces.feature,
        capability: aiTraces.capability,
        harness: aiTraces.harness,
        ok: aiTraces.ok,
        schemaValid: aiTraces.schemaValid,
        attempts: aiTraces.attempts,
        durationMs: aiTraces.durationMs,
        grounded: aiTraces.grounded,
        errorMessage: aiTraces.errorMessage,
        totalTokens: sql<number>`coalesce((
          select sum(${aiUsageEvents.totalTokens}) from ${aiUsageEvents}
          where ${aiUsageEvents.traceId} = ${aiTraces.id}
        ), 0)`,
      })
      .from(aiTraces)
      .leftJoin(organizations, eq(organizations.id, aiTraces.orgId))
      .where(where)
      .orderBy(desc(aiTraces.createdAt))
      .limit(data.limit)
      .offset(data.offset);
    const [counted] = await db
      .select({ total: sql<number>`count(*)` })
      .from(aiTraces)
      .where(where);
    return {
      rows: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        totalTokens: n(r.totalTokens),
      })),
      total: n(counted?.total),
    };
  });

/** One trace: harness panel data, full prompt/response, spans + ledger frames. */
export const obsAiTraceDetail = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data }) => {
    const [trace] = await db.select().from(aiTraces).where(eq(aiTraces.id, data.id)).limit(1);
    if (!trace) return null;
    const [frames, steps] = await Promise.all([
      db
        .select({
          attempt: aiUsageEvents.attempt,
          provider: aiUsageEvents.provider,
          model: aiUsageEvents.model,
          status: aiUsageEvents.status,
          durationMs: aiUsageEvents.durationMs,
          promptTokens: aiUsageEvents.promptTokens,
          completionTokens: aiUsageEvents.completionTokens,
          errorMessage: aiUsageEvents.errorMessage,
          createdAt: aiUsageEvents.createdAt,
        })
        .from(aiUsageEvents)
        .where(eq(aiUsageEvents.traceId, data.id))
        .orderBy(aiUsageEvents.attempt),
      db
        .select()
        .from(aiTraceSteps)
        .where(eq(aiTraceSteps.traceId, data.id))
        .orderBy(aiTraceSteps.seq),
    ]);
    return {
      ...trace,
      createdAt: trace.createdAt.toISOString(),
      frames: frames.map((f) => ({ ...f, createdAt: f.createdAt.toISOString() })),
      steps: steps.map((s) => ({
        seq: s.seq,
        kind: s.kind,
        name: s.name,
        status: s.status,
        input: s.input,
        output: s.output,
        error: s.error,
        durationMs: s.durationMs,
        startedAt: iso(s.startedAt),
      })),
    };
  });

export type ObsAiTraceDetail = NonNullable<Awaited<ReturnType<typeof obsAiTraceDetail>>>;

/* -------------------------------------------------------------------- email */

export type ObsEmailRow = {
  id: string;
  createdAt: string;
  orgName: string | null;
  kind: string;
  templateName: string;
  toEmail: string;
  status: string;
  attempts: number;
  lastError: string | null;
  sentAt: string | null;
};

/** Outbox rows + recent direct-send log lines — answers "was that email sent?". */
export const obsEmails = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((data: unknown) =>
    ConsoleInput.extend({
      status: z.enum(["all", "queued", "sent", "failed", "suppressed"]).default("all"),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }).parse(data ?? {}),
  )
  .handler(async ({ data }): Promise<{ outbox: ObsEmailRow[]; sends: ObsLogRow[] }> => {
    const conds = data.status === "all" ? [] : [eq(emailOutbox.status, data.status)];
    if (data.orgId) conds.push(eq(emailOutbox.orgId, data.orgId));
    const rows = await db
      .select({
        id: emailOutbox.id,
        createdAt: emailOutbox.createdAt,
        orgName: organizations.name,
        kind: emailOutbox.kind,
        templateName: emailOutbox.templateName,
        toEmail: emailOutbox.toEmail,
        status: emailOutbox.status,
        attempts: emailOutbox.attempts,
        lastError: emailOutbox.lastError,
        sentAt: emailOutbox.sentAt,
      })
      .from(emailOutbox)
      .leftJoin(organizations, eq(organizations.id, emailOutbox.orgId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(emailOutbox.createdAt))
      .limit(data.limit);

    const sendConds = [
      eq(appLogs.source, "email"),
      gte(appLogs.createdAt, new Date(Date.now() - 7 * 24 * 3_600_000)),
      ...(data.orgId ? [eq(appLogs.orgId, data.orgId)] : []),
    ];
    const sendRows = await db
      .select({
        id: appLogs.id,
        createdAt: appLogs.createdAt,
        level: appLogs.level,
        source: appLogs.source,
        message: appLogs.message,
        detail: appLogs.detail,
        route: appLogs.route,
        statusCode: appLogs.statusCode,
        durationMs: appLogs.durationMs,
      })
      .from(appLogs)
      .where(and(...sendConds))
      .orderBy(desc(appLogs.createdAt))
      .limit(50);

    return {
      outbox: rows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        sentAt: iso(r.sentAt),
      })),
      sends: sendRows.map((r) => ({
        ...r,
        createdAt: r.createdAt.toISOString(),
        detail: (r.detail as string | null) ?? null,
      })),
    };
  });

/* --------------------------------------------------------------------- jobs */

export type ObsJobsSnapshot = Awaited<ReturnType<typeof obsJobs>>;

export const obsJobs = createServerFn({ method: "POST" })
  .middleware([requirePlatformAdmin])
  .inputValidator((data: unknown) => ConsoleInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    const prepConds = data.orgId ? [eq(screeningPrepJobs.orgId, data.orgId)] : [];
    const prep = await db
      .select({
        id: screeningPrepJobs.id,
        orgName: organizations.name,
        status: screeningPrepJobs.status,
        attempts: screeningPrepJobs.attempts,
        lastError: screeningPrepJobs.lastError,
        updatedAt: screeningPrepJobs.updatedAt,
      })
      .from(screeningPrepJobs)
      .leftJoin(organizations, eq(organizations.id, screeningPrepJobs.orgId))
      .where(prepConds.length ? and(...prepConds) : undefined)
      .orderBy(desc(screeningPrepJobs.updatedAt))
      .limit(30);

    const [prepCounts] = await db
      .select({
        pending: sql<number>`count(*) filter (where ${screeningPrepJobs.status} = 'pending')`,
        running: sql<number>`count(*) filter (where ${screeningPrepJobs.status} = 'running')`,
        failed: sql<number>`count(*) filter (where ${screeningPrepJobs.status} = 'failed')`,
      })
      .from(screeningPrepJobs)
      .where(prepConds.length ? and(...prepConds) : undefined);

    const recentAiErrors = await db
      .select({
        feature: aiUsageEvents.feature,
        orgName: organizations.name,
        errorMessage: aiUsageEvents.errorMessage,
        createdAt: aiUsageEvents.createdAt,
      })
      .from(aiUsageEvents)
      .leftJoin(organizations, eq(organizations.id, aiUsageEvents.orgId))
      .where(
        and(
          eq(aiUsageEvents.status, "error"),
          gte(aiUsageEvents.createdAt, new Date(Date.now() - 7 * 24 * 3_600_000)),
          ...(data.orgId ? [eq(aiUsageEvents.orgId, data.orgId)] : []),
        ),
      )
      .orderBy(desc(aiUsageEvents.createdAt))
      .limit(15);

    const hrmsSyncs = await db
      .select({
        kind: sql<string>`'hrms'`,
        name: sourceIntegrations.label,
        orgId: sourceIntegrations.orgId,
        orgName: organizations.name,
        lastRunAt: hrmsSyncState.lastRunAt,
        lastRunStatus: hrmsSyncState.lastRunStatus,
        lastError: hrmsSyncState.lastError,
      })
      .from(hrmsSyncState)
      .innerJoin(sourceIntegrations, eq(sourceIntegrations.id, hrmsSyncState.integrationId))
      .innerJoin(organizations, eq(organizations.id, sourceIntegrations.orgId));
    const boardSyncs = await db
      .select({
        kind: sql<string>`'board'`,
        name: sourceIntegrations.label,
        orgId: sourceIntegrations.orgId,
        orgName: organizations.name,
        lastRunAt: boardSyncState.lastRunAt,
        lastRunStatus: boardSyncState.lastRunStatus,
        lastError: boardSyncState.lastError,
      })
      .from(boardSyncState)
      .innerJoin(sourceIntegrations, eq(sourceIntegrations.id, boardSyncState.integrationId))
      .innerJoin(organizations, eq(organizations.id, sourceIntegrations.orgId));

    return {
      prepCounts: {
        pending: n(prepCounts?.pending),
        running: n(prepCounts?.running),
        failed: n(prepCounts?.failed),
      },
      prep: prep.map((r) => ({ ...r, updatedAt: r.updatedAt.toISOString() })),
      syncs: [...hrmsSyncs, ...boardSyncs]
        .filter((s) => !data.orgId || s.orgId === data.orgId)
        .map((s) => ({ ...s, lastRunAt: iso(s.lastRunAt) })),
      aiErrors: recentAiErrors.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
  });
