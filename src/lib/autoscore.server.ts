/**
 * Background scoring: every application that arrived on its own (apply link,
 * careers mailbox, LinkedIn) is scored against its requisition's JD without
 * anyone pressing anything, so HR opens the pipeline and already sees ranks.
 */
import { DEFAULT_WEIGHTS, harvestProfileLinks, scoreCandidate } from "./matching.server";

export type AutoScoreOutcome = {
  candidate: string;
  requisition: string;
  score: number | null;
  status: "scored" | "error";
  detail: string;
};

export async function scoreUnscored(opts: {
  orgId: string;
  requisitionId?: string | null;
  limit?: number;
}): Promise<{ scored: number; errors: number; outcomes: AutoScoreOutcome[] }> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const limit = Math.min(opts.limit ?? 25, 50);

  let q = supabaseAdmin
    .from("applications")
    .select("id, stage, requisition_id, candidate_id")
    .eq("org_id", opts.orgId)
    .order("applied_at", { ascending: false })
    .limit(200);
  if (opts.requisitionId) q = q.eq("requisition_id", opts.requisitionId);
  const { data: apps } = await q;
  const rows = apps ?? [];
  if (!rows.length) return { scored: 0, errors: 0, outcomes: [] };

  const { data: scored } = await supabaseAdmin
    .from("match_scores")
    .select("application_id")
    .in(
      "application_id",
      rows.map((r) => r.id),
    );
  const already = new Set((scored ?? []).map((s) => s.application_id));
  const pending = rows.filter((r) => !already.has(r.id)).slice(0, limit);
  if (!pending.length) return { scored: 0, errors: 0, outcomes: [] };

  const outcomes: AutoScoreOutcome[] = [];
  let ok = 0;

  for (const app of pending) {
    let label = "Candidate";
    let reqTitle = "requisition";
    try {
      const [{ data: req }, { data: cand }] = await Promise.all([
        supabaseAdmin.from("requisitions").select("*").eq("id", app.requisition_id).maybeSingle(),
        supabaseAdmin.from("candidates").select("*").eq("id", app.candidate_id).maybeSingle(),
      ]);
      if (!req || !cand) throw new Error("Requisition or candidate missing");
      reqTitle = req.title;
      label = cand.full_name;

      const { data: jd } = await supabaseAdmin
        .from("job_descriptions")
        .select("full_text, must_have, good_to_have, responsibilities, qualifications")
        .eq("requisition_id", req.id)
        .order("version", { ascending: false })
        .limit(1)
        .maybeSingle();

      const links = harvestProfileLinks(cand.resume_text);
      const result = await scoreCandidate({
        jd: {
          title: req.title,
          mustHave: jd?.must_have?.length ? jd.must_have : req.must_have_skills,
          goodToHave: jd?.good_to_have?.length ? jd.good_to_have : req.good_to_have_skills,
          responsibilities: jd?.responsibilities ?? req.responsibilities,
          education: jd?.qualifications ?? req.education_requirement,
          experienceMin: req.experience_min,
          experienceMax: req.experience_max,
          jdText: jd?.full_text ?? null,
          constraints: {
            location: req.location,
            ctcBandMin: req.ctc_band_min,
            ctcBandMax: req.ctc_band_max,
            maxNoticePeriodDays: req.max_notice_period_days,
            workAuthorizationRequired: req.work_authorization_required,
          } as never,
        },
        candidate: {
          name: cand.full_name,
          skills: cand.skills,
          experienceYears: Number(cand.experience_years ?? 0),
          education: cand.education,
          resumeText: cand.resume_text,
          linkedinUrl: cand.linkedin_url ?? links.linkedinUrl,
          githubUrl: cand.github_url ?? links.githubUrl,
          websiteUrl: cand.website_url ?? links.websiteUrl,
          xUrl: cand.x_url ?? links.xUrl,
          noticePeriodDays: cand.notice_period_days,
          currentCtc: cand.current_ctc ? Number(cand.current_ctc) : null,
          expectedCtc: cand.expected_ctc ? Number(cand.expected_ctc) : null,
          location: cand.location,
          preferredLocations: cand.preferred_locations,
          willingToRelocate: cand.willing_to_relocate,
          workAuthorization: cand.work_authorization,
        } as never,
        weights: {
          skills: req.weight_skills ?? DEFAULT_WEIGHTS.skills,
          experience: req.weight_experience ?? DEFAULT_WEIGHTS.experience,
          career: req.weight_career ?? DEFAULT_WEIGHTS.career,
          impact: req.weight_impact ?? DEFAULT_WEIGHTS.impact,
          education: req.weight_education ?? DEFAULT_WEIGHTS.education,
          social: req.weight_social ?? DEFAULT_WEIGHTS.social,
        },
        includeSocial: true,
      });

      const { error } = await supabaseAdmin.from("match_scores").insert({
        application_id: app.id,
        org_id: opts.orgId,
        skills_score: result.skills_score,
        experience_score: result.experience_score,
        career_score: result.career_score,
        impact_score: result.impact_score,
        innovation_score: result.innovation_score,
        career_metrics: result.career.metrics as never,
        career_flags: result.career.assessment.flags,
        logistics_flags: [...(result.logistics?.flags ?? []), ...(result.logistics?.blockers ?? [])],
        impact_highlights: result.impact.highlights,
        innovation_signals: result.impact.innovation_signals,
        education_score: result.education_score,
        social_score: result.social_score,
        overall_score: result.overall_score,
        weights: result.weights as never,
        matched_skills: result.matched_skills,
        missing_skills: result.missing_skills,
        rationale: result.rationale,
        risk_flags: result.risk_flags,
        recommendation: result.recommendation,
        model: result.model,
      });
      if (error) throw new Error(error.message);

      for (const s of result.social.signals) {
        await supabaseAdmin.from("social_profiles").upsert(
          {
            candidate_id: app.candidate_id,
            org_id: opts.orgId,
            provider: s.provider,
            profile_url: s.profile_url,
            handle: s.handle,
            score: s.score,
            signals: s.signals as never,
            rationale: s.rationale,
            status: s.status,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "candidate_id,provider" },
        );
      }

      if (app.stage === "applied" || app.stage === "sourced") {
        await supabaseAdmin
          .from("applications")
          .update({ stage: result.overall_score >= 75 ? "shortlisted" : "ai_screened" })
          .eq("id", app.id);
      }

      ok += 1;
      outcomes.push({
        candidate: label,
        requisition: reqTitle,
        score: result.overall_score,
        status: "scored",
        detail: result.recommendation,
      });
    } catch (e) {
      outcomes.push({
        candidate: label,
        requisition: reqTitle,
        score: null,
        status: "error",
        detail: e instanceof Error ? e.message : "Scoring failed",
      });
    }
  }

  return { scored: ok, errors: outcomes.length - ok, outcomes };
}
