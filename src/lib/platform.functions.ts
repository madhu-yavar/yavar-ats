import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Platform (product owner) layer. A super user is anyone whose email address is on the
 * `platform_admins` allowlist. The very first admin is claimed once, while the allowlist
 * is still empty, so the product owner can bootstrap without touching SQL.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type PlatformOrg = {
  id: string;
  name: string;
  slug: string;
  industry: string | null;
  hqCity: string | null;
  hqCountry: string | null;
  currency: string;
  status: string;
  createdAt: string;
  archivedAt: string | null;
  approvedAt: string | null;
  rejectionReason: string | null;

  members: number;
  requisitions: number;
  openRequisitions: number;
  candidates: number;
  applications: number;
  interviews: number;
  offers: number;
  hires: number;
  lastActivityAt: string | null;
};

export type PlatformState = {
  isSuperUser: boolean;
  claimable: boolean;
  email: string | null;
};

function emailOf(claims: Record<string, unknown> | null | undefined) {
  const email = (claims?.["email"] as string | undefined) ?? null;
  return email ? email.toLowerCase() : null;
}

async function superEmailOrThrow(context: { userId: string; claims?: Record<string, unknown> | null }) {
  const email = emailOf(context.claims);
  if (!email) throw new Error("Your account has no email address.");
  const db = await admin();
  const { data } = await db.from("platform_admins").select("id, email").ilike("email", email).maybeSingle();
  if (!data) throw new Error("Super-user access only.");
  return email;
}

/** Is the signed-in user a platform super user, and can super access still be claimed? */
export const platformState = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformState> => {
    const email = emailOf(context.claims);
    const db = await admin();
    const { count } = await db.from("platform_admins").select("id", { count: "exact", head: true });
    let isSuperUser = false;
    if (email) {
      const { data } = await db.from("platform_admins").select("id").ilike("email", email).maybeSingle();
      isSuperUser = Boolean(data);
    }
    return { isSuperUser, claimable: (count ?? 0) === 0, email };
  });

/** One-time bootstrap: the first signed-in user to claim it becomes the product owner. */
export const claimSuperUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const email = emailOf(context.claims);
    if (!email) throw new Error("Your account has no email address.");
    const db = await admin();
    const { count } = await db.from("platform_admins").select("id", { count: "exact", head: true });
    if ((count ?? 0) > 0) throw new Error("Super-user access has already been claimed.");
    const { error } = await db
      .from("platform_admins")
      .insert({ email, user_id: context.userId, note: "Bootstrapped product owner", created_by: context.userId });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const listPlatformAdmins = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await superEmailOrThrow(context);
    const db = await admin();
    const { data, error } = await db
      .from("platform_admins")
      .select("id, email, note, created_at")
      .order("created_at");
    if (error) throw new Error(error.message);
    return (data ?? []).map((a) => ({ id: a.id, email: a.email, note: a.note, createdAt: a.created_at }));
  });

export const addPlatformAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ email: z.string().email(), note: z.string().max(160).default("") }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await superEmailOrThrow(context);
    const db = await admin();
    const { error } = await db
      .from("platform_admins")
      .insert({ email: data.email.toLowerCase(), note: data.note.trim() || null, created_by: context.userId });
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? "That email is already a super user." : error.message);
    return { ok: true };
  });

