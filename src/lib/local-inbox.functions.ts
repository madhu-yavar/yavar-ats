/**
 * Server functions for the organisation's own careers inbox: the address, the
 * mail that has arrived, and the manual retry / remove actions.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type InboxRow = {
  id: string;
  from_email: string | null;
  from_name: string | null;
  subject: string | null;
  attachment_name: string | null;
  status: string;
  detail: string | null;
  candidate_id: string | null;
  requisition_id: string | null;
  received_at: string;
};

export type InboxView = {
  address: string | null;
  slug: string | null;
  messages: InboxRow[];
  counts: { total: number; imported: number; updated: number; skipped: number; errors: number };
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function myOrgId(userId: string): Promise<string | null> {
  const db = await admin();
  const { data } = await db
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  return data?.org_id ?? null;
}

export const orgInbox = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<InboxView> => {
    const empty: InboxView = {
      address: null,
      slug: null,
      messages: [],
      counts: { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 },
    };
    const orgId = await myOrgId(context.userId);
    if (!orgId) return empty;

    const db = await admin();
    const { inboxAddress } = await import("./local-inbox.server");
    const { data: org } = await db
      .from("organizations")
      .select("inbox_slug")
      .eq("id", orgId)
      .maybeSingle();
    const { data: rows } = await db
      .from("inbox_messages")
      .select(
        "id, from_email, from_name, subject, attachment_name, status, detail, candidate_id, requisition_id, received_at",
      )
      .eq("org_id", orgId)
      .order("received_at", { ascending: false })
      .limit(500);

    const messages = (rows ?? []) as InboxRow[];
    return {
      slug: org?.inbox_slug ?? null,
      address: inboxAddress(org?.inbox_slug),
      messages,
      counts: {
        total: messages.length,
        imported: messages.filter((m) => m.status === "imported").length,
        updated: messages.filter((m) => m.status === "updated").length,
        skipped: messages.filter((m) => m.status === "skipped").length,
        errors: messages.filter((m) => m.status === "error").length,
      },
    };
  });

export const retryInboxMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ messageId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation.");
    const { retryMessage } = await import("./local-inbox.server");
    return retryMessage(orgId, data.messageId);
  });

export const removeInboxMessage = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ messageId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation.");
    const db = await admin();
    const { error } = await db
      .from("inbox_messages")
      .delete()
      .eq("id", data.messageId)
      .eq("org_id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });
