/**
 * One click for HR: gather everything the live job posts have brought in, read
 * each CV, file it against the right requisition, then score it in the
 * background so the pipeline is already ranked when HR looks at it.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Input = z.object({
  requisitionId: z.string().uuid().nullable().optional(),
  max: z.number().int().min(1).max(50).optional(),
});

export type CollectSummary = {
  /** CVs read out of the careers mailbox (LinkedIn application mail included). */
  scanned: number;
  imported: number;
  updated: number;
  skipped: number;
  importErrors: number;
  /** Background scoring of everything not yet scored. */
  scored: number;
  scoreErrors: number;
  /** Plain-English note when LinkedIn itself will not hand over applicants. */
  linkedinNote: string | null;
  mailboxNote: string | null;
  top: { candidate: string; requisition: string; score: number }[];
};

async function myOrgId(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}

export const collectApplicants = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => Input.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<CollectSummary> => {
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation yet.");

    const summary: CollectSummary = {
      scanned: 0,
      imported: 0,
      updated: 0,
      skipped: 0,
      importErrors: 0,
      scored: 0,
      scoreErrors: 0,
      linkedinNote: null,
      mailboxNote: null,
      top: [],
    };

    // 1. LinkedIn's own applicant feed, when the contract opens it.
    try {
      const { probeCapabilities } = await import("./linkedin.server");
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { data: conn } = await supabaseAdmin
        .from("org_linkedin_connections")
        .select("access_token, scope")
        .eq("org_id", orgId)
        .maybeSingle();
      if (!conn) {
        summary.linkedinNote = "LinkedIn is not connected for your organisation yet.";
      } else {
        const caps = await probeCapabilities(conn.access_token, conn.scope ?? null);
        const apps = caps.find((c) => c.id === "applications");
        summary.linkedinNote = apps?.ready
          ? null
          : (apps?.detail ??
            "LinkedIn is not handing over applicants for this account, so CVs come in through your apply link and careers mailbox.");
      }
    } catch (e) {
      summary.linkedinNote = e instanceof Error ? e.message : "Could not check LinkedIn.";
    }

    // 2. The careers mailbox — where LinkedIn application mail and CVs land.
    try {
      const { syncCareersInbox } = await import("./inbox.server");
      const run = await syncCareersInbox({
        requisitionId: data.requisitionId ?? null,
        max: data.max ?? 25,
      });
      summary.scanned = run.scanned;
      summary.imported = run.imported;
      summary.updated = run.updated;
      summary.skipped = run.skipped;
      summary.importErrors = run.errors;
    } catch (e) {
      summary.mailboxNote = e instanceof Error ? e.message : "Could not read the careers mailbox.";
    }

    // 3. Score everything still unscored, so HR never has to run matching by hand.
    const { scoreUnscored } = await import("./autoscore.server");
    const scoring = await scoreUnscored({
      orgId,
      requisitionId: data.requisitionId ?? null,
      limit: 25,
    });
    summary.scored = scoring.scored;
    summary.scoreErrors = scoring.errors;
    summary.top = scoring.outcomes
      .filter((o) => o.status === "scored" && o.score !== null)
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 5)
      .map((o) => ({ candidate: o.candidate, requisition: o.requisition, score: o.score ?? 0 }));

    return summary;
  });
