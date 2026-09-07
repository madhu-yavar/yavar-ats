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
  careersEmail: string | null;
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
      careersEmail: null,
      messages: [],
      counts: { total: 0, imported: 0, updated: 0, skipped: 0, errors: 0 },
    };
    const orgId = await myOrgId(context.userId);
    if (!orgId) return empty;

    const db = await admin();
    const { inboxAddress } = await import("./local-inbox.server");
    const { data: org } = await db
      .from("organizations")
      .select("inbox_slug, careers_email")
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
      careersEmail: org?.careers_email ?? null,
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

/**
 * Register (or clear) the organisation's own careers address, e.g. careers@yavar.ai.
 * Mail forwarded from that address is filed against this organisation. The address
 * must belong to the organisation's own company domain, and no other organisation
 * can claim the same one.
 */
export const saveCareersEmail = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ email: z.string().max(320).nullish() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const orgId = await myOrgId(context.userId);
    if (!orgId) throw new Error("You are not part of an organisation.");
    const db = await admin();

    const email = (data.email ?? "").trim().toLowerCase();
    if (!email) {
      const { error } = await db
        .from("organizations")
        .update({ careers_email: null } as never)
        .eq("id", orgId);
      if (error) throw new Error(error.message);
      return { ok: true as const, careersEmail: null };
    }

    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new Error("That does not look like an email address.");
    }

    const { registrableDomain } = await import("./work-email");
    const { data: org } = await db
      .from("organizations")
      .select("email_domain")
      .eq("id", orgId)
      .maybeSingle();
    const own = org?.email_domain ? registrableDomain(org.email_domain) : null;
    if (own && registrableDomain(email) !== own) {
      throw new Error(`Use an address on your own domain (@${own}).`);
    }

    const { data: taken } = await db
      .from("organizations")
      .select("id")
      .ilike("careers_email", email)
      .neq("id", orgId)
      .maybeSingle();
    if (taken) throw new Error("Another organisation has already registered that address.");

    const { error } = await db
      .from("organizations")
      .update({ careers_email: email } as never)
      .eq("id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true as const, careersEmail: email };
  });
