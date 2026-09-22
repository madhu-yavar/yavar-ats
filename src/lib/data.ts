/**
 * UI read layer — thin React Query wrappers over org-scoped server functions.
 * The browser never queries Postgres directly; rows arrive in the same
 * PostgREST wire shapes the routes were written against.
 */
import { queryOptions } from "@tanstack/react-query";

import {
  listAiInterviews,
  listAllScreeningRuns,
  listApplications,
  listCandidateAssessments,
  listCandidates,
  listCandidateNotes,
  listCandidateReferrals,
  listCandidateScreeningKits,
  listCandidateScreeningRuns,
  listCandidateVerifications,
  listDepartments,
  listEvaluations,
  listInterviews,
  listJobDescriptions,
  listOwnershipEvents,
  listMasterItems,
  listMatchScores,
  listOffers,
  listRequisitions,
  listScreeningKits,
  listSocialProfiles,
  listTalentRequestSuggestions,
  listTalentRequests,
  listStageEvents,
  listVerifications,
  getRequisition,
  getCandidate,
} from "./queries.functions";
import { addMasterItem as addMasterItemFn } from "./master.functions";
import { getLatestBenchmark, type BenchmarkRow } from "./salary-benchmark.functions";
import { listTemplates, type TemplateWire } from "./templates.functions";
import type { Json, Tables } from "@/lib/database.types";

export type Department = Tables<"departments">;
/**
 * Generated row types lag the schema for a few newer columns (drizzle/schema.ts
 * is the source of truth), so they are spelled out here.
 */
export type Requisition = Tables<"requisitions"> & { job_card_overrides: Json | null };
export type JobDescription = Tables<"job_descriptions"> & { template_name: string | null };
export type Candidate = Tables<"candidates">;
export type Application = Tables<"applications">;
export type MatchScore = Tables<"match_scores">;
export type SocialProfile = Tables<"social_profiles">;
export type Evaluation = Tables<"evaluations">;
export type Interview = Tables<"interviews">;
export type Offer = Tables<"offers"> & { letter: Json | null; letter_template_id: string | null };
export type AiInterview = Tables<"ai_interviews">;
export type MasterItem = Tables<"master_items">;
export type MasterKind =
  | "skill"
  | "location"
  | "education"
  | "employment_type"
  | "industry"
  | "role_title"
  | "billing_type"
  | "engagement_type"
  | "client"
  | "rejection_reason";

export const departmentsQuery = queryOptions({
  queryKey: ["departments"],
  queryFn: async () => (await listDepartments()) as Department[],
});

/** Global reference library: skills, locations, education, employment types, industries. */
export const masterItemsQuery = queryOptions({
  queryKey: ["master_items"],
  queryFn: async () => (await listMasterItems()) as MasterItem[],
});

export function byKind(items: MasterItem[] | undefined, kind: MasterKind) {
  return (items ?? []).filter((i) => i.kind === kind);
}

export async function addMasterItem(kind: MasterKind, name: string, category?: string | null) {
  await addMasterItemFn({ data: { kind, name: name.trim(), category: category ?? null } });
}

export const requisitionsQuery = queryOptions({
  queryKey: ["requisitions"],
  queryFn: async () => (await listRequisitions()) as Requisition[],
});

export const requisitionQuery = (id: string) =>
  queryOptions({
    queryKey: ["requisition", id],
    queryFn: async () => (await getRequisition({ data: { id } })) as Requisition | null,
  });

export type { BenchmarkRow } from "./salary-benchmark.functions";
export type { TemplateWire } from "./templates.functions";

export const templatesQuery = queryOptions({
  queryKey: ["templates"],
  queryFn: async () => (await listTemplates()) as TemplateWire[],
});

export const benchmarkQuery = (input: {
  title: string;
  location?: string | null;
  experienceMin: number;
  experienceMax: number;
}) =>
  queryOptions({
    queryKey: ["salary_benchmark", input],
    enabled: input.title.trim().length > 0,
    queryFn: async () =>
      (await getLatestBenchmark({ data: input })) as {
        benchmark: BenchmarkRow;
        stale: boolean;
      } | null,
  });

export const jdQuery = (requisitionId: string) =>
  queryOptions({
    queryKey: ["jd", requisitionId],
    queryFn: async () =>
      (await listJobDescriptions({ data: { requisitionId } })) as JobDescription[],
  });

export const candidatesQuery = queryOptions({
  queryKey: ["candidates"],
  queryFn: async () => (await listCandidates()) as Candidate[],
});

export const candidateQuery = (id: string) =>
  queryOptions({
    queryKey: ["candidate", id],
    queryFn: async () => (await getCandidate({ data: { id } })) as Candidate | null,
  });

export const applicationsQuery = queryOptions({
  queryKey: ["applications"],
  queryFn: async () => (await listApplications()) as Application[],
});

export const matchScoresQuery = queryOptions({
  queryKey: ["match_scores"],
  queryFn: async () => (await listMatchScores()) as MatchScore[],
});

export const socialProfilesQuery = queryOptions({
  queryKey: ["social_profiles"],
  queryFn: async () => (await listSocialProfiles()) as SocialProfile[],
});

