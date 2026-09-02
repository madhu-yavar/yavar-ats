import { queryOptions } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";

export type Department = Tables<"departments">;
export type Requisition = Tables<"requisitions">;
export type JobDescription = Tables<"job_descriptions">;
export type Candidate = Tables<"candidates">;
export type Application = Tables<"applications">;
export type MatchScore = Tables<"match_scores">;
export type SocialProfile = Tables<"social_profiles">;
export type Evaluation = Tables<"evaluations">;
export type Interview = Tables<"interviews">;
export type Offer = Tables<"offers">;
export type AiInterview = Tables<"ai_interviews">;
export type MasterItem = Tables<"master_items">;
export type MasterKind = "skill" | "location" | "education" | "employment_type" | "industry" | "role_title";

async function unwrap<T>(p: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const { data, error } = await p;
  if (error) throw new Error(error.message);
  return (data ?? []) as T;
}

export const departmentsQuery = queryOptions({
  queryKey: ["departments"],
  queryFn: () => unwrap<Department[]>(supabase.from("departments").select("*").order("name")),
});

/** Global reference library: skills, locations, education, employment types, industries. */
export const masterItemsQuery = queryOptions({
  queryKey: ["master_items"],
  queryFn: () =>
    unwrap<MasterItem[]>(
      supabase.from("master_items").select("*").eq("active", true).order("sort_order").order("name"),
    ),
});

export function byKind(items: MasterItem[] | undefined, kind: MasterKind) {
  return (items ?? []).filter((i) => i.kind === kind);
}

export async function addMasterItem(kind: MasterKind, name: string, category?: string | null) {
  const { error } = await supabase.from("master_items").insert({ kind, name: name.trim(), category: category ?? null });
  if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
}

export const requisitionsQuery = queryOptions({
  queryKey: ["requisitions"],
  queryFn: () =>
    unwrap<Requisition[]>(supabase.from("requisitions").select("*").order("created_at", { ascending: false })),
});

export const requisitionQuery = (id: string) =>
  queryOptions({
    queryKey: ["requisition", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("requisitions").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data as Requisition | null;
    },
  });

export const jdQuery = (requisitionId: string) =>
  queryOptions({
    queryKey: ["jd", requisitionId],
    queryFn: () =>
      unwrap<JobDescription[]>(
        supabase
          .from("job_descriptions")
          .select("*")
          .eq("requisition_id", requisitionId)
          .order("version", { ascending: false }),
      ),
  });

export const candidatesQuery = queryOptions({
  queryKey: ["candidates"],
  queryFn: () =>
    unwrap<Candidate[]>(supabase.from("candidates").select("*").order("created_at", { ascending: false })),
});

export const candidateQuery = (id: string) =>
  queryOptions({
    queryKey: ["candidate", id],
    queryFn: async () => {
      const { data, error } = await supabase.from("candidates").select("*").eq("id", id).maybeSingle();
      if (error) throw new Error(error.message);
      return data as Candidate | null;
    },
  });

export const applicationsQuery = queryOptions({
  queryKey: ["applications"],
  queryFn: () => unwrap<Application[]>(supabase.from("applications").select("*")),
});

export const matchScoresQuery = queryOptions({
  queryKey: ["match_scores"],
  queryFn: () =>
    unwrap<MatchScore[]>(supabase.from("match_scores").select("*").order("computed_at", { ascending: false })),
});

export const socialProfilesQuery = queryOptions({
  queryKey: ["social_profiles"],
  queryFn: () => unwrap<SocialProfile[]>(supabase.from("social_profiles").select("*")),
});

export const evaluationsQuery = queryOptions({
  queryKey: ["evaluations"],
  queryFn: () =>
    unwrap<Evaluation[]>(supabase.from("evaluations").select("*").order("created_at", { ascending: false })),
});

export const interviewsQuery = queryOptions({
  queryKey: ["interviews"],
  queryFn: () => unwrap<Interview[]>(supabase.from("interviews").select("*").order("scheduled_at")),
});

export const offersQuery = queryOptions({
  queryKey: ["offers"],
  queryFn: () => unwrap<Offer[]>(supabase.from("offers").select("*").order("created_at", { ascending: false })),
});

export const aiInterviewsQuery = queryOptions({
  queryKey: ["ai_interviews"],
  queryFn: () => unwrap<AiInterview[]>(supabase.from("ai_interviews").select("*")),
});

/** Latest score per application. */
export function latestScores(scores: MatchScore[]) {
  const map = new Map<string, MatchScore>();
  for (const s of scores) if (!map.has(s.application_id)) map.set(s.application_id, s);
  return map;
}
