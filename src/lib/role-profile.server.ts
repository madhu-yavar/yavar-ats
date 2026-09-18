/**
 * Role profile drafting.
 *
 * Given a role title (plus whatever context the requisition already has), asks
 * the configured model for the must-have / good-to-have skills, acceptable
 * qualifications and key responsibilities. Everything it returns is a draft the
 * recruiter can edit before saving.
 */

import { aiJson } from "./ai-gateway.server";

export type RoleProfile = {
  must_have_skills: string[];
  good_to_have_skills: string[];
  qualifications: string[];
  responsibilities: string;
  engine: { provider: string; model: string };
};

const clean = (v: unknown, max: number) =>
  (Array.isArray(v) ? v : [])
    .map((s) => String(s ?? "").trim())
    .filter((s) => s.length > 1 && s.length < 60)
    .filter((s, i, a) => a.findIndex((o) => o.toLowerCase() === s.toLowerCase()) === i)
    .slice(0, max);

export async function draftRoleProfile(input: {
  /** Org context for AI credential resolution. */
  orgId: string;
  role: string;
  department?: string | null | undefined;
  location?: string | undefined;
  experienceMin: number;
  experienceMax: number;
  industry?: string | null | undefined;
}): Promise<RoleProfile> {
  const result = await aiJson<RoleProfile>({
    orgId: input.orgId,
    system:
      "You are a senior talent-acquisition partner writing a hiring specification. For the given role title and " +
      "experience range, list the skills and qualifications a strong candidate must have. Use the exact, " +
      "industry-standard names for tools, languages and frameworks (e.g. 'PostgreSQL', not 'databases'). " +
      "must_have_skills: 6-10 non-negotiables. good_to_have_skills: 4-8 differentiators, no overlap with " +
      "must-haves. qualifications: 2-5 acceptable degrees or certifications, each written as a full " +
      "qualification name (e.g. 'B.E. / B.Tech in Computer Science'). responsibilities: 4-6 short lines, " +
      "one per line, starting with a verb, sized for the stated experience range. " +
      "Return ONLY JSON with keys: must_have_skills, good_to_have_skills, qualifications, responsibilities.",
    prompt: JSON.stringify({
      role: input.role,
      department: input.department ?? null,
      location: input.location ?? "",
      experience_range_years: [input.experienceMin, input.experienceMax],
      industry: input.industry ?? null,
    }),
  });

  if (!result.ok) throw new Error(result.message);

  return {
    must_have_skills: clean(result.data.must_have_skills, 10),
    good_to_have_skills: clean(result.data.good_to_have_skills, 8),
    qualifications: clean(result.data.qualifications, 5),
    responsibilities: String(result.data.responsibilities ?? "")
      .trim()
      .slice(0, 2000),
    engine: { provider: result.provider, model: result.model },
  };
}
