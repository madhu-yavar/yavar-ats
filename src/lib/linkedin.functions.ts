import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const GATEWAY = "https://connector-gateway.lovable.dev/linkedin";

export type LinkedinManagedStatus = {
  /** True when the workspace-level one-click LinkedIn sign-in is wired up. */
  available: boolean;
  connected: boolean;
  /** Display name of the signed-in LinkedIn account, when readable. */
  member: string | null;
  message: string;
};

/**
 * One-click ("sign in with LinkedIn") status. No client id/secret pasting:
 * the connection is authorised once through LinkedIn's own sign-in screen and
 * the access token is held and refreshed outside the app.
 */
export const linkedinManagedStatus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async (): Promise<LinkedinManagedStatus> => {
    const lovableKey = process.env["LOVABLE_API_KEY"];
    const linkedinKey = process.env["LINKEDIN_API_KEY"];
    if (!lovableKey || !linkedinKey) {
      return {
        available: false,
        connected: false,
        member: null,
        message: "One-click LinkedIn sign-in is not set up for this workspace yet.",
      };
    }

    try {
      const res = await fetch(`${GATEWAY}/v2/userinfo`, {
        headers: {
          Authorization: `Bearer ${lovableKey}`,
          "X-Connection-Api-Key": linkedinKey,
        },
      });
      const text = await res.text();
      if (!res.ok) {
        console.error(`LinkedIn userinfo failed [${res.status}]: ${text}`);
        return {
          available: true,
          connected: false,
          member: null,
          message: `LinkedIn refused the connection [${res.status}]: ${text.slice(0, 200)}`,
        };
      }
      const body = JSON.parse(text) as { name?: string; email?: string };
      const member = body.name ?? body.email ?? null;
      return {
        available: true,
        connected: true,
        member,
        message: member
          ? `Signed in as ${member}. Sign-in is a one-time step — the app keeps the session alive.`
          : "LinkedIn sign-in is active.",
      };
    } catch (e) {
      return {
        available: true,
        connected: false,
        member: null,
        message: `LinkedIn unreachable: ${(e as Error).message}`,
      };
    }
  });
