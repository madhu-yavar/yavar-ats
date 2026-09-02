import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { verifyClaims } from "./verification.server";

const Input = z.object({
  candidateId: z.string().uuid(),
  linkedinProfileText: z.string().optional().nullable(),
});

/**
 * Run the genuineness agent for one candidate and persist the result so
 * recruiters and approvers always see the same audited verdicts.
 */
export const verifyCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data))
  .handler(async ({ data, context }) => {
    const { data: candidate, error } = await context.supabase
      .from("candidates")
      .select(
        "id, full_name, skills, resume_text, linkedin_url, github_url, website_url, x_url",
      )
      .eq("id", data.candidateId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!candidate) throw new Error("Candidate not found");

    const result = await verifyClaims({
      name: candidate.full_name,
      resumeText: candidate.resume_text,
      skills: candidate.skills ?? [],
      linkedinUrl: candidate.linkedin_url,
      githubUrl: candidate.github_url,
      websiteUrl: candidate.website_url,
      xUrl: candidate.x_url,
      linkedinProfileText: data.linkedinProfileText ?? null,
    });

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    await supabaseAdmin.from("candidate_verifications").insert({
      candidate_id: candidate.id,
      authenticity_score: result.authenticity_score,
      claims: result.claims as any,
      red_flags: result.red_flags,
      evidence: result.evidence as any,
      summary: result.summary,
      model: result.model,
      status: "ok",
    });
    await supabaseAdmin
      .from("candidates")
      .update({ last_synced_at: new Date().toISOString(), sync_status: "ok" })
      .eq("id", candidate.id);

    return result;
  });

/** Bulk re-verification from the talent pool table. */
export const verifyCandidates = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ candidateIds: z.array(z.string().uuid()).min(1).max(50) }).parse(data))
  .handler(async ({ data, context }) => {
    const { data: rows, error } = await context.supabase
      .from("candidates")
      .select("id, full_name, skills, resume_text, linkedin_url, github_url, website_url, x_url")
      .in("id", data.candidateIds);
    if (error) throw new Error(error.message);

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let ok = 0;
    let failed = 0;

    for (const c of rows ?? []) {
      try {
        const result = await verifyClaims({
          name: c.full_name,
          resumeText: c.resume_text,
          skills: c.skills ?? [],
          linkedinUrl: c.linkedin_url,
          githubUrl: c.github_url,
          websiteUrl: c.website_url,
          xUrl: c.x_url,
        });
        await supabaseAdmin.from("candidate_verifications").insert({
          candidate_id: c.id,
          authenticity_score: result.authenticity_score,
          claims: result.claims as any,
          red_flags: result.red_flags,
          evidence: result.evidence as any,
          summary: result.summary,
          model: result.model,
          status: "ok",
        });
        await supabaseAdmin
          .from("candidates")
          .update({ last_synced_at: new Date().toISOString(), sync_status: "ok" })
          .eq("id", c.id);
        ok++;
      } catch (e) {
        failed++;
        await supabaseAdmin
          .from("candidates")
          .update({
            last_synced_at: new Date().toISOString(),
            sync_status: `error: ${(e as Error).message}`.slice(0, 200),
          })
          .eq("id", c.id);
      }
    }

    return { ok, failed, total: (rows ?? []).length };
  });
