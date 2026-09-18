/**
 * Org-scoped read layer for the UI.
 *
 * Every query the browser used to run against PostgREST (under RLS) is now a
 * server function scoped by the caller's verified organisation. Rows are
 * returned in the exact PostgREST wire shape routes were written against:
 * snake_case column names, ISO date strings.
 */
import { and, desc, eq, inArray, or, sql } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { db } from "../server/db";
import {
  aiInterviews,
  candidateNotes,
  candidateReferrals,
  candidateOwnershipEvents,
  applications,
  candidateAssessments,
  candidateVerifications,
  candidates,
  departments,
  evaluations,
  interviews,
  jobDescriptions,
  matchScores,
  masterItems,
  offers,
  requisitions,
  socialProfiles,
  stageEvents,
  talentRequestSuggestions,
  talentRequests,
  orgPoolShares,
} from "@db/schema";
import { requireOrg } from "./auth.middleware";

/** JSON-safe value — what a server function is allowed to return. */
type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/** camelCase drizzle row → PostgREST-style snake_case row with ISO dates. */
function snakeRow(row: Record<string, unknown>): Record<string, Json> {
  const out: Record<string, Json> = {};
  for (const [key, value] of Object.entries(row)) {
    out[key.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`)] =
      value instanceof Date ? value.toISOString() : (value as Json);
  }
  return out;
}

function snakeRows(rows: Record<string, unknown>[]): Record<string, Json>[] {
  return rows.map((r) => snakeRow(r));
}

export const listDepartments = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(departments)
      .where(eq(departments.orgId, context.orgId))
      .orderBy(departments.name);
    return snakeRows(rows);
  });

export const listMasterItems = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(masterItems)
      .where(and(eq(masterItems.orgId, context.orgId), eq(masterItems.active, true)))
      .orderBy(masterItems.sortOrder, masterItems.name);
    return snakeRows(rows);
  });

export const listRequisitions = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(requisitions)
      .where(eq(requisitions.orgId, context.orgId))
      .orderBy(desc(requisitions.createdAt));
    return snakeRows(rows);
  });

export const getRequisition = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const [row] = await db
      .select()
      .from(requisitions)
      .where(and(eq(requisitions.id, data.id), eq(requisitions.orgId, context.orgId)))
      .limit(1);
    return row ? snakeRow(row) : null;
  });

export const listJobDescriptions = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ requisitionId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const rows = await db
      .select()
      .from(jobDescriptions)
      .where(
        and(
          eq(jobDescriptions.requisitionId, data.requisitionId),
          eq(jobDescriptions.orgId, context.orgId),
        ),
      )
      .orderBy(desc(jobDescriptions.version));
    return snakeRows(rows);
  });

export const listCandidates = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    // Own pool, plus pools shared with us under an active consortium agreement.
    // The share's scope is ENFORCED here: a redacted share exposes only the
    // professional summary — never resume text, phone, email or CTC.
    const shares = await db
      .select({ ownerOrg: orgPoolShares.ownerOrg, scope: orgPoolShares.scope })
      .from(orgPoolShares)
      .where(and(eq(orgPoolShares.partnerOrg, context.orgId), eq(orgPoolShares.status, "active")));

    const isRedacted = (scope: string | null) => Boolean(scope && /redact/i.test(scope));
    const fullOwners = shares.filter((s) => !isRedacted(s.scope)).map((s) => s.ownerOrg);
    const redactedOwners = shares.filter((s) => isRedacted(s.scope)).map((s) => s.ownerOrg);

    const ownRows = await db
      .select()
      .from(candidates)
      .where(eq(candidates.orgId, context.orgId))
      .orderBy(desc(candidates.createdAt));

    const fullShared = fullOwners.length
      ? await db
          .select()
          .from(candidates)
          .where(inArray(candidates.orgId, fullOwners))
          .orderBy(desc(candidates.createdAt))
      : [];

    const redactedShared = redactedOwners.length
      ? await db
          .select({
            id: candidates.id,
            orgId: candidates.orgId,
            fullName: candidates.fullName,
            email: sql<string | null>`null`,
            phone: sql<string | null>`null`,
            location: candidates.location,
            source: candidates.source,
            experienceYears: candidates.experienceYears,
            currentCtc: sql<string | null>`null`,
            expectedCtc: sql<string | null>`null`,
            noticePeriodDays: candidates.noticePeriodDays,
            education: candidates.education,
            skills: candidates.skills,
            resumeText: sql<string | null>`null`,
            linkedinUrl: candidates.linkedinUrl,
            githubUrl: candidates.githubUrl,
            websiteUrl: candidates.websiteUrl,
            xUrl: candidates.xUrl,
            createdAt: candidates.createdAt,
          })
          .from(candidates)
          .where(inArray(candidates.orgId, redactedOwners))
          .orderBy(desc(candidates.createdAt))
      : [];

    return snakeRows([...ownRows, ...fullShared, ...redactedShared] as never);
  });

export const getCandidate = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const [row] = await db
      .select()
      .from(candidates)
      .where(and(eq(candidates.id, data.id), eq(candidates.orgId, context.orgId)))
      .limit(1);
    return row ? snakeRow(row) : null;
  });

export const listApplications = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db.select().from(applications).where(eq(applications.orgId, context.orgId));
    return snakeRows(rows);
  });

export const listMatchScores = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(matchScores)
      .where(eq(matchScores.orgId, context.orgId))
      .orderBy(desc(matchScores.computedAt));
    return snakeRows(rows);
  });

export const listSocialProfiles = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(socialProfiles)
      .where(eq(socialProfiles.orgId, context.orgId));
    return snakeRows(rows);
  });

export const listEvaluations = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(evaluations)
      .where(eq(evaluations.orgId, context.orgId))
      .orderBy(desc(evaluations.createdAt));
    return snakeRows(rows);
  });

export const listInterviews = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(interviews)
      .where(eq(interviews.orgId, context.orgId))
      .orderBy(interviews.scheduledAt);
    return snakeRows(rows);
  });

export const listOffers = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(offers)
      .where(eq(offers.orgId, context.orgId))
      .orderBy(desc(offers.createdAt));
    return snakeRows(rows);
  });

export const listAiInterviews = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db.select().from(aiInterviews).where(eq(aiInterviews.orgId, context.orgId));
    return snakeRows(rows);
  });

export const listStageEvents = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z.object({ applicationIds: z.array(z.string().uuid()) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    if (!data.applicationIds.length) return [];
    const rows = await db
      .select()
      .from(stageEvents)
      .where(
        and(
          inArray(stageEvents.applicationId, data.applicationIds),
          eq(stageEvents.orgId, context.orgId),
        ),
      )
      .orderBy(desc(stageEvents.createdAt));
    return snakeRows(rows);
  });

export const listVerifications = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(candidateVerifications)
      .where(eq(candidateVerifications.orgId, context.orgId))
      .orderBy(desc(candidateVerifications.createdAt));
    return snakeRows(rows);
  });

export const listCandidateVerifications = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ candidateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const rows = await db
      .select()
      .from(candidateVerifications)
      .where(
        and(
          eq(candidateVerifications.candidateId, data.candidateId),
          eq(candidateVerifications.orgId, context.orgId),
        ),
      )
      .orderBy(desc(candidateVerifications.createdAt));
    return snakeRows(rows);
  });

export const listCandidateAssessments = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ candidateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const rows = await db
      .select()
      .from(candidateAssessments)
      .where(
        and(
          eq(candidateAssessments.candidateId, data.candidateId),
          eq(candidateAssessments.orgId, context.orgId),
        ),
      )
      .orderBy(desc(candidateAssessments.createdAt));
    return snakeRows(rows);
  });

/** Every graded screening call in the organisation, newest first (PostgREST wire shape). */
export const listAllScreeningRuns = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const res = (await db.execute(
      sql`select * from screening_runs where org_id = ${context.orgId} order by created_at desc`,
    )) as unknown as { rows?: Record<string, unknown>[] };
    return res.rows ?? [];
  });

/* ------------------------------------------------- team & sharing (0030) */

export const listCandidateReferrals = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(candidateReferrals)
      .where(eq(candidateReferrals.orgId, context.orgId))
      .orderBy(desc(candidateReferrals.createdAt));
    return snakeRows(rows);
  });

export const listTalentRequests = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(talentRequests)
      .where(eq(talentRequests.orgId, context.orgId))
      .orderBy(desc(talentRequests.createdAt));
    return snakeRows(rows);
  });

export const listTalentRequestSuggestions = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const rows = await db
      .select()
      .from(talentRequestSuggestions)
      .where(eq(talentRequestSuggestions.orgId, context.orgId))
      .orderBy(desc(talentRequestSuggestions.createdAt));
    return snakeRows(rows);
  });

export const listCandidateNotes = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ candidateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const rows = await db
      .select()
      .from(candidateNotes)
      .where(and(eq(candidateNotes.orgId, context.orgId), eq(candidateNotes.candidateId, data.candidateId)))
      .orderBy(desc(candidateNotes.createdAt));
    return snakeRows(rows);
  });

export const listScreeningKits = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .handler(async ({ context }) => {
    const res = (await db.execute(
      sql`select * from screening_kits where org_id = ${context.orgId} order by created_at desc`,
    )) as unknown as { rows?: Record<string, unknown>[] };
    return res.rows ?? [];
  });

export const listCandidateScreeningKits = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ candidateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const res = (await db.execute(
      sql`select * from screening_kits where org_id = ${context.orgId} and candidate_id = ${data.candidateId} order by created_at desc`,
    )) as unknown as { rows?: Record<string, unknown>[] };
    return res.rows ?? [];
  });

export const listCandidateScreeningRuns = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ candidateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const res = (await db.execute(
      sql`select * from screening_runs where org_id = ${context.orgId} and candidate_id = ${data.candidateId} order by created_at desc`,
    )) as unknown as { rows?: Record<string, unknown>[] };
    return res.rows ?? [];
  });

export const listOwnershipEvents = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ candidateId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const rows = await db
      .select()
      .from(candidateOwnershipEvents)
      .where(
        and(
          eq(candidateOwnershipEvents.orgId, context.orgId),
          eq(candidateOwnershipEvents.candidateId, data.candidateId),
        ),
      )
      .orderBy(desc(candidateOwnershipEvents.createdAt));
    return snakeRows(rows);
  });
