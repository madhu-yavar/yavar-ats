import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { aiJson } from "./ai-gateway.server";
import {
  MATCH_MODEL,
  mapWithConcurrency,
  scoreCandidate,
  type MatchResult,
} from "./matching.server";
import { type SocialSignal } from "./social.server";

export type { MatchResult } from "./matching.server";


/* ------------------------------------------------------------------ JD gen */

const JdInput = z.object({
  title: z.string().min(1),
  department: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  experienceMin: z.number(),
  experienceMax: z.number(),
  mustHave: z.array(z.string()),
  goodToHave: z.array(z.string()),
  responsibilities: z.string().optional().nullable(),
  education: z.string().optional().nullable(),
  reportingTo: z.string().optional().nullable(),
});

export type GeneratedJd = {
  purpose: string;
  responsibilities: string;
  must_have: string[];
  good_to_have: string[];
  qualifications: string;
  success_factors: string;
  reporting_to: string;
  full_text: string;
};

export const generateJd = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => JdInput.parse(data))
  .handler(async ({ data }) => {
    const result = await aiJson<GeneratedJd>({
      system:
        "You are an expert talent-acquisition writer. Draft a complete, specific job description. " +
        "Return ONLY JSON with keys: purpose (2 sentences), responsibilities (markdown bullet list), " +
        "must_have (string array), good_to_have (string array), qualifications, success_factors, " +
        "reporting_to, full_text (the full JD as markdown). No fluff, no buzzwords, no emojis.",
      prompt: JSON.stringify(data),
    });
    if (!result.ok) throw new Error(result.message);
    return result.data;
  });

/* -------------------------------------------------------------- JD vs CV */

const MatchInput = z.object({
  jd: z.object({
    title: z.string(),
    mustHave: z.array(z.string()),
    goodToHave: z.array(z.string()),
    responsibilities: z.string().optional().nullable(),
    education: z.string().optional().nullable(),
    experienceMin: z.number(),
    experienceMax: z.number(),
    jdText: z.string().optional().nullable(),
  }),
  candidate: z.object({
    name: z.string(),
    skills: z.array(z.string()),
    experienceYears: z.number(),
    education: z.string().optional().nullable(),
    resumeText: z.string().optional().nullable(),
    linkedinUrl: z.string().optional().nullable(),
    githubUrl: z.string().optional().nullable(),
    websiteUrl: z.string().optional().nullable(),
    xUrl: z.string().optional().nullable(),
    linkedinProfileText: z.string().optional().nullable(),
  }),
  weights: z.object({
    skills: z.number(),
    experience: z.number(),
    education: z.number(),
    social: z.number(),
  }),
  includeSocial: z.boolean().default(true),
});

export type MatchResult = {
  skills_score: number;
  experience_score: number;
  education_score: number;
  social_score: number;
  overall_score: number;
  weights: { skills: number; experience: number; education: number; social: number };
  matched_skills: string[];
  missing_skills: string[];
  transferable_skills: string[];
  rationale: string;
  risk_flags: string[];
  recommendation: "select" | "reject" | "hold";
  social: { blended: number; basis: string; signals: SocialSignal[] };
  contributions: { label: string; raw: number; weight: number; weighted: number }[];
  model: string;
};

const MODEL = "google/gemini-3.7-flash";

/** Deterministic experience band score — auditable, never AI-guessed. */
function experienceScore(years: number, min: number, max: number) {
  if (years >= min && years <= max) return 100;
  if (years < min) {
    const gap = min - years;
    return clamp(100 - gap * 22);
  }
  const over = years - max;
  return clamp(100 - over * 10);
}