export const evaluationsQuery = queryOptions({
  queryKey: ["evaluations"],
  queryFn: async () => (await listEvaluations()) as Evaluation[],
});

export const interviewsQuery = queryOptions({
  queryKey: ["interviews"],
  queryFn: async () => (await listInterviews()) as Interview[],
});

export const offersQuery = queryOptions({
  queryKey: ["offers"],
  queryFn: async () => (await listOffers()) as Offer[],
});

export const aiInterviewsQuery = queryOptions({
  queryKey: ["ai_interviews"],
  queryFn: async () => (await listAiInterviews()) as AiInterview[],
});

export type StageEvent = Tables<"stage_events">;
export type CandidateVerification = Tables<"candidate_verifications">;

export const stageEventsQuery = (applicationIds: string[]) =>
  queryOptions({
    queryKey: ["stage_events", [...applicationIds].sort().join(",")],
    enabled: applicationIds.length > 0,
    queryFn: async () => (await listStageEvents({ data: { applicationIds } })) as StageEvent[],
  });

/** Every verification run; newest first, so the head of each candidate group is current. */
export const verificationsQuery = queryOptions({
  queryKey: ["candidate_verifications"],
  queryFn: async () => (await listVerifications()) as CandidateVerification[],
});

export const candidateVerificationsQuery = (candidateId: string) =>
  queryOptions({
    queryKey: ["candidate_verifications", candidateId],
    queryFn: async () =>
      (await listCandidateVerifications({ data: { candidateId } })) as CandidateVerification[],
  });

export type CandidateAssessment = Tables<"candidate_assessments">;

export const candidateAssessmentsQuery = (candidateId: string) =>
  queryOptions({
    queryKey: ["candidate_assessments", candidateId],
    queryFn: async () =>
      (await listCandidateAssessments({ data: { candidateId } })) as CandidateAssessment[],
  });

/** Latest verification per candidate. */
export function latestVerifications(rows: CandidateVerification[]) {
  const map = new Map<string, CandidateVerification>();
  for (const v of rows) if (!map.has(v.candidate_id)) map.set(v.candidate_id, v);
  return map;
}

/** Latest score per application. */
export function latestScores(scores: MatchScore[]) {
  const map = new Map<string, MatchScore>();
  for (const s of scores) if (!map.has(s.application_id)) map.set(s.application_id, s);
  return map;
}

export type ScreeningKit = Tables<"screening_kits">;
export type ScreeningRun = Tables<"screening_runs">;

/** Screening question kits prepared for one candidate, newest first. */
export const screeningKitsQuery = (candidateId: string) =>
  queryOptions({
    queryKey: ["screening_kits", candidateId],
    queryFn: async () => (await listCandidateScreeningKits({ data: { candidateId } })) as unknown as ScreeningKit[],
  });

/** Graded screening calls for one candidate, newest first. */
export const screeningRunsQuery = (candidateId: string) =>
  queryOptions({
    queryKey: ["screening_runs", candidateId],
    queryFn: async () => (await listCandidateScreeningRuns({ data: { candidateId } })) as unknown as ScreeningRun[],
  });

/** Every screening kit in the organisation, newest first. */
export const allScreeningKitsQuery = queryOptions({
  queryKey: ["screening_kits", "all"],
  queryFn: async () => (await listScreeningKits()) as unknown as ScreeningKit[],
});

/** Every graded screening call in the organisation, newest first. */
export const allScreeningRunsQuery = queryOptions({
  queryKey: ["screening_runs", "all"],
  queryFn: async () => (await listAllScreeningRuns()) as unknown as ScreeningRun[],
});

/* ----------------------------- team & sharing queries (ported to drizzle) */

export type CandidateNote = Tables<"candidate_notes">;
export type CandidateReferral = Tables<"candidate_referrals">;
export type TalentRequest = Tables<"talent_requests">;
export type TalentRequestSuggestion = Tables<"talent_request_suggestions">;
export type OwnershipEvent = Tables<"candidate_ownership_events">;

/** Team notes and mentions on one candidate, newest first. */
export const candidateNotesQuery = (candidateId: string) =>
  queryOptions({
    queryKey: ["candidate_notes", candidateId],
    queryFn: async () => (await listCandidateNotes({ data: { candidateId } })) as CandidateNote[],
  });

/** Ownership hand-over audit trail for one candidate, newest first. */
export const ownershipEventsQuery = (candidateId: string) =>
  queryOptions({
    queryKey: ["ownership_events", candidateId],
    queryFn: async () => (await listOwnershipEvents({ data: { candidateId } })) as OwnershipEvent[],
  });

/** Referrals sent between colleagues. */
export const referralsQuery = queryOptions({
  queryKey: ["candidate_referrals"],
  queryFn: async () => (await listCandidateReferrals()) as CandidateReferral[],
});

/** Open + closed "who has people for this?" requests from the team. */
export const talentRequestsQuery = queryOptions({
  queryKey: ["talent_requests"],
  queryFn: async () => (await listTalentRequests()) as TalentRequest[],
});

/** Candidates suggested against those requests. */
export const talentSuggestionsQuery = queryOptions({
  queryKey: ["talent_request_suggestions"],
  queryFn: async () => (await listTalentRequestSuggestions()) as TalentRequestSuggestion[],
});
