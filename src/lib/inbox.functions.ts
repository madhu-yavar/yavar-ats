/**
 * Careers-inbox server functions: status for the Integrations page and the
 * manual "Import now" action. The hourly automatic run lives in
 * src/routes/api/public/inbox-sync.ts.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const careersInboxStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async () => {
    const { inboxConfigured, inboxProfile } = await import("./inbox.server");
    if (!inboxConfigured()) {
      return { connected: false as const, email: null as string | null, error: null as string | null };
    }
    try {
      const profile = await inboxProfile();
      return { connected: true as const, email: profile.email, error: null as string | null };
    } catch (e) {
      return {
        connected: false as const,
        email: null as string | null,
        error: e instanceof Error ? e.message : "Could not reach the careers mailbox.",
      };
    }
  });

const SyncInput = z.object({
  requisitionId: z.string().uuid().nullable().optional(),
  max: z.number().int().min(1).max(50).optional(),
  query: z.string().max(200).optional(),
});

export const importCareersInbox = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => SyncInput.parse(data ?? {}))
  .handler(async ({ data }) => {
    const { syncCareersInbox } = await import("./inbox.server");
    return syncCareersInbox({
      requisitionId: data.requisitionId ?? null,
      max: data.max ?? 20,
      ...(data.query ? { query: data.query } : {}),
    });
  });
