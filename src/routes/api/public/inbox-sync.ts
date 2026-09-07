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
  if (!inboxConfigured()) {
    return Response.json({ skipped: true, reason: "careers inbox not connected" });
  }

  try {
    const result = await syncCareersInbox({
      max: opts.max ?? 25,
      ...(opts.query ? { query: opts.query } : {}),
    });
    // Score whatever just arrived, per organisation, so pipelines are already
    // ranked before anyone opens them.
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { scoreUnscored } = await import("@/lib/autoscore.server");
    const { data: orgs } = await supabaseAdmin
      .from("organizations")
      .select("id")
      .eq("status", "active");
    let scored = 0;
    let scoreErrors = 0;
    for (const org of orgs ?? []) {
      const run = await scoreUnscored({ orgId: org.id, limit: 25 });
      scored += run.scored;
      scoreErrors += run.errors;
    }

    return Response.json({
      scanned: result.scanned,
      imported: result.imported,
      updated: result.updated,
      skipped: result.skipped,
      errors: result.errors,
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
