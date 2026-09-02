import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canMove, REASON_REQUIRED, STAGE_LABEL, type Stage } from "./lifecycle";

/* --------------------------------------------------------------- helpers */

function actorOf(context: { claims?: unknown; userId: string }) {
  const email = (context.claims as Record<string, unknown> | undefined)?.["email"];
  return typeof email === "string" ? email : context.userId;
}

/** Where a verdict at a given level should push the application next. */
export function nextStageFor(level: number, verdict: "select" | "hold" | "reject"): Stage {
  if (verdict === "reject") return "rejected";
  if (verdict === "hold") return "on_hold";
  return level >= 3 ? "offer_pending" : ((`l${level + 1}`) as Stage);
}

/* ---------------------------------------------------- interviewer queue */

export type MyInterview = {
  id: string;
  application_id: string;
  candidate_id: string;
  candidate_name: string;
  requisition_title: string;
  level: number;
  scheduled_at: string | null;
  duration_mins: number;
  mode: string;
  agenda: string | null;
  teams_link: string | null;
  status: string;
  stage: Stage;
  submitted: boolean;
};

/** Every interview assigned to the signed-in user, newest first. */
export const myInterviews = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyInterview[]> => {
    const email = actorOf(context).toLowerCase();

    const { data: rounds, error } = await context.supabase
      .from("interviews")
      .select("id, application_id, level, scheduled_at, duration_mins, mode, agenda, teams_link, status, interviewer, interviewer_email")
      .order("scheduled_at", { ascending: true });
    if (error) throw new Error(error.message);

    const mine = (rounds ?? []).filter(
      (r) =>
        (r.interviewer_email ?? "").toLowerCase() === email ||
        (r.interviewer ?? "").toLowerCase() === email,
    );
    if (!mine.length) return [];

    const appIds = [...new Set(mine.map((r) => r.application_id))];
    const [{ data: apps }, { data: evals }] = await Promise.all([
      context.supabase.from("applications").select("id, stage, candidate_id, requisition_id").in("id", appIds),
      context.supabase.from("evaluations").select("interview_id").in("application_id", appIds),
    ]);

    const candIds = [...new Set((apps ?? []).map((a) => a.candidate_id))];
    const reqIds = [...new Set((apps ?? []).map((a) => a.requisition_id))];
    const [{ data: cands }, { data: reqs }] = await Promise.all([
      context.supabase.from("candidates").select("id, full_name").in("id", candIds),
      context.supabase.from("requisitions").select("id, title").in("id", reqIds),
    ]);

    const submitted = new Set((evals ?? []).map((e) => e.interview_id).filter(Boolean) as string[]);

    return mine.map((r) => {
      const app = (apps ?? []).find((a) => a.id === r.application_id);
      return {
        id: r.id,
        application_id: r.application_id,
        candidate_id: app?.candidate_id ?? "",
        candidate_name: (cands ?? []).find((c) => c.id === app?.candidate_id)?.full_name ?? "Candidate",
        requisition_title: (reqs ?? []).find((q) => q.id === app?.requisition_id)?.title ?? "Requisition",
        level: r.level,
        scheduled_at: r.scheduled_at,
        duration_mins: r.duration_mins,
        mode: r.mode,
        agenda: r.agenda,
        teams_link: r.teams_link,
        status: r.status,
        stage: (app?.stage ?? "shortlisted") as Stage,
        submitted: submitted.has(r.id),
      };
    });
  });

/* ------------------------------------------------------ scorecard submit */

const ScorecardInput = z.object({
  interviewId: z.string().uuid().optional().nullable(),
  applicationId: z.string().uuid(),
  level: z.number().min(1).max(3),
  focusArea: z.string().optional().nullable(),
  rating: z.number().min(1).max(5),
  verdict: z.enum(["select", "hold", "reject"]),
  comments: z.string().optional().nullable(),
  reason: z.string().optional().nullable(),
  competencies: z
    .array(z.object({ name: z.string().min(1), rating: z.number().min(1).max(5) }))
    .max(12)
    .default([]),
});

export type ScorecardResult = {
  ok: true;
  evaluationId: string;
  movedTo: Stage | null;
  blocked: string | null;
  nextInterviewCreated: boolean;
};

/**
 * Single sanctioned way to submit interview feedback: writes an immutable
 * scorecard, locks the round, then auto-progresses the application (select →
 * next level or offer, hold → on hold, reject → rejected) with a stage_event.
 */