export const matchJdToCv = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => MatchInput.parse(data))
  .handler(async ({ data }): Promise<MatchResult> => {
    const { jd, candidate, weights } = data;

    /* 1 — AI semantic assessment of skills + education (with evidence). */
    const ai = await aiJson<{
      skills_score: number;
      education_score: number;
      matched_skills: string[];
      missing_skills: string[];
      transferable_skills: string[];
      risk_flags: string[];
      rationale: string;
    }>({
      system:
        "You are a rigorous technical recruiter mapping a CV against a job description. " +
        "Judge semantic equivalence (e.g. 'EKS' evidences 'Kubernetes'), require evidence from the resume text, " +
        "and never credit a must-have skill that is only listed but never demonstrated — flag that instead. " +
        "skills_score weights must-have coverage far above good-to-have. " +
        "education_score reflects fit against the stated qualification requirement (return 70 if no requirement is stated). " +
        "Return ONLY JSON with keys: skills_score (0-100), education_score (0-100), matched_skills, missing_skills, " +
        "transferable_skills, risk_flags (short strings), rationale (3-4 sentences, cite evidence).",
      prompt: JSON.stringify({ job_description: jd, candidate }),
      model: MODEL,
    });
    if (!ai.ok) throw new Error(ai.message);

    /* 2 — Social profiling, fetched live. */
    let signals: SocialSignal[] = [];
    if (data.includeSocial) {
      const jdSkills = [...jd.mustHave, ...jd.goodToHave];
      const settled = await Promise.all([
        fetchGithubSignal(candidate.githubUrl ?? null, jdSkills),
        fetchLinkedinSignal({
          url: candidate.linkedinUrl ?? null,
          jobTitle: jd.title,
          jdSkills,
          resumeText: candidate.resumeText ?? null,
          profileText: candidate.linkedinProfileText ?? null,
        }),
        fetchWritingSignal({
          urls: [candidate.websiteUrl ?? "", candidate.xUrl ?? ""].filter(Boolean),
          jobTitle: jd.title,
          jdSkills,
        }),
      ]);
      signals = settled.filter((s): s is SocialSignal => s !== null);
    }
    const social = blendSocial(signals);

    /* 3 — Deterministic weighted roll-up. */
    const skills = clamp(ai.data.skills_score);
    const education = clamp(ai.data.education_score);
    const experience = experienceScore(
      candidate.experienceYears,
      jd.experienceMin,
      jd.experienceMax,
    );

    const parts = [
      { label: "Skills", raw: skills, weight: weights.skills },
      { label: "Experience", raw: experience, weight: weights.experience },
      { label: "Education", raw: education, weight: weights.education },
      { label: "Social profile", raw: social.score, weight: weights.social },
    ];
    const totalWeight = parts.reduce((s, p) => s + p.weight, 0) || 100;
    const contributions = parts.map((p) => ({
      ...p,
      weighted: Math.round((p.raw * p.weight) / totalWeight),
    }));
    const overall = clamp(contributions.reduce((s, p) => s + p.weighted, 0));

    const riskFlags = [...(ai.data.risk_flags ?? [])];
    if (candidate.experienceYears < jd.experienceMin) riskFlags.push("Below requisition experience band");
    if (!signals.some((s) => s.status === "ok"))
      riskFlags.push("No verifiable public profile signal — social score defaulted to 0");

    const recommendation: MatchResult["recommendation"] =
      overall >= 75 ? "select" : overall >= 60 ? "hold" : "reject";

    return {
      skills_score: skills,
      experience_score: experience,
      education_score: education,
      social_score: social.score,
      overall_score: overall,
      weights,
      matched_skills: ai.data.matched_skills ?? [],
      missing_skills: ai.data.missing_skills ?? [],
      transferable_skills: ai.data.transferable_skills ?? [],
      rationale: ai.data.rationale,
      risk_flags: riskFlags,
      recommendation,
      social: { blended: social.score, basis: social.basis, signals },
      contributions,
      model: MODEL,
    };
  });

/* --------------------------------------------------- resume text parsing */

const ParseInput = z.object({ resumeText: z.string().min(20) });

export const parseResume = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => ParseInput.parse(data))
  .handler(async ({ data }) => {
    const result = await aiJson<{
      full_name: string;
      email: string;
      phone: string | null;
      location: string | null;
      experience_years: number;
      education: string | null;
      skills: string[];
      linkedin_url: string | null;
      github_url: string | null;
      website_url: string | null;
    }>({
      system:
        "Extract structured candidate data from a resume. Return ONLY JSON with keys: full_name, email, phone, " +
        "location, experience_years (number), education, skills (string array), linkedin_url, github_url, website_url. " +
        "Use null when a field is genuinely absent. Never invent values.",
      prompt: data.resumeText.slice(0, 20000),
      model: MODEL,
    });
    if (!result.ok) throw new Error(result.message);
    return result.data;
  });

/* ---------------------------------------------- AI screening interview */

const AiInterviewInput = z.object({
  jobTitle: z.string(),
  jdText: z.string(),
  candidateName: z.string(),
  resumeText: z.string().optional().nullable(),
  matchRationale: z.string().optional().nullable(),
});

export const runAiScreening = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => AiInterviewInput.parse(data))
  .handler(async ({ data }) => {
    const result = await aiJson<{
      jd_match_score: number;
      skillset_score: number;
      culture_role_score: number;
      culture_org_score: number;
      summary: string;
      transcript: { question: string; expected_signal: string }[];
    }>({
      system:
        "You design and evaluate an AI first-round screening interview. Produce 6 role-specific questions with the " +
        "signal each one probes, and score the candidate on jd_match_score, skillset_score, culture_role_score and " +
        "culture_org_score (0-100 each) based on the evidence supplied. Return ONLY JSON with keys: jd_match_score, " +
        "skillset_score, culture_role_score, culture_org_score, summary, transcript (array of {question, expected_signal}).",
      prompt: JSON.stringify(data),
      model: MODEL,
    });
    if (!result.ok) throw new Error(result.message);
    return result.data;
  });
