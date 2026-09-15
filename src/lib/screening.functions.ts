import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildScreeningKit,
  gradeScreening,
  storeScreeningAudio,
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

/** Pull JD, requisition, candidate and the latest match for one pairing. */
async function loadPairing(
  supabase: Parameters<typeof loadPairingImpl>[0],
  candidateId: string,
  requisitionId: string | null,
) {
  return loadPairingImpl(supabase, candidateId, requisitionId);
}

type Sb = { from: (t: string) => any };

async function loadPairingImpl(supabase: Sb, candidateId: string, requisitionId: string | null) {
  const { data: candidate, error: cErr } = await supabase
    .from("candidates")
    .select(
      "id, org_id, full_name, skills, resume_text, experience_years, current_employer, employment_history, education, current_ctc, expected_ctc, notice_period_days, location",
    )
    .eq("id", candidateId)
    .maybeSingle();
  if (cErr) throw new Error(cErr.message);
  if (!candidate) throw new Error("Candidate not found");

  let requisition: any = null;
  if (requisitionId) {
    const { data } = await supabase
      .from("requisitions")
      .select(
        "id, title, must_have_skills, good_to_have_skills, responsibilities, education_requirement, experience_min, experience_max, budget_ctc, location",
      )
      .eq("id", requisitionId)
      .maybeSingle();
    requisition = data ?? null;
  }

  let application: any = null;
  if (requisitionId) {
    const { data } = await supabase
      .from("applications")
      .select("id")
      .eq("candidate_id", candidateId)
      .eq("requisition_id", requisitionId)
      .order("applied_at", { ascending: true })
      .limit(1);
    application = data?.[0] ?? null;
  }

  let jdText = "";
  if (requisitionId) {
    const { data: jd } = await supabase
      .from("job_descriptions")
      .select("full_text, purpose, responsibilities, qualifications")
      .eq("requisition_id", requisitionId)
      .order("version", { ascending: false })
      .limit(1);
    const row = jd?.[0];
    jdText =
      row?.full_text ??
      [row?.purpose, row?.responsibilities, row?.qualifications].filter(Boolean).join("\n\n") ??
      "";
  }
  if (!jdText && requisition) {
    jdText = [
      `Role: ${requisition.title}`,
      requisition.responsibilities ?? "",
      `Must-have: ${(requisition.must_have_skills ?? []).join(", ")}`,
      `Good to have: ${(requisition.good_to_have_skills ?? []).join(", ")}`,
      requisition.education_requirement ? `Qualification: ${requisition.education_requirement}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }

  let match: any = null;
  if (application) {
    const { data } = await supabase
      .from("match_scores")
      .select("overall_score, rationale, missing_skills, risk_flags")
      .eq("application_id", application.id)
      .order("computed_at", { ascending: false })
      .limit(1);
    match = data?.[0] ?? null;
  }

  return { candidate, requisition, application, jdText, match };
}

/* --------------------------------------------------------------- build kit */

export const createScreeningKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
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
      context.supabase as never,
      data.candidateId,
      data.requisitionId ?? null,
    );
    if (!requisition) throw new Error("Pick the role this screening call is for.");
    if (!jdText.trim()) throw new Error("This role has no job description text yet.");

    const kit = await buildScreeningKit({
      role: requisition.title,
      jdText,
      mustHave: requisition.must_have_skills ?? [],
      goodToHave: requisition.good_to_have_skills ?? [],
      experienceMin: requisition.experience_min ?? 0,
      experienceMax: requisition.experience_max ?? 0,
      budgetCtc: requisition.budget_ctc ?? null,
      currency: "INR",
      candidateName: candidate.full_name,
      resumeText: candidate.resume_text,
      candidateSkills: candidate.skills ?? [],
      experienceYears: Number(candidate.experience_years) || 0,
      currentEmployer: candidate.current_employer,
      employmentHistory: candidate.employment_history,
      education: candidate.education,
      currentCtc: candidate.current_ctc,
      expectedCtc: candidate.expected_ctc,
      noticePeriodDays: candidate.notice_period_days,
      location: candidate.location,
      matchRationale: match?.rationale ?? null,
      missingSkills: match?.missing_skills ?? [],
      riskFlags: match?.risk_flags ?? [],
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("screening_kits")
      .insert({
        org_id: candidate.org_id,
        candidate_id: candidate.id,
        requisition_id: requisition.id,
        application_id: application?.id ?? null,
        questions: kit.questions as never,
        focus_summary: kit.focus_summary,
        engine: kit.engine as never,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return { kitId: row.id, ...kit };
  });

/* ------------------------------------------------------------- edit a kit */

export const saveScreeningKit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        kitId: z.string().uuid(),
        questions: z.array(QuestionSchema).min(1).max(20),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const { error } = await context.supabase
      .from("screening_kits")
      .update({
        questions: data.questions as never,
        updated_at: new Date().toISOString(),
      })
      .eq("id", data.kitId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/* ---------------------------------------------------------- grade answers */

export const gradeScreeningAnswers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        kitId: z.string().uuid(),
        answers: z
          .array(z.object({ question_id: z.string(), answer: z.string() }))
          .default([]),
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
    const { data: kit, error: kErr } = await context.supabase
      .from("screening_kits")
      .select("id, org_id, candidate_id, requisition_id, application_id, questions")
      .eq("id", data.kitId)
      .maybeSingle();
    if (kErr) throw new Error(kErr.message);
    if (!kit) throw new Error("Screening kit not found");

    const questions = (Array.isArray(kit.questions) ? kit.questions : []) as ScreeningQuestion[];
    if (!questions.length) throw new Error("This kit has no questions to grade against.");

    const { candidate, requisition, jdText, match } = await loadPairing(
      context.supabase as never,
      kit.candidate_id,
      kit.requisition_id,
    );

    // Audio, when supplied, is stored first and transcribed with the org's provider.
    let transcript = data.notes?.trim() ? data.notes.trim() : null;
    let audioPath: string | null = null;
    let audioEngine: string | null = null;
    let inputKind = data.audio ? "audio" : transcript ? "notes" : "typed";
    if (data.audio) {
      const bytes = Uint8Array.from(Buffer.from(data.audio.base64, "base64"));
      if (!bytes.byteLength) throw new Error("The recording was empty.");
      const stored = await storeScreeningAudio({
        orgId: kit.org_id,
        candidateId: kit.candidate_id,
        filename: data.audio.filename,
        bytes,
        contentType: data.audio.contentType,
      });
      audioPath = stored.path;
      const heard = await transcribeScreeningAudio({
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
      role: requisition?.title ?? "the role",
      jdText,
      mustHave: requisition?.must_have_skills ?? [],
      candidateName: candidate.full_name,
      questions,
      answers: typed,
      transcript,
    });

    const matchScore =
      typeof match?.overall_score === "number" ? Math.round(match.overall_score) : null;
    const combined =
      matchScore === null
        ? grade.screening_score
        : Math.round(matchScore * 0.6 + grade.screening_score * 0.4);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: run, error } = await supabaseAdmin
      .from("screening_runs")
      .insert({
        org_id: kit.org_id,
        kit_id: kit.id,
        candidate_id: kit.candidate_id,
        requisition_id: kit.requisition_id,
        application_id: kit.application_id,
        input_kind: inputKind,
        answers: typed as never,
        transcript,
        audio_path: audioPath,
        audio_engine: audioEngine,
        screening_score: grade.screening_score,
        match_score: matchScore,
        combined_score: combined,
        verdicts: grade.verdicts as never,
        red_flags: grade.red_flags,
        rationale: grade.rationale,
        recommendation: grade.recommendation,
        recommendation_reason: grade.recommendation_reason,
        engine: grade.engine as never,
        created_by: context.userId,
      })
      .select("id")
      .single();
    if (error) throw new Error(error.message);

    return {
      runId: run.id,
      ...grade,
      match_score: matchScore,
      combined_score: combined,
      audio_stored: Boolean(audioPath),
      audio_engine: audioEngine,
    };
  });

/* ------------------------------------------------- recording download link */

export const getScreeningAudioUrl = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ runId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: run, error } = await context.supabase
      .from("screening_runs")
      .select("audio_path")
      .eq("id", data.runId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!run?.audio_path) throw new Error("No recording was stored for this screening.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: signed, error: sErr } = await supabaseAdmin.storage
      .from("screening-audio")
      .createSignedUrl(run.audio_path, 120);
    if (sErr || !signed?.signedUrl) throw new Error(sErr?.message ?? "Could not open the recording.");
    return { url: signed.signedUrl };
  });
