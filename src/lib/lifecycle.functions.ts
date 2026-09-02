import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { canMove, REASON_REQUIRED, STAGE_LABEL, type Stage } from "./lifecycle";

const STAGES = Object.keys(STAGE_LABEL) as [Stage, ...Stage[]];

const MoveInput = z.object({
  applicationId: z.string().uuid(),
  toStage: z.enum(STAGES),
  reason: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

/**
 * The only sanctioned way to change an application's stage: the transition is
 * validated server-side and an immutable stage_event is written for the audit
 * trail. The UI never updates `applications.stage` directly.
 */
export const moveStage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => MoveInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: app, error } = await context.supabase
      .from("applications")
      .select("id, stage")
      .eq("id", data.applicationId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!app) throw new Error("Application not found");

    const from = app.stage as Stage;
    if (from === data.toStage) return { ok: true as const, from, to: data.toStage, unchanged: true };

    if (!canMove(from, data.toStage)) {
      throw new Error(
        `${STAGE_LABEL[from]} → ${STAGE_LABEL[data.toStage]} is not an allowed transition. Park the candidate on hold or in the reserve pool first.`,
      );
    }
    if (REASON_REQUIRED.includes(data.toStage) && !data.reason?.trim()) {
      throw new Error(`A reason is required to move a candidate to ${STAGE_LABEL[data.toStage]}.`);
    }

    const now = new Date().toISOString();
    const { error: upErr } = await context.supabase
      .from("applications")
      .update({
        stage: data.toStage,
        stage_reason: data.reason?.trim() || null,
        stage_note: data.note?.trim() || null,
        last_activity_at: now,
      })
      .eq("id", app.id);
    if (upErr) throw new Error(upErr.message);

    const actor = (context.claims as Record<string, unknown> | undefined)?.["email"];
    const { error: evErr } = await context.supabase.from("stage_events").insert({
      application_id: app.id,
      from_stage: from,
      to_stage: data.toStage,
      actor: typeof actor === "string" ? actor : context.userId,
      reason: data.reason?.trim() || null,
      note: data.note?.trim() || null,
    });
    if (evErr) throw new Error(evErr.message);

    return { ok: true as const, from, to: data.toStage, unchanged: false };
  });

/** Same validation, applied to a selection from the talent pool table. */
export const moveStages = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        applicationIds: z.array(z.string().uuid()).min(1).max(200),
        toStage: z.enum(STAGES),
        reason: z.string().optional().nullable(),
        note: z.string().optional().nullable(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    if (REASON_REQUIRED.includes(data.toStage) && !data.reason?.trim()) {
      throw new Error(`A reason is required to move candidates to ${STAGE_LABEL[data.toStage]}.`);
    }

    const { data: apps, error } = await context.supabase
      .from("applications")
      .select("id, stage")
      .in("id", data.applicationIds);
    if (error) throw new Error(error.message);

    const actorClaim = (context.claims as Record<string, unknown> | undefined)?.["email"];
    const actor = typeof actorClaim === "string" ? actorClaim : context.userId;
    const now = new Date().toISOString();

    const moved: string[] = [];
    const blocked: { id: string; from: Stage }[] = [];
    for (const a of apps ?? []) {
      const from = a.stage as Stage;
      if (from === data.toStage) continue;
      if (!canMove(from, data.toStage)) {
        blocked.push({ id: a.id, from });
        continue;
      }
      moved.push(a.id);
    }

    if (moved.length) {
      await context.supabase
        .from("applications")
        .update({
          stage: data.toStage,
          stage_reason: data.reason?.trim() || null,
          stage_note: data.note?.trim() || null,
          last_activity_at: now,
        })
        .in("id", moved);
      await context.supabase.from("stage_events").insert(
        moved.map((id) => ({
          application_id: id,
          from_stage: (apps ?? []).find((a) => a.id === id)!.stage,
          to_stage: data.toStage,
          actor,
          reason: data.reason?.trim() || null,
          note: data.note?.trim() || null,
        })),
      );
    }

    return { moved: moved.length, blocked: blocked.length };
  });
