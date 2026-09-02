import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type MeetingProviderRow = {
  id: string;
  provider: "zoom" | "google_meet" | "teams";
  label: string;
  enabled: boolean;
  ready: boolean;
  last_test_status: string;
};

/** Meeting providers the HR admin has configured on the Integrations page. */
export const meetingProviders = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MeetingProviderRow[]> => {
    const { data, error } = await context.supabase
      .from("source_integrations")
      .select("id, provider, label, enabled, has_credentials, last_test_status")
      .eq("category", "meeting")
      .order("label");
    if (error) throw new Error(error.message);
    return (data ?? []).map((r) => ({
      id: r.id,
      provider: r.provider as MeetingProviderRow["provider"],
      label: r.label,
      enabled: r.enabled,
      ready: r.enabled && r.has_credentials,
      last_test_status: r.last_test_status,
    }));
  });

const CreateInput = z.object({
  provider: z.enum(["zoom", "google_meet", "teams"]),
  topic: z.string().min(1).max(200),
  startIso: z.string().min(1),
  durationMins: z.number().min(15).max(240),
  attendees: z.array(z.string().email()).max(20).default([]),
  agenda: z.string().max(2000).optional().nullable(),
});

/** Create a real meeting with the HR user's own provider credentials. */
export const createMeetingLink = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: row, error } = await context.supabase
      .from("source_integrations")
      .select("id, enabled, has_credentials, label")
      .eq("provider", data.provider)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!row) throw new Error("That meeting provider is not set up yet.");
    if (!row.enabled || !row.has_credentials)
      throw new Error(`${row.label} is not connected — add the credentials on the Integrations page first.`);

    const { readSecrets } = await import("./integrations.server");
    const { createMeeting } = await import("./meetings.server");
    const secrets = await readSecrets(row.id);
    return createMeeting(data.provider, secrets, {
      topic: data.topic,
      startIso: data.startIso,
      durationMins: data.durationMins,
      attendees: data.attendees,
      agenda: data.agenda ?? null,
    });
  });
