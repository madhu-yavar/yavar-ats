/**
 * Mindset & ways-of-working assessment.
 *
 * Mindset is deliberately NOT inferred from a CV or a social profile — that
 * would be guesswork dressed up as a score. Instead the candidate answers
 * situational questions written for the specific role, and the model scores the
 * *answers* against named behavioural dimensions, quoting the answer text.
 */
import { aiJson } from "./ai-gateway.server";

export type AssessmentQuestion = {
  id: string;
  dimension: string;
  prompt: string;
  /** What a strong answer looks like — shown to the recruiter, not the candidate. */
  looks_like: string;
};

export type MindsetDimension = { dimension: string; score: number; evidence: string };

export type MindsetResult = {
  mindset_score: number;
  dimensions: MindsetDimension[];
  strengths: string[];
  red_flags: string[];
  summary: string;
  model: string;
};

export const MINDSET_DIMENSIONS = [
  "Ownership & accountability",
  "Innovation & first-principles thinking",
  "Learning agility",
  "Collaboration & conflict handling",
  "Resilience under ambiguity",
  "Customer / outcome orientation",
] as const;

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

export async function generateQuestions(opts: {
  title: string;
  mustHave: string[];
  responsibilities?: string | null;
  seniority?: string | null;
  count?: number;
}) {
  const count = Math.max(4, Math.min(10, opts.count ?? 6));
  const ai = await aiJson<{ questions: AssessmentQuestion[] }>({
    system:
      `You design a short situational-judgement questionnaire for one specific role. Write exactly ${count} ` +
      "open questions, each targeting ONE of these dimensions: " +
      MINDSET_DIMENSIONS.join("; ") +
      ". Each question must describe a concrete situation this person would actually face in this role and ask " +
      "what they did or would do — never abstract personality questions, never anything that probes protected " +
      "characteristics, health, family, religion, politics or age. Keep each question under 45 words. " +
      "'looks_like' describes, for the recruiter, what a strong answer contains. " +
      "Return ONLY JSON: { questions: [{ id, dimension, prompt, looks_like }] } with id as q1..qN.",
    prompt: JSON.stringify(opts),
  });
  if (!ai.ok) throw new Error(ai.message);
  return (ai.data.questions ?? []).slice(0, count).map((q, i) => ({
    id: q.id || `q${i + 1}`,
    dimension: q.dimension || MINDSET_DIMENSIONS[i % MINDSET_DIMENSIONS.length]!,
    prompt: q.prompt,
    looks_like: q.looks_like ?? "",
  }));
}

export async function scoreAnswers(opts: {
  title: string;
  questions: AssessmentQuestion[];
  answers: { id: string; answer: string }[];
}): Promise<MindsetResult> {
  const ai = await aiJson<Omit<MindsetResult, "model">>({
    system:
      "You are an assessment psychologist scoring written situational answers for a hiring team. Score ONLY " +
      "what the candidate wrote. Reward specific lived examples with a decision, an action and an outcome; " +
      "penalise generic textbook answers, blame-shifting and answers that dodge the situation. A very short or " +
      "empty answer scores low for that dimension and must be called out as 'not enough evidence', not as a " +
      "character judgement. Quote the candidate's own words as evidence. Never infer anything about age, " +
      "gender, health, family, nationality, religion or politics. " +
      "Return ONLY JSON with keys: mindset_score (0-100, the weighted whole-person view), dimensions " +
      "(array of {dimension, score 0-100, evidence}), strengths (2-4 short strings), red_flags (0-4 short " +
      "strings), summary (3-4 sentences a recruiter can paste into a debrief).",
    prompt: JSON.stringify(opts),
  });
  if (!ai.ok) throw new Error(ai.message);
  return {
    mindset_score: clamp(ai.data.mindset_score),
    dimensions: (ai.data.dimensions ?? []).map((d) => ({
      dimension: d.dimension,
      score: clamp(d.score),
      evidence: d.evidence ?? "",
    })),
    strengths: ai.data.strengths ?? [],
    red_flags: ai.data.red_flags ?? [],
    summary: ai.data.summary ?? "",
    model: ai.model,
  };
}