export const removePlatformAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ id: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const email = await superEmailOrThrow(context);
    const db = await admin();
    const { data: row } = await db.from("platform_admins").select("id, email").eq("id", data.id).maybeSingle();
    if (!row) throw new Error("Super user not found.");
    if (row.email.toLowerCase() === email) throw new Error("You cannot remove your own super-user access.");
    const { error } = await db.from("platform_admins").delete().eq("id", data.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Every registered organisation with its live usage statistics. */
export const listAllOrganizations = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PlatformOrg[]> => {
    await superEmailOrThrow(context);
    const db = await admin();

    const [orgs, members, reqs, cands, apps, ivs, offers] = await Promise.all([
      db.from("organizations").select("*").order("created_at", { ascending: false }),
      db.from("org_members").select("org_id, status"),
      db.from("requisitions").select("org_id, status"),
      db.from("candidates").select("org_id"),
      db.from("applications").select("org_id, stage, last_activity_at"),
      db.from("interviews").select("org_id"),
      db.from("offers").select("org_id, status"),
    ]);
    if (orgs.error) throw new Error(orgs.error.message);

    const count = <T extends { org_id: string | null }>(rows: T[] | null, id: string, pred?: (r: T) => boolean) =>
      (rows ?? []).filter((r) => r.org_id === id && (!pred || pred(r))).length;

    return (orgs.data ?? []).map((o) => {
      const orgApps = (apps.data ?? []).filter((a) => a.org_id === o.id);
      const last = orgApps
        .map((a) => a.last_activity_at)
        .filter(Boolean)
        .sort()
        .pop();
      return {
        id: o.id,
        name: o.name,
        slug: o.slug,
        industry: o.industry,
        hqCity: o.hq_city,
        hqCountry: o.hq_country,
        currency: o.currency,
        status: (o as { status?: string }).status ?? "active",
        createdAt: o.created_at,
        archivedAt: (o as { archived_at?: string | null }).archived_at ?? null,
        approvedAt: (o as { approved_at?: string | null }).approved_at ?? null,
        rejectionReason: (o as { rejection_reason?: string | null }).rejection_reason ?? null,

        members: count(members.data, o.id),
        requisitions: count(reqs.data, o.id),
        openRequisitions: count(reqs.data, o.id, (r) => r.status === "approved"),
        candidates: count(cands.data, o.id),
        applications: orgApps.length,
        interviews: count(ivs.data, o.id),
        offers: count(offers.data, o.id),
        hires: orgApps.filter((a) => a.stage === "joined" || a.stage === "hired").length,
        lastActivityAt: (last as string | undefined) ?? null,
      };
    });
  });

/** Archive or restore a tenant. Archiving locks members out but keeps every record. */
export const setOrganizationStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        status: z.enum(["active", "archived"]),
        reason: z.string().max(300).default(""),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await superEmailOrThrow(context);
    const db = await admin();
    const { error } = await db
      .from("organizations")
      .update({
        status: data.status,
        archived_at: data.status === "archived" ? new Date().toISOString() : null,
        archived_reason: data.status === "archived" ? data.reason.trim() || null : null,
      })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Permanently delete a tenant and every record inside it. Irreversible — the console
 * requires the exact organisation name to be typed before calling this.
 */
export const deleteOrganizationAsSuperUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ orgId: z.string().uuid(), confirmName: z.string().min(1) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await superEmailOrThrow(context);
    const db = await admin();

    const { data: org } = await db.from("organizations").select("id, name").eq("id", data.orgId).maybeSingle();
    if (!org) throw new Error("Organisation not found.");
    if (org.name.trim().toLowerCase() !== data.confirmName.trim().toLowerCase())
      throw new Error("The typed organisation name does not match.");

    // Children first: leaf tables, then their parents, so no foreign key is orphaned.
    const ordered = [
      "ai_interviews",
      "evaluations",
      "match_scores",
      "offers",
      "stage_events",
      "interviews",
      "applications",
      "candidate_assessments",
      "candidate_verifications",
      "social_profiles",
      "candidates",
      "job_descriptions",
      "requisitions",
      "departments",
      "master_items",
      "integration_credentials",
      "source_integrations",
      "ai_provider_credentials",
      "ai_settings",
      "copilot_messages",
      "user_roles",
      "org_members",
    ] as const;

    for (const table of ordered) {
      const { error } = await db.from(table).delete().eq("org_id", data.orgId);
      if (error) throw new Error(`${table}: ${error.message}`);
    }

    const { error } = await db.from("organizations").delete().eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Super users can correct any tenant's profile fields. */
export const updateOrganizationAsSuperUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        name: z.string().min(2).max(120),
        industry: z.string().max(80).default(""),
        hqCity: z.string().max(80).default(""),
        hqCountry: z.string().max(80).default(""),
        currency: z.string().max(8).default("INR"),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await superEmailOrThrow(context);
    const db = await admin();
    const { error } = await db
      .from("organizations")
      .update({
        name: data.name.trim(),
        industry: data.industry.trim() || null,
        hq_city: data.hqCity.trim() || null,
        hq_country: data.hqCountry.trim() || null,
        currency: data.currency.trim() || "INR",
      })
      .eq("id", data.orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Roster of one tenant, so a super user can fix or remove a user in any organisation. */
export const listOrgUsersAsSuperUser = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ orgId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await superEmailOrThrow(context);
    const db = await admin();
    const { data: rows, error } = await db
      .from("org_members")
      .select("id, email, full_name, title, status, is_owner, invited_role, joined_at")
      .eq("org_id", data.orgId)
      .order("created_at");
    if (error) throw new Error(error.message);
    return (rows ?? []).map((m) => ({
      id: m.id,
      email: m.email,
      fullName: m.full_name,
      title: m.title,
      status: m.status,
      isOwner: m.is_owner,
      joinedAt: m.joined_at,
    }));
  });

/** Hard-delete a membership from any organisation (super user override, owners included). */
export const deleteOrgUserAsSuperUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ memberId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    await superEmailOrThrow(context);
    const db = await admin();
    const { data: member } = await db
      .from("org_members")
      .select("id, org_id, user_id")
      .eq("id", data.memberId)
      .maybeSingle();
    if (!member) throw new Error("Member not found.");
    if (member.user_id)
      await db.from("user_roles").delete().eq("user_id", member.user_id).eq("org_id", member.org_id);
    const { error } = await db.from("org_members").delete().eq("id", member.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Approve or reject a freshly registered tenant. Nothing inside a pending organisation
 * works until a super admin approves it, and only then can it invite internal users.
 */
export const reviewOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        orgId: z.string().uuid(),
        decision: z.enum(["approve", "reject"]),
        reason: z.string().max(300).default(""),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    await superEmailOrThrow(context);
    const db = await admin();
    const now = new Date().toISOString();
    const patch =
      data.decision === "approve"
        ? {
            status: "active",
            approved_at: now,
            approved_by: context.userId,
            rejected_at: null,
            rejection_reason: null,
            onboarding_step: "done",
            onboarded_at: now,
          }
        : {
            status: "rejected",
            rejected_at: now,
            rejection_reason: data.reason.trim() || "Registration rejected by the platform team.",
            approved_at: null,
          };
    const { error } = await db.from("organizations").update(patch).eq("id", data.orgId);
    if (error) throw new Error(error.message);

    // Acknowledge the decision to the registering owner, with next steps.
    try {
      const { data: org } = await db
        .from("organizations")
        .select("name")
        .eq("id", data.orgId)
        .maybeSingle();
      const { data: owner } = await db
        .from("org_members")
        .select("email, full_name")
        .eq("org_id", data.orgId)
        .eq("is_owner", true)
        .maybeSingle();
      if (owner?.email && org?.name) {
        const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
        await sendTemplateEmail(
          data.decision === "approve" ? "org-approved" : "org-rejected",
          owner.email,
          {
            templateData: {
              orgName: org.name,
              ownerName: owner.full_name ?? undefined,
              ...(data.decision === "reject"
                ? { reason: patch.rejection_reason ?? undefined }
                : {}),
            },
            idempotencyKey: `org-${data.decision}-${data.orgId}`,
          },
        );
      }
    } catch (mailError) {
      console.error("Organisation decision email failed", mailError);
    }

    return { ok: true };
  });
