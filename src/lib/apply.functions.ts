/**
 * Public job-application intake.
 *
 * The LinkedIn job post carries an ATSIQ apply link. Anyone who taps it lands
 * on /apply/<requisition>, uploads a CV, and the CV is parsed and filed into
 * the talent pool plus this requisition's pipeline automatically — no recruiter
 * download step, no LinkedIn data agreement needed.
 *
 * These functions are intentionally unauthenticated (public applicants), so
 * every handler is narrow: read-only job summary for approved requisitions,
 * and a write path that only ever creates/updates a candidate + application.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { aiJson } from "./ai-gateway.server";

const IdInput = z.object({ requisitionId: z.string().uuid() });

export type PublicJob = {
  id: string;
  title: string;
  location: string | null;
  openings: number;
  experienceMin: number;
  experienceMax: number;
  mustHave: string[];
  goodToHave: string[];
  responsibilities: string | null;
  company: string | null;
  open: boolean;
};

/** Job summary an applicant is allowed to see. Nothing commercial is exposed. */
export const publicJob = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => IdInput.parse(data))
  .handler(async ({ data }): Promise<PublicJob | null> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: r } = await supabaseAdmin
      .from("requisitions")
      .select(
        "id, title, location, openings, experience_min, experience_max, must_have_skills, good_to_have_skills, responsibilities, status, org_id",
      )
      .eq("id", data.requisitionId)
      .maybeSingle();
    if (!r) return null;

    let company: string | null = null;
    if (r.org_id) {
      const { data: org } = await supabaseAdmin
        .from("organizations")
        .select("name")
        .eq("id", r.org_id)
        .maybeSingle();
      company = org?.name ?? null;
    }

    return {
      id: r.id,
      title: r.title,
      location: r.location,
      openings: r.openings,
      experienceMin: r.experience_min,
      experienceMax: r.experience_max,
      mustHave: r.must_have_skills ?? [],
      goodToHave: r.good_to_have_skills ?? [],
      responsibilities: r.responsibilities,
      company,
      open: r.status === "approved" || r.status === "sourcing" || r.status === "interviewing",
    };
  });

const SubmitInput = z.object({
  requisitionId: z.string().uuid(),
  fileName: z.string().max(300),
  resumeText: z.string().min(50).max(60000),
  email: z.string().email().optional().nullable(),
  fullName: z.string().max(200).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  source: z.string().max(60).default("linkedin_post"),
});

/**
 * Parse an applicant's CV and file it against the requisition. Re-applying with
 * the same email enriches the existing talent-pool record instead of creating a
 * second one.
 */
export const submitApplication = createServerFn({ method: "POST" })
  .inputValidator((data: unknown) => SubmitInput.parse(data))
  .handler(async ({ data }) => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: r } = await supabaseAdmin
      .from("requisitions")
      .select("id, status, org_id")
      .eq("id", data.requisitionId)
      .maybeSingle();
    if (!r) throw new Error("This job link is no longer valid.");
    if (!(r.status === "approved" || r.status === "sourcing" || r.status === "interviewing"))
      throw new Error("This role is no longer accepting applications.");

    const parsed = await aiJson<{
      full_name: string | null;
      email: string | null;
      phone: string | null;
      location: string | null;
      experience_years: number | null;
      education: string | null;
      skills: string[] | null;
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

    const p = parsed.ok ? parsed.data : null;
    const email = (data.email ?? p?.email ?? "").trim().toLowerCase();
    if (!email) throw new Error("We could not read an email address — please type yours in the form.");

    const row = {
      full_name: (data.fullName ?? p?.full_name ?? "").trim() || data.fileName.replace(/\.[^.]+$/, ""),
      email,
      phone: (data.phone ?? p?.phone) || null,
      location: p?.location || null,
      experience_years: Number(p?.experience_years ?? 0) || 0,
      education: p?.education || null,
      skills: p?.skills ?? [],
      linkedin_url: p?.linkedin_url || null,
      github_url: p?.github_url || null,
      website_url: p?.website_url || null,
      source: data.source,
      resume_text: data.resumeText,
      org_id: r.org_id,
      last_synced_at: new Date().toISOString(),
    };

    const { data: existing } = await supabaseAdmin
      .from("candidates")
      .select("id, skills, resume_text")
      .eq("email", email)
      .maybeSingle();

    let candidateId: string;
    if (existing) {
      const skills = new Set([...(existing.skills ?? []), ...row.skills].map((s) => s.trim()).filter(Boolean));
      const { error } = await supabaseAdmin
        .from("candidates")
        .update({ ...row, skills: [...skills] } as never)
        .eq("id", existing.id);
      if (error) throw new Error(error.message);
      candidateId = existing.id;
    } else {
      const { data: created, error } = await supabaseAdmin
        .from("candidates")
        .insert(row as never)
        .select("id")
        .single();
      if (error || !created) throw new Error(error?.message ?? "Could not save your application.");
      candidateId = created.id;
    }

    const { data: app } = await supabaseAdmin
      .from("applications")
      .select("id")
      .eq("candidate_id", candidateId)
      .eq("requisition_id", r.id)
      .maybeSingle();

    if (!app) {
      const { error } = await supabaseAdmin.from("applications").insert({
        candidate_id: candidateId,
        requisition_id: r.id,
        source: data.source,
        org_id: r.org_id,
      } as never);
      if (error) throw new Error(error.message);
    }

    return { ok: true as const, alreadyApplied: Boolean(app), name: row.full_name };
  });
