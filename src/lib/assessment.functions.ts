import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { generateQuestions, scoreAnswers, type AssessmentQuestion } from "./assessment.server";

/* ------------------------------------------------------------ recruiter side */

const CreateInput = z.object({
  candidateId: z.string().uuid(),
  requisitionId: z.string().uuid().optional().nullable(),
  count: z.number().min(4).max(10).default(6),
});

/** Build a role-specific questionnaire and issue a private candidate link. */
export const createAssessment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: candidate, error: cErr } = await context.supabase
      .from("candidates")
      .select("id, full_name, current_title, skills")
      .eq("id", data.candidateId)
      .maybeSingle();
    if (cErr) throw new Error(cErr.message);
    if (!candidate) throw new Error("Candidate not found");

    let title = candidate.current_title ?? "the role";
    let mustHave: string[] = candidate.skills ?? [];
    let responsibilities: string | null = null;

    if (data.requisitionId) {
      const { data: req } = await context.supabase
        .from("requisitions")
        .select("title, must_have_skills, responsibilities")
        .eq("id", data.requisitionId)
        .maybeSingle();
      if (req) {
        title = req.title;
        mustHave = req.must_have_skills ?? mustHave;
        responsibilities = req.responsibilities ?? null;
      }
    }

    const questions = await generateQuestions({ title, mustHave, responsibilities, count: data.count });
    const token = crypto.randomUUID().replace(/-/g, "");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("candidate_assessments")
      .insert({
        candidate_id: candidate.id,
        requisition_id: data.requisitionId ?? null,
        token,
        status: "sent",
        questions: questions as never,
      })
      .select("id, token")
      .single();
    if (error) throw new Error(error.message);

    return { id: row.id, token: row.token, questions };
  });

/* ------------------------------------------------------------ candidate side */

const TokenInput = z.object({ token: z.string().min(16) });

/** Public: load the questionnaire behind a private token (no answers exposed). */
export const getAssessment = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => TokenInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("candidate_assessments")
      .select("id, status, questions, candidate_id")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This assessment link is not valid");

    const { data: candidate } = await supabaseAdmin
      .from("candidates")
      .select("full_name")
      .eq("id", row.candidate_id)
      .maybeSingle();

    const questions = (row.questions as unknown as AssessmentQuestion[]) ?? [];
    return {
      status: row.status,
      candidateName: candidate?.full_name ?? "",
      // 'looks_like' is the recruiter's rubric — never send it to the candidate.
      questions: questions.map((q) => ({ id: q.id, dimension: q.dimension, prompt: q.prompt })),
    };
  });

const SubmitInput = z.object({
  token: z.string().min(16),
  answers: z.array(z.object({ id: z.string(), answer: z.string().max(4000) })).min(1),
});

/** Public: submit answers once, score them, and lock the assessment. */
export const submitAssessment = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SubmitInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: row, error } = await supabaseAdmin
      .from("candidate_assessments")
      .select("id, status, questions, requisition_id")
      .eq("token", data.token)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("This assessment link is not valid");
    if (row.status === "completed") throw new Error("This assessment has already been submitted");

    const questions = (row.questions as unknown as AssessmentQuestion[]) ?? [];
    let title = "the role";
    if (row.requisition_id) {
      const { data: req } = await supabaseAdmin
        .from("requisitions")
        .select("title")
        .eq("id", row.requisition_id)
        .maybeSingle();
      if (req) title = req.title;
    }

    const result = await scoreAnswers({ title, questions, answers: data.answers });

    const { error: upErr } = await supabaseAdmin
      .from("candidate_assessments")
      .update({
        status: "completed",
        answers: data.answers as never,
        mindset_score: result.mindset_score,
        dimensions: result.dimensions as never,
        strengths: result.strengths,
        red_flags: result.red_flags,
        summary: result.summary,
        model: result.model,
        completed_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    if (upErr) throw new Error(upErr.message);

    return { ok: true as const };
  });
