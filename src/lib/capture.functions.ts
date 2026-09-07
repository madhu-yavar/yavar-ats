/**
 * Organisation-facing settings for the browser companion: the capture key it
 * signs with, and a short history of what it has brought in.
 */
import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type CaptureEvent = {
  id: string;
  kind: string;
  title: string | null;
  status: string;
  detail: string | null;
  sourceUrl: string | null;
  createdAt: string;
};

export type CaptureSetup = {
  token: string | null;
  endpoint: string;
  events: CaptureEvent[];
};

async function myOrgId(userId: string): Promise<string | null> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data } = await supabaseAdmin
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}

function endpointBase(): string {
  return process.env["PUBLIC_SITE_URL"] ?? "https://atsiq.yavar.ai";
}

async function loadSetup(orgId: string): Promise<CaptureSetup> {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data: org } = await supabaseAdmin
    .from("organizations")
    .select("capture_token")
    .eq("id", orgId)
    .maybeSingle();
  const { data: events } = await supabaseAdmin
    .from("capture_events")
    .select("id, kind, title, status, detail, source_url, created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);
  return {
    token: org?.capture_token ?? null,
    endpoint: `${endpointBase()}/api/public/capture`,
    events: (events ?? []).map((e) => ({
      id: e.id,
      kind: e.kind,
      title: e.title,
      status: e.status,
      detail: e.detail,
      sourceUrl: e.source_url,
      createdAt: e.created_at,
    })),
  };
}

export const captureSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CaptureSetup> => {
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation yet.");
    return loadSetup(orgId);
  });

export const rotateCaptureToken = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<CaptureSetup> => {
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation yet.");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const bytes = new Uint8Array(24);
    crypto.getRandomValues(bytes);
    const token = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const { error } = await supabaseAdmin
      .from("organizations")
      .update({ capture_token: token } as never)
      .eq("id", orgId);
    if (error) throw new Error(error.message);
    return loadSetup(orgId);
  });
