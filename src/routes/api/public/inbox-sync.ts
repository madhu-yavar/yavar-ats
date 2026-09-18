/**
 * Scheduled careers-inbox import.
 *
 * Reads the connected careers mailbox, pulls every CV attachment out of new
 * mail (LinkedIn applications, board alerts, direct applicants), parses it and
 * files the candidate against the matching open role. Called by the platform
 * scheduler with the cron secret; never public.
 */
import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { authenticateCronRequest } from "@/integrations/supabase/cron-auth";

const Body = z.object({
  max: z.number().min(1).max(50).optional(),
  query: z.string().max(200).optional(),
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

  const { inboxConfigured, syncCareersInbox } = await import("@/lib/inbox.server");

  try {
    let sync: Awaited<ReturnType<typeof syncCareersInbox>> | null = null;
    if (inboxConfigured()) {
      sync = await syncCareersInbox({
        max: opts.max ?? 25,
        ...(opts.query ? { query: opts.query } : {}),
      });
    }

    // Score whatever just arrived — through the gateway sync or the inbound
    // webhook — per organisation, so pipelines are already ranked before
    // anyone opens them.
    const { db } = await import("../../../server/db");
    const { organizations } = await import("@db/schema");
    const { eq } = await import("drizzle-orm");
    const { scoreUnscored } = await import("@/lib/autoscore.server");
    const orgs = await db
      .select({ id: organizations.id })
      .from(organizations)
      .where(eq(organizations.status, "active"));
    let scored = 0;
    let scoreErrors = 0;
    for (const org of orgs) {
      const run = await scoreUnscored({ orgId: org.id, limit: 25 });
      scored += run.scored;
      scoreErrors += run.errors;
    }

    return Response.json({
      ...(sync
        ? {
            scanned: sync.scanned,
            imported: sync.imported,
            updated: sync.updated,
            skipped: sync.skipped,
            errors: sync.errors,
          }
        : { skipped: true, reason: "careers inbox not connected" }),
      scored,
      scoreErrors,
    });
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "Failed" }, { status: 500 });
  }
}

export const Route = createFileRoute("/api/public/inbox-sync")({
  server: { handlers: { POST: ({ request }) => run(request) } },
});
