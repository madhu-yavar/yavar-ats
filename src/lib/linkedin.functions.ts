import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchLinkedInMember, linkedinEnvConfigured, postToLinkedIn } from "./linkedin.server";

export type LinkedinStatus = {
  /** True when the LinkedIn connector is linked to this project. */
  configured: boolean;
  connected: boolean;
  member: string | null;
  /** The connector gateway handles token refresh, so this is always false. */
  expiresSoon: boolean;
};

/**
 * Company-wide LinkedIn connection status. The account is connected once via
 * Lovable's LinkedIn connector; the gateway injects the OAuth token, so
 * status is simply "can we reach the member profile through the gateway?"
 */
export const linkedinStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<LinkedinStatus> => {
    if (!linkedinEnvConfigured()) {
      return { configured: false, connected: false, member: null, expiresSoon: false };
    }
    try {
      const member = await fetchLinkedInMember();
      return {
        configured: true,
        connected: true,
        member: member.name ?? member.email ?? null,
        expiresSoon: false,
      };
    } catch {
      return { configured: true, connected: false, member: null, expiresSoon: false };
    }
  });

const PublishInput = z.object({
  requisitionId: z.string().uuid(),
  text: z.string().min(1).max(3000),
});

/** Publish the designed post text to LinkedIn via the company account. */
export const publishToLinkedIn = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => PublishInput.parse(data))
  .handler(async ({ data, context }) => {
    const { data: requisition } = await context.supabase
      .from("requisitions")
      .select("id")
      .eq("id", data.requisitionId)
      .maybeSingle();
    if (!requisition) throw new Error("Requisition not found.");

    const member = await fetchLinkedInMember();
    const postUrn = await postToLinkedIn(member.sub, data.text.trim());
    return { ok: true as const, postUrn };
  });