export const submitScorecard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ScorecardInput.parse(data))
  .handler(async ({ data, context }): Promise<ScorecardResult> => {
    const actor = actorOf(context);
    const now = new Date().toISOString();

    if (data.interviewId) {
      const { data: existing } = await context.supabase
        .from("evaluations")
        .select("id")
        .eq("interview_id", data.interviewId)
        .maybeSingle();
      if (existing) throw new Error("This interview round has already been scored — scorecards are final.");
    }

    const { data: app, error: appErr } = await context.supabase
      .from("applications")
      .select("id, stage")
      .eq("id", data.applicationId)
      .maybeSingle();
    if (appErr) throw new Error(appErr.message);
    if (!app) throw new Error("Application not found");

    const target = nextStageFor(data.level, data.verdict);
    if (REASON_REQUIRED.includes(target) && !data.reason?.trim() && !data.comments?.trim()) {
      throw new Error(`A reason is required to move the candidate to ${STAGE_LABEL[target]}.`);
    }

    const { data: evaluation, error: evalErr } = await context.supabase
      .from("evaluations")
      .insert({
        application_id: data.applicationId,
        interview_id: data.interviewId ?? null,
        level: data.level,
        evaluator: actor,
        focus_area: data.focusArea?.trim() || null,
        rating: data.rating,
        recommendation: data.verdict,
        comments: data.comments?.trim() || null,
        competencies: data.competencies as never,
        submitted_by: actor,
        submitted_at: now,
      })
      .select("id")
      .single();
    if (evalErr) throw new Error(evalErr.message);

    if (data.interviewId) {
      await context.supabase
        .from("interviews")
        .update({ status: "completed", completed_at: now })
        .eq("id", data.interviewId);
    }

    /* Auto-progression, audited exactly like a manual stage move. */
    const from = app.stage as Stage;
    let movedTo: Stage | null = null;
    let blocked: string | null = null;
    const reason = data.reason?.trim() || `L${data.level} verdict: ${data.verdict}`;

    if (from !== target && canMove(from, target)) {
      const { error: upErr } = await context.supabase
        .from("applications")
        .update({ stage: target, stage_reason: reason, stage_note: data.comments?.trim() || null, last_activity_at: now })
        .eq("id", app.id);
      if (upErr) throw new Error(upErr.message);
      await context.supabase.from("stage_events").insert({
        application_id: app.id,
        from_stage: from,
        to_stage: target,
        actor,
        reason,
        note: data.comments?.trim() || null,
      });
      movedTo = target;
    } else if (from !== target) {
      blocked = `${STAGE_LABEL[from]} → ${STAGE_LABEL[target]} is not an allowed transition — move the candidate manually.`;
      await context.supabase.from("applications").update({ last_activity_at: now }).eq("id", app.id);
    }

    /* A select below L3 queues the next round so nothing stalls unassigned. */
    let nextInterviewCreated = false;
    if (data.verdict === "select" && data.level < 3) {
      const nextLevel = data.level + 1;
      const { data: already } = await context.supabase
        .from("interviews")
        .select("id")
        .eq("application_id", app.id)
        .eq("level", nextLevel)
        .maybeSingle();
      if (!already) {
        await context.supabase.from("interviews").insert({
          application_id: app.id,
          level: nextLevel,
          status: "pending_scheduling",
          scheduled_at: null,
        });
        nextInterviewCreated = true;
      }
    }

    return { ok: true, evaluationId: evaluation.id, movedTo, blocked, nextInterviewCreated };
  });

/* ------------------------------------------------------------- scheduling */

const ScheduleInput = z.object({
  applicationId: z.string().uuid(),
  level: z.number().min(1).max(3),
  interviewer: z.string().optional().nullable(),
  interviewerEmail: z.string().email().optional().nullable(),
  scheduledAt: z.string().min(1),
  durationMins: z.number().min(15).max(240).default(60),
  mode: z.enum(["online", "onsite", "phone"]).default("online"),
  meetingLink: z.string().optional().nullable(),
  agenda: z.string().optional().nullable(),
  interviewId: z.string().uuid().optional().nullable(),
});

/** Create or re-schedule a round and park the application on that interview stage. */
export const scheduleInterview = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => ScheduleInput.parse(data))
  .handler(async ({ data, context }) => {
    const actor = actorOf(context);
    const now = new Date().toISOString();
    const row = {
      application_id: data.applicationId,
      level: data.level,
      interviewer: data.interviewer?.trim() || null,
      interviewer_email: data.interviewerEmail?.trim().toLowerCase() || null,
      scheduled_at: new Date(data.scheduledAt).toISOString(),
      duration_mins: data.durationMins,
      mode: data.mode,
      teams_link: data.meetingLink?.trim() || null,
      agenda: data.agenda?.trim() || null,
      status: "scheduled",
    };

    if (data.interviewId) {
      const { error } = await context.supabase.from("interviews").update(row).eq("id", data.interviewId);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await context.supabase.from("interviews").insert(row);
      if (error) throw new Error(error.message);
    }

    const { data: app } = await context.supabase
      .from("applications")
      .select("id, stage")
      .eq("id", data.applicationId)
      .maybeSingle();
    const target = (`l${data.level}`) as Stage;
    if (app && app.stage !== target && canMove(app.stage as Stage, target)) {
      await context.supabase
        .from("applications")
        .update({ stage: target, stage_reason: `L${data.level} scheduled`, last_activity_at: now })
        .eq("id", app.id);
      await context.supabase.from("stage_events").insert({
        application_id: app.id,
        from_stage: app.stage,
        to_stage: target,
        actor,
        reason: `L${data.level} interview scheduled`,
      });
    }

    return { ok: true as const };
  });
