import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireIdentity } from "@/server/identity";
import { restClient } from "@/server/pgrest";
import {
  buildRecruiterPerformance,
  DEFAULT_SCHEME,
  type IncentiveScheme,
  type QualityBand,
} from "./hr-performance.server";

type Sb = { from: (t: string) => any; rpc: (fn: string, args: Record<string, unknown>) => any };

/** Only the owner, President/CBO (CHRO) and HR Head may see team-wide numbers. */
async function requireLeadership(supabase: Sb, userId: string) {
  const { data: member, error } = await supabase
    .from("org_members")
    .select("org_id, is_owner")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!member?.org_id) throw new Error("You are not part of an organisation yet.");

  if (member.is_owner) return member.org_id as string;
  const { data: roles, error: rErr } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId);
  if (rErr) throw new Error(rErr.message);
  const allowed = (roles ?? []).some((r: { role: string }) =>
    ["president_cbo", "hr_head"].includes(r.role),
  );
  if (!allowed) {
    throw new Error("Team performance is visible to the CHRO, HR Head and the account owner only.");
  }
  return member.org_id as string;
}

async function loadScheme(supabase: Sb, orgId: string): Promise<IncentiveScheme> {
  const { data, error } = await supabase
    .from("hr_incentive_schemes")
    .select("*")
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return DEFAULT_SCHEME;
  return {
    currency: data.currency ?? "INR",
    target_closures_per_month: Number(data.target_closures_per_month ?? 3),
    payout_per_closure: Number(data.payout_per_closure ?? 10000),
    quality_bands: (Array.isArray(data.quality_bands)
      ? data.quality_bands
      : DEFAULT_SCHEME.quality_bands) as QualityBand[],
    monthly_cap: data.monthly_cap === null ? null : Number(data.monthly_cap),
    notes: data.notes ?? null,
  };
}

/** Recruiter-by-recruiter delivery, quality and incentive workings for the CHRO. */
export const getHrPerformance = createServerFn({ method: "POST" })
  .middleware([requireIdentity])
  .inputValidator((input: unknown) =>
    z.object({ days: z.number().int().min(7).max(730).default(90) }).parse(input ?? {}),
  )
  .handler(async ({ data, context }) => {
    const supabase = restClient() as unknown as Sb;
    const orgId = await requireLeadership(supabase, context.userId);
    const scheme = await loadScheme(supabase, orgId);

    const since = new Date(Date.now() - data.days * 86_400_000).toISOString();

    const [events, applications, interviews, offers, matches, runs] = await Promise.all([
      supabase
        .from("stage_events")
        .select("application_id, actor, to_stage, created_at")
        .eq("org_id", orgId)
        .gte("created_at", since),
      supabase.from("applications").select("id, applied_at").eq("org_id", orgId),
      supabase
        .from("interviews")
        .select("application_id, status, scheduled_at")
        .eq("org_id", orgId),
      supabase.from("offers").select("application_id, status").eq("org_id", orgId),
      supabase
        .from("match_scores")
        .select("application_id, overall_score, computed_at")
        .eq("org_id", orgId),
      supabase
        .from("screening_runs")
        .select("application_id, combined_score, created_at")
        .eq("org_id", orgId),
    ]);
    for (const r of [events, applications, interviews, offers, matches, runs]) {
      if (r.error) throw new Error(r.error.message);
    }

    // Quality per application: the screening-backed combined fit when it exists,
    // otherwise the JD/CV match score.
    const quality = new Map<string, number>();
    for (const m of matches.data ?? []) {
      if (typeof m.overall_score === "number") quality.set(m.application_id, m.overall_score);
    }
    for (const r of runs.data ?? []) {
      if (r.application_id && typeof r.combined_score === "number") {
        quality.set(r.application_id, r.combined_score);
      }
    }

    const result = buildRecruiterPerformance({
      events: events.data ?? [],
      applications: applications.data ?? [],
      interviews: interviews.data ?? [],
      offers: offers.data ?? [],
      quality: [...quality.entries()].map(([application_id, score]) => ({ application_id, score })),
      scheme,
      months: Math.max(1, Math.round(data.days / 30)),
    });

    return {
      scheme,
      days: data.days,
      rows: result.rows,
      unattributed: result.unattributed,
      totals: {
        closures: result.rows.reduce((s, r) => s + (r.joined || r.offers_accepted), 0),
        payout: result.rows.reduce((s, r) => s + r.payout, 0),
        recruiters: result.rows.length,
      },
    };
  });

/** Save the incentive scheme the payouts above are calculated from. */
export const saveIncentiveScheme = createServerFn({ method: "POST" })
  .middleware([requireIdentity])
  .inputValidator((input: unknown) =>
    z
      .object({
        currency: z.string().min(1).max(8),
        target_closures_per_month: z.number().int().min(1).max(100),
        payout_per_closure: z.number().min(0),
        quality_bands: z
          .array(
            z.object({
              min_score: z.number().min(0).max(100),
              multiplier: z.number().min(0).max(5),
            }),
          )
          .min(1),
        monthly_cap: z.number().min(0).nullable(),
        notes: z.string().max(2000).nullable(),
      })
      .parse(input),
  )
  .handler(async ({ data, context }) => {
    const supabase = restClient() as unknown as Sb;
    const orgId = await requireLeadership(supabase, context.userId);
    const { error } = await supabase.from("hr_incentive_schemes").upsert(
      {
        org_id: orgId,
        currency: data.currency,
        target_closures_per_month: data.target_closures_per_month,
        payout_per_closure: data.payout_per_closure,
        quality_bands: data.quality_bands,
        monthly_cap: data.monthly_cap,
        notes: data.notes,
        updated_by: context.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id" },
    );
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
