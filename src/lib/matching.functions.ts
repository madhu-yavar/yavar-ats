import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { aiJson } from "./ai-gateway.server";
import {
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

/* ------------------------------------------------- Existing JD import */

const JdImportInput = z.object({
  jdText: z.string().min(30),
  title: z.string().optional().nullable(),
});

/**
 * Structure a recruiter's existing JD (pasted or extracted from PDF/DOCX) into the
 * same shape as an AI-drafted JD so scoring, must-have coverage and audit stay identical.
 */
export const importJd = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => JdImportInput.parse(data))
  .handler(async ({ data }) => {
    const result = await aiJson<
      GeneratedJd & { experience_min: number; experience_max: number; detected_title: string }
    >({
      system:
        "You are parsing an EXISTING job description supplied by a recruiter. Extract, never invent. " +
        "Keep the original wording where possible; only normalise structure. " +
        "Return ONLY JSON with keys: detected_title, purpose, responsibilities (markdown bullets), " +
        "must_have (string array of concrete skills), good_to_have (string array), qualifications, " +
        "success_factors, reporting_to, experience_min (number, 0 if absent), experience_max (number, 0 if absent), " +
        "full_text (the JD cleaned up as markdown).",
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
    cachedSocial: z.array(z.any()).optional().nullable(),
  }),
  weights: z.object({
    skills: z.number(),
    experience: z.number(),
    education: z.number(),
    social: z.number(),
  }),
  includeSocial: z.boolean().default(true),
});

export const matchJdToCv = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => MatchInput.parse(data))
  .handler(async ({ data }): Promise<MatchResult> =>
    scoreCandidate({
      jd: data.jd,
      candidate: data.candidate as never,
      weights: data.weights,
      includeSocial: data.includeSocial,
    }),
  );

/* ------------------------------------------- one JD vs many CVs (bulk run) */

const PipelineInput = z.object({
  jd: MatchInput.shape.jd,
  weights: MatchInput.shape.weights,
  includeSocial: z.boolean().default(true),
  /** Hard ceiling on parallel AI + provider calls so we never trip rate limits. */
  concurrency: z.number().min(1).max(6).default(3),
  rows: z
    .array(
      z.object({
        applicationId: z.string(),
        candidate: MatchInput.shape.candidate,
      }),
    )
    .min(1)
    .max(200),
});

export type PipelineRowResult =
  | { applicationId: string; ok: true; result: MatchResult }
  | { applicationId: string; ok: false; message: string };

/**
 * Score one JD against many CVs in a single call: bounded concurrency, cached
 * social signals reused per candidate, and per-row failures isolated so one bad
 * resume never kills the whole run.
 */
export const matchPipeline = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => PipelineInput.parse(data))
  .handler(async ({ data }): Promise<PipelineRowResult[]> =>
    mapWithConcurrency(data.rows, data.concurrency, async (row) => {
      try {
        const result = await scoreCandidate({
          jd: data.jd,
          candidate: row.candidate as never,
          weights: data.weights,
          includeSocial: data.includeSocial,
        });
        return { applicationId: row.applicationId, ok: true as const, result };
      } catch (e) {
        return {
          applicationId: row.applicationId,
          ok: false as const,
          message: e instanceof Error ? e.message : "Scoring failed",
        };
      }
    }),
  );


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
    });
    if (!result.ok) throw new Error(result.message);
    return result.data;
  });
