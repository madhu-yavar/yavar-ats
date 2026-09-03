import { createServerFn } from "@tanstack/react-start";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Action inbox for the signed-in user. Everything here is derived live from the
 * database, so a notification disappears as soon as the work behind it is done.
 */

export type Notification = {
  id: string;
  kind: "approval" | "interview" | "offer" | "invite" | "platform" | "stale";
  title: string;
  body: string;
  to: string;
  at: string | null;
  severity: "info" | "warn" | "urgent";
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const myNotifications = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<Notification[]> => {
    const db = await admin();
    const email = (context.claims?.["email"] as string | undefined)?.toLowerCase() ?? null;
    const out: Notification[] = [];

    // Platform super users: tenants waiting for approval.
    if (email) {
      const { data: isSuper } = await db
        .from("platform_admins")
        .select("id")
        .ilike("email", email)
        .maybeSingle();
      if (isSuper) {
        const { data: pending } = await db
          .from("organizations")
          .select("id, name, created_at")
          .eq("status", "pending")
          .order("created_at");
        for (const o of pending ?? [])
          out.push({
            id: `org:${o.id}`,
            kind: "platform",
            title: `${o.name} is awaiting approval`,
            body: "Review the registration and approve or reject the organisation.",
            to: "/platform",
            at: o.created_at,
            severity: "urgent",
          });
      }
    }

    const { data: member } = await db
      .from("org_members")
      .select("org_id, is_owner")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();

    if (member) {
      const orgId = member.org_id;
      const now = Date.now();
      const in7 = new Date(now + 7 * 864e5).toISOString();

      const [reqs, offers, ivs, invites] = await Promise.all([
        db
          .from("requisitions")
          .select("id, code, title, status, created_at")
          .eq("org_id", orgId)
          .in("status", ["pending_dh", "pending_hr", "pending_cbo"]),
        db
          .from("offers")
          .select("id, status, created_at")
          .eq("org_id", orgId)
          .in("status", ["pending_hr", "pending_cbo"]),
        db
          .from("interviews")
          .select("id, interviewer, scheduled_at, status")
          .eq("org_id", orgId)
          .eq("status", "scheduled")
          .not("scheduled_at", "is", null)
          .lte("scheduled_at", in7)
          .order("scheduled_at"),
        member.is_owner
          ? db.from("org_members").select("id, email, created_at").eq("org_id", orgId).eq("status", "invited")
          : Promise.resolve({ data: [] as { id: string; email: string; created_at: string }[] }),
      ]);

      for (const r of reqs.data ?? [])
        out.push({
          id: `req:${r.id}`,
          kind: "approval",
          title: `${r.code} · ${r.title} needs approval`,
          body: `Requisition is waiting at ${r.status.replace("pending_", "").toUpperCase()}.`,
          to: "/requisitions",
          at: r.created_at,
          severity: "urgent",
        });

      if ((offers.data ?? []).length)
        out.push({
          id: "offers:pending",
          kind: "offer",
          title: `${(offers.data ?? []).length} offer(s) awaiting approval`,
          body: "Review compensation and release the offer.",
          to: "/offers",
          at: (offers.data ?? [])[0]?.created_at ?? null,
          severity: "warn",
        });

      for (const iv of (ivs.data ?? []).slice(0, 8)) {
        const when = iv.scheduled_at ? new Date(iv.scheduled_at) : null;
        const soon = when ? when.getTime() - now < 864e5 : false;
        out.push({
          id: `iv:${iv.id}`,
          kind: "interview",
          title: `Interview ${when ? when.toLocaleString() : "scheduled"}`,
          body: `${iv.interviewer ?? "Interviewer"} — scorecard due after the session.`,
          to: "/interviews",
          at: iv.scheduled_at,
          severity: soon ? "urgent" : "info",
        });
      }

      for (const i of invites.data ?? [])
        out.push({
          id: `inv:${i.id}`,
          kind: "invite",
          title: `${i.email} has not signed in yet`,
          body: "The invitation is still unclaimed.",
          to: "/team",
          at: i.created_at,
          severity: "info",
        });
    }

    const rank = { urgent: 0, warn: 1, info: 2 } as const;
    return out.sort((a, b) => rank[a.severity] - rank[b.severity] || (a.at ?? "").localeCompare(b.at ?? ""));
  });
