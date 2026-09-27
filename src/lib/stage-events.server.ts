/**
 * Single choke point for application stage transitions: writes the immutable
 * stage_events, then enqueues the matching candidate emails through the outbox.
 *
 * Email rules (v1):
 *  - only shortlisted / l1 / l2 / l3 send a stage email
 *  - AI transitions only email on shortlisted (ai_screened reads as an
 *    automated rejection and stays silent)
 *  - interview_scheduled transitions stay silent (the invite email covers them)
 */
import { eq, inArray } from "drizzle-orm";

import { db } from "../server/db";
import { applications, candidates, organizations, requisitions, stageEvents } from "@db/schema";
import { enqueueStageUpdates } from "./email-outbox.server";
import type { Stage } from "./lifecycle";

const STAGE_EMAIL_COPY: Partial<Record<Stage, { heading: string; body: string }>> = {
  shortlisted: {
    heading: "You have been shortlisted",
    body: "Your profile stood out for this role, and the recruiting team would like to take your application forward to the next round.",
  },
  l1: {
    heading: "You have advanced to the first interview round",
    body: "Congratulations — you have advanced to the first interview round. The team will share the details shortly.",
  },
  l2: {
    heading: "You have advanced to the next interview round",
    body: "Congratulations — you have advanced to the next interview round. The team will share the details shortly.",
  },
  l3: {
    heading: "You have advanced to the final interview round",
    body: "Congratulations — you have advanced to the final interview round. The team will share the details shortly.",
  },
};

export interface RecordStageTransitionInput {
  orgId: string;
  applicationId: string;
  fromStage: Stage | null;
  toStage: Stage;
  actor: string;
  reason?: string | null;
  note?: string | null;
  source?: "human" | "ai";
  cause?: "interview_scheduled" | "offer";
}

export async function recordStageTransition(input: RecordStageTransitionInput): Promise<void> {
  return recordStageTransitions([input]);
}

export async function recordStageTransitions(inputs: RecordStageTransitionInput[]): Promise<void> {
  if (!inputs.length) return;

  const events = await db
    .insert(stageEvents)
    .values(
      inputs.map((i) => ({
        applicationId: i.applicationId,
        orgId: i.orgId,
        fromStage: i.fromStage,
        toStage: i.toStage,
        actor: i.actor,
        reason: i.reason ?? null,
        note: i.note ?? null,
      })),
    )
    .returning({ id: stageEvents.id });

  // Multi-row INSERT ... RETURNING preserves insertion order.
  const eligible = inputs
    .map((input, i) => ({ input, eventId: events[i]?.id }))
    .filter(({ input, eventId }) => {
      if (!eventId) return false;
      if (!STAGE_EMAIL_COPY[input.toStage]) return false;
      if (input.fromStage && input.fromStage === input.toStage) return false;
      if (input.source === "ai" && input.toStage !== "shortlisted") return false;
      if (input.cause === "interview_scheduled") return false;
      return true;
    });
  if (!eligible.length) return;

  const [ctx] = eligible;
  const contact = await db
    .select({
      applicationId: applications.id,
      email: candidates.email,
      fullName: candidates.fullName,
      jobTitle: requisitions.title,
      orgName: organizations.name,
    })
    .from(applications)
    .innerJoin(candidates, eq(applications.candidateId, candidates.id))
    .innerJoin(requisitions, eq(applications.requisitionId, requisitions.id))
    .innerJoin(organizations, eq(applications.orgId, organizations.id))
    .where(
      inArray(
        applications.id,
        eligible.map((e) => e.input.applicationId),
      ),
    );
  const byApplication = new Map(contact.map((c) => [c.applicationId, c]));

  const byOrg = new Map<string, Parameters<typeof enqueueStageUpdates>[0]>();
  for (const { input, eventId } of eligible) {
    const c = byApplication.get(input.applicationId);
    if (!c?.email) continue;
    const copy = STAGE_EMAIL_COPY[input.toStage]!;
    const rows = byOrg.get(input.orgId) ?? [];
    rows.push({
      applicationId: input.applicationId,
      toEmail: c.email,
      idempotencyKey: `stage:${eventId}`,
      templateData: {
        candidateName: c.fullName,
        orgName: c.orgName,
        jobTitle: c.jobTitle,
        stageHeading: copy.heading,
        stageBody: copy.body,
      },
    });
    byOrg.set(input.orgId, rows);
  }

  for (const [orgId, rows] of byOrg) {
    await enqueueStageUpdates(rows, { orgId });
  }
}
