import { aiJson } from "./ai-gateway.server";
import {
  blendSocial,
  fetchGithubSignal,
  fetchLinkedinSignal,
  fetchWritingSignal,
  type SocialSignal,
} from "./social.server";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));


export type JdInputShape = {
  title: string;
  mustHave: string[];
  goodToHave: string[];
  responsibilities?: string | null | undefined;
  education?: string | null | undefined;
  experienceMin: number;
  experienceMax: number;
  jdText?: string | null | undefined;
};

export type CandidateInputShape = {
  name: string;
  skills: string[];
  experienceYears: number;
  education?: string | null | undefined;
  resumeText?: string | null | undefined;
  linkedinUrl?: string | null | undefined;
  githubUrl?: string | null | undefined;
  websiteUrl?: string | null | undefined;
  xUrl?: string | null | undefined;
  linkedinProfileText?: string | null | undefined;
  /** Previously fetched social signals — reused instead of re-fetching. */
  cachedSocial?: SocialSignal[] | null | undefined;
};

export type Weights = { skills: number; experience: number; education: number; social: number };

export type MatchResult = {
  skills_score: number;
  experience_score: number;
  education_score: number;
  social_score: number;
  overall_score: number;
  weights: Weights;
  matched_skills: string[];
  missing_skills: string[];
  transferable_skills: string[];
  rationale: string;
  risk_flags: string[];
  recommendation: "select" | "reject" | "hold";
  social: { blended: number; basis: string; signals: SocialSignal[]; cached: boolean };
  contributions: { label: string; raw: number; weight: number; weighted: number }[];
  model: string;
};

/**
 * Harvest public profile links straight out of the raw CV text.
 * Recruiter-entered fields always win; this only fills the blanks so a resume
 * that merely *mentions* github.com/foo still gets crawled and scored.
 */
export function harvestProfileLinks(resumeText: string | null | undefined) {
  const text = resumeText ?? "";
  const pick = (re: RegExp) => {
    const m = text.match(re);
    return m ? `https://${m[0].replace(/^https?:\/\//i, "").replace(/[).,;]+$/, "")}` : null;
  };
  return {
    githubUrl: pick(/(?:https?:\/\/)?(?:www\.)?github\.com\/[A-Za-z0-9-_.]+/i),
    linkedinUrl: pick(/(?:https?:\/\/)?(?:www\.)?linkedin\.com\/in\/[A-Za-z0-9-_%]+/i),
    xUrl: pick(/(?:https?:\/\/)?(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9-_]+/i),
    websiteUrl: pick(
      /(?:https?:\/\/)?(?:www\.)?[A-Za-z0-9-]+\.(?:dev|io|me|blog|substack\.com|medium\.com)(?:\/[A-Za-z0-9-_/.]*)?/i,
    ),
  };
}

/** Deterministic experience band score — auditable, never AI-guessed. */
export function experienceScore(years: number, min: number, max: number) {
  if (years >= min && years <= max) return 100;
  if (years < min) return clamp(100 - (min - years) * 22);
  return clamp(100 - (years - max) * 10);
}


/**
 * Score one CV against one JD. Shared by the single-candidate server fn and the
 * bulk pipeline run so both produce byte-identical, auditable numbers.
 */
export async function scoreCandidate(opts: {
  jd: JdInputShape;
  candidate: CandidateInputShape;
  weights: Weights;
  includeSocial: boolean;
}): Promise<MatchResult> {
  const { jd, candidate, weights } = opts;

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
    prompt: JSON.stringify({
      job_description: jd,
      candidate: { ...candidate, cachedSocial: undefined },
    }),
  });
  if (!ai.ok) throw new Error(ai.message);

  /* 2 — Social profiling: reuse cached signals when the recruiter has them. */
  const harvested = harvestProfileLinks(candidate.resumeText);
  const links = {
    githubUrl: candidate.githubUrl || harvested.githubUrl,
    linkedinUrl: candidate.linkedinUrl || harvested.linkedinUrl,
    websiteUrl: candidate.websiteUrl || harvested.websiteUrl,
    xUrl: candidate.xUrl || harvested.xUrl,
  };
  const discovered = (Object.keys(links) as (keyof typeof links)[])
    .filter((k) => !candidate[k] && links[k])
    .map((k) => `${k.replace("Url", "")}: ${links[k]}`);

  let signals: SocialSignal[] = [];
  let cached = false;
  if (opts.includeSocial) {
    if (candidate.cachedSocial?.length) {
      signals = candidate.cachedSocial;
      cached = true;
    } else {
      const jdSkills = [...jd.mustHave, ...jd.goodToHave];
      const settled = await Promise.all([
        fetchGithubSignal(links.githubUrl ?? null, jdSkills),
        fetchLinkedinSignal({
          url: links.linkedinUrl ?? null,
          jobTitle: jd.title,
          jdSkills,
          resumeText: candidate.resumeText ?? null,
          profileText: candidate.linkedinProfileText ?? null,
        }),
        fetchWritingSignal({
          urls: [links.websiteUrl ?? "", links.xUrl ?? ""].filter(Boolean),
          jobTitle: jd.title,
          jdSkills,
        }),
      ]);
      signals = settled.filter((s): s is SocialSignal => s !== null);
    }
  }

  const social = blendSocial(signals);

  /* 3 — Deterministic weighted roll-up. */
  const skills = clamp(ai.data.skills_score);
  const education = clamp(ai.data.education_score);
  const experience = experienceScore(candidate.experienceYears, jd.experienceMin, jd.experienceMax);

  const parts = [
    { label: "Skills", raw: skills, weight: weights.skills },
    { label: "Experience", raw: experience, weight: weights.experience },
    { label: "Education", raw: education, weight: weights.education },
    { label: "Social profile", raw: social.score, weight: weights.social },
  ];
  const totalWeight = parts.reduce((s, p) => s + p.weight, 0) || 100;
  const contributions = parts.map((p) => ({ ...p, weighted: Math.round((p.raw * p.weight) / totalWeight) }));
  const overall = clamp(contributions.reduce((s, p) => s + p.weighted, 0));

  const riskFlags = [...(ai.data.risk_flags ?? [])];
  if (candidate.experienceYears < jd.experienceMin) riskFlags.push("Below requisition experience band");
  if (opts.includeSocial && !signals.some((s) => s.status === "ok"))
    riskFlags.push("No verifiable public profile signal — social score defaulted to 0");

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
    recommendation: overall >= 75 ? "select" : overall >= 60 ? "hold" : "reject",
    social: {
      blended: social.score,
      basis:
        discovered.length > 0
          ? `${social.basis} · auto-discovered from CV → ${discovered.join(", ")}`
          : social.basis,
      signals,
      cached,
    },
    contributions,
  };
}

/** Run an async mapper over a list with a hard concurrency ceiling. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
