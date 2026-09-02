/**
 * Scheduled candidate sync.
 *
 * Re-runs the genuineness agent and refreshes social evidence for candidates
 * whose data is stale, prioritising anyone currently active in a pipeline.
 * Called by the platform scheduler with the cron secret; never public.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";
import { verifyClaims } from "@/lib/verification.server";

const Body = z.object({
  staleDays: z.number().min(0).max(365).optional(),
  limit: z.number().min(1).max(50).optional(),
});

async function run(request: Request) {
  const denied = await authenticateCronRequest(request);
  if (denied) return denied;

  let opts: z.infer<typeof Body> = {};
  try {
    const raw = await request.text();
    if (raw) opts = Body.parse(JSON.parse(raw));
  } catch {
    /* no body is fine — defaults apply */
  }
  const staleDays = opts.staleDays ?? 30;
  const limit = opts.limit ?? 15;

  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const cutoff = new Date(Date.now() - staleDays * 86_400_000).toISOString();

  // Candidates active in a pipeline come first, then the rest of the pool.
  const { data: activeApps } = await supabaseAdmin
    .from("applications")
    .select("candidate_id, stage")
    .not("stage", "in", "(rejected,withdrawn,offer_declined,no_show,joined,hired)");
  const activeIds = new Set((activeApps ?? []).map((a) => a.candidate_id));

  const { data: candidates, error } = await supabaseAdmin
    .from("candidates")
    .select("id, full_name, skills, resume_text, linkedin_url, github_url, website_url, x_url, last_synced_at")
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .limit(200);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const queue = [...(candidates ?? [])]
    .sort((a, b) => Number(activeIds.has(b.id)) - Number(activeIds.has(a.id)))
    .slice(0, limit);

  let ok = 0;
  let failed = 0;
  for (const c of queue) {
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

  return Response.json({ scanned: (candidates ?? []).length, processed: queue.length, ok, failed, staleDays });
}

export const Route = createFileRoute("/api/public/sync-candidates")({
  server: { handlers: { POST: ({ request }) => run(request) } },
});
