import { and, desc, eq } from "drizzle-orm";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { db } from "../server/db";
import {
  applications,
  candidates,
  jobDescriptions,
  matchScores,
  requisitions,
  screeningKits,
  screeningRuns,
} from "@db/schema";
import { getObject, putObject } from "../server/storage";
import { requireOrg } from "./auth.middleware";
import {
  buildScreeningKit,
  gradeScreening,
  transcribeScreeningAudio,
  type ScreeningQuestion,
} from "./screening.server";

const QuestionSchema = z.object({
  id: z.string(),
  focus: z.string(),
  question: z.string(),
  reason: z.string(),
  expected_answer: z.string(),
  weak_answer: z.string(),
  weight: z.number(),
});

/**
 * Pull JD, requisition, candidate and the latest match for one pairing.
 * Every lookup carries the caller's org predicate — the candidate, the
 * requisition and the application must all belong to the caller's org.
 */
async function loadPairing(orgId: string, candidateId: string, requisitionId: string | null) {
  const [candidate] = await db
    .select()
    .from(candidates)
    .where(and(eq(candidates.id, candidateId), eq(candidates.orgId, orgId)))
    .limit(1);
  if (!candidate) throw new Error("Candidate not found");

  let requisition: typeof requisitions.$inferSelect | null = null;
  if (requisitionId) {
    const [row] = await db
      .select()
      .from(requisitions)
      .where(and(eq(requisitions.id, requisitionId), eq(requisitions.orgId, orgId)))
      .limit(1);
    requisition = row ?? null;
  }

  let application: { id: string } | null = null;
  if (requisitionId) {
    const [row] = await db
      .select({ id: applications.id })
      .from(applications)
      .where(
        and(
          eq(applications.candidateId, candidateId),
          eq(applications.requisitionId, requisitionId),
          eq(applications.orgId, orgId),
        ),
      )
      .orderBy(applications.appliedAt)
      .limit(1);
    application = row ?? null;
  }

  let jdText = "";
  if (requisitionId) {
    const [row] = await db
      .select({
        fullText: jobDescriptions.fullText,
        purpose: jobDescriptions.purpose,
        responsibilities: jobDescriptions.responsibilities,
        qualifications: jobDescriptions.qualifications,
      })
      .from(jobDescriptions)
      .where(
        and(eq(jobDescriptions.requisitionId, requisitionId), eq(jobDescriptions.orgId, orgId)),
      )
      .orderBy(desc(jobDescriptions.version))
      .limit(1);
    jdText =
      row?.fullText ??
      [row?.purpose, row?.responsibilities, row?.qualifications].filter(Boolean).join("\n\n") ??
      "";
  }
  if (!jdText && requisition) {
    jdText = [
      `Role: ${requisition.title}`,
      requisition.responsibilities ?? "",
      `Must-have: ${(requisition.mustHaveSkills ?? []).join(", ")}`,
      `Good to have: ${(requisition.goodToHaveSkills ?? []).join(", ")}`,
      requisition.educationRequirement ? `Qualification: ${requisition.educationRequirement}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  let match: {
    overallScore: number | null;
    rationale: string | null;
    missingSkills: string[];
    riskFlags: string[];
  } | null = null;
  if (application) {
    const [row] = await db
      .select({
        overallScore: matchScores.overallScore,
        rationale: matchScores.rationale,
        missingSkills: matchScores.missingSkills,
        riskFlags: matchScores.riskFlags,
      })
      .from(matchScores)
      .where(eq(matchScores.applicationId, application.id))
      .orderBy(desc(matchScores.computedAt))
      .limit(1);
    match = row ?? null;
  }

  return { candidate, requisition, application, jdText, match };
}

/* --------------------------------------------------------------- build kit */

export const createScreeningKit = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        candidateId: z.string().uuid(),
        requisitionId: z.string().uuid().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { candidate, requisition, application, jdText, match } = await loadPairing(
      context.orgId,
      data.candidateId,
      data.requisitionId ?? null,
    );
    if (!requisition) throw new Error("Pick the role this screening call is for.");
    if (!jdText.trim()) throw new Error("This role has no job description text yet.");

    const kit = await buildScreeningKit({
      orgId: context.orgId,
      role: requisition.title,
      jdText,
      mustHave: requisition.mustHaveSkills ?? [],
      goodToHave: requisition.goodToHaveSkills ?? [],
      experienceMin: requisition.experienceMin ?? 0,
      experienceMax: requisition.experienceMax ?? 0,
      budgetCtc: requisition.budgetCtc != null ? Number(requisition.budgetCtc) : null,
      currency: "INR",
      candidateName: candidate.fullName,
      resumeText: candidate.resumeText,
      candidateSkills: candidate.skills ?? [],
      experienceYears: Number(candidate.experienceYears) || 0,
      currentEmployer: candidate.currentEmployer,
      employmentHistory: candidate.employmentHistory,
      education: candidate.education,
      currentCtc: candidate.currentCtc != null ? Number(candidate.currentCtc) : null,
      expectedCtc: candidate.expectedCtc != null ? Number(candidate.expectedCtc) : null,
      noticePeriodDays: candidate.noticePeriodDays,
      location: candidate.location,
      matchRationale: match?.rationale ?? null,
      missingSkills: match?.missingSkills ?? [],
      riskFlags: match?.riskFlags ?? [],
    });

    const [row] = await db
      .insert(screeningKits)
      .values({
        orgId: context.orgId,
        candidateId: candidate.id,
        requisitionId: requisition.id,
        applicationId: application?.id ?? null,
        questions: kit.questions as never,
        focusSummary: kit.focus_summary,
        engine: kit.engine as never,
        createdBy: context.userId,
      })
      .returning({ id: screeningKits.id });
    if (!row) throw new Error("Could not save the screening kit");

    return { kitId: row.id, ...kit };
  });

/* ------------------------------------------------------------- edit a kit */

export const saveScreeningKit = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        kitId: z.string().uuid(),
        questions: z.array(QuestionSchema).min(1).max(20),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const updated = await db
      .update(screeningKits)
      .set({ questions: data.questions as never, updatedAt: new Date() })
      .where(and(eq(screeningKits.id, data.kitId), eq(screeningKits.orgId, context.orgId)))
      .returning({ id: screeningKits.id });
    if (!updated.length) throw new Error("Screening kit not found");
    return { ok: true };
  });

/* ---------------------------------------------------------- grade answers */

export const gradeScreeningAnswers = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) =>
    z
      .object({
        kitId: z.string().uuid(),
        answers: z.array(z.object({ question_id: z.string(), answer: z.string() })).default([]),
        notes: z.string().optional().nullable(),
        audio: z
          .object({
            filename: z.string(),
            contentType: z.string(),
            base64: z.string().min(20),
          })
          .optional()
          .nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const [kit] = await db
      .select()
      .from(screeningKits)
      .where(and(eq(screeningKits.id, data.kitId), eq(screeningKits.orgId, context.orgId)))
      .limit(1);
    if (!kit) throw new Error("Screening kit not found");

    const questions = (Array.isArray(kit.questions) ? kit.questions : []) as ScreeningQuestion[];
    if (!questions.length) throw new Error("This kit has no questions to grade against.");

    const { candidate, requisition, jdText, match } = await loadPairing(
      context.orgId,
      kit.candidateId,
      kit.requisitionId,
    );

    // Audio, when supplied, is stored first and transcribed with the org's provider.
    let transcript = data.notes?.trim() ? data.notes.trim() : null;
    let audioPath: string | null = null;
    let audioEngine: string | null = null;
    let inputKind = data.audio ? "audio" : transcript ? "notes" : "typed";
    if (data.audio) {
      const bytes = Uint8Array.from(Buffer.from(data.audio.base64, "base64"));
      if (!bytes.byteLength) throw new Error("The recording was empty.");
      if (bytes.byteLength > 25 * 1024 * 1024) {
        throw new Error("The recording is too large (25 MB maximum).");
      }
      const safe =
        data.audio.filename.replace(/[^\w.\- ]+/g, "_").slice(0, 120) || "screening.webm";
      // The vault key is derived from the verified caller org — never from a fetched row.
      audioPath = `${context.orgId}/${kit.candidateId}/${Date.now()}-${safe}`;
      await putObject(audioPath, bytes, data.audio.contentType || "audio/webm");
      const heard = await transcribeScreeningAudio({
        orgId: context.orgId,
        bytes,
        filename: data.audio.filename,
        contentType: data.audio.contentType,
      });
      transcript = [transcript, heard.transcript].filter(Boolean).join("\n\n");
      audioEngine = heard.engine;
    }

    const typed = data.answers.filter((a) => a.answer.trim().length > 0);
    if (!typed.length && !transcript) {
      throw new Error("Add the candidate's answers, call notes, or a recording first.");
    }
    if (typed.length && !data.audio && !data.notes) inputKind = "typed";

    const grade = await gradeScreening({
      orgId: context.orgId,
      role: requisition?.title ?? "the role",
      jdText,
      mustHave: requisition?.mustHaveSkills ?? [],
      candidateName: candidate.fullName,
      questions,
      answers: typed,
      transcript,
    });

    const matchScore =
      typeof match?.overallScore === "number" ? Math.round(match.overallScore) : null;
    const combined =
      matchScore === null
        ? grade.screening_score
        : Math.round(matchScore * 0.6 + grade.screening_score * 0.4);

    const [run] = await db
      .insert(screeningRuns)
      .values({
        orgId: context.orgId,
        kitId: kit.id,
        candidateId: kit.candidateId,
        requisitionId: kit.requisitionId,
        applicationId: kit.applicationId,
        inputKind,
        answers: typed as never,
        transcript,
        audioPath,
        audioEngine,
        screeningScore: grade.screening_score,
        matchScore,
        combinedScore: combined,
        verdicts: grade.verdicts as never,
        redFlags: grade.red_flags,
        rationale: grade.rationale,
        recommendation: grade.recommendation,
        recommendationReason: grade.recommendation_reason,
        engine: grade.engine as never,
        createdBy: context.userId,
      })
      .returning({ id: screeningRuns.id });
    if (!run) throw new Error("Could not save the screening run");

    return {
      runId: run.id,
      ...grade,
      match_score: matchScore,
      combined_score: combined,
      audio_stored: Boolean(audioPath),
      audio_engine: audioEngine,
    };
  });

/* ------------------------------------------------- recording delivery */

/**
 * Authenticated recording delivery. The bytes travel through ATSIQ from the
 * private vault after the caller's org is verified — no signed storage URLs.
 */
export const getScreeningAudioUrl = createServerFn({ method: "POST" })
  .middleware([requireOrg])
  .inputValidator((data: unknown) => z.object({ runId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const [run] = await db
      .select({ audioPath: screeningRuns.audioPath })
      .from(screeningRuns)
      .where(and(eq(screeningRuns.id, data.runId), eq(screeningRuns.orgId, context.orgId)))
      .limit(1);
    if (!run?.audioPath) throw new Error("No recording was stored for this screening.");
    // Defence in depth: the vault key must live inside this org's folder.
    if (!run.audioPath.startsWith(`${context.orgId}/`)) {
      throw new Error("That recording could not be opened.");
    }
    const file = await getObject(run.audioPath);
    if (!file) throw new Error("That recording could not be opened.");
    if (file.bytes.byteLength > 25 * 1024 * 1024) {
      throw new Error("That recording is too large to open through ATSIQ.");
    }
    const contentType = file.contentType.startsWith("audio/") ? file.contentType : "audio/webm";
    return {
      dataUrl: `data:${contentType};base64,${Buffer.from(file.bytes).toString("base64")}`,
    };
  });
