import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { registrableDomain, workEmailProblem } from "@/lib/work-email";

export type AppRole = "recruiter" | "hiring_manager" | "department_head" | "hr_head" | "president_cbo";

const ROLES = [
  "recruiter",
  "hiring_manager",
  "department_head",
  "hr_head",
  "president_cbo",
] as const;

export type Organization = {
  id: string;
  name: string;
  slug: string;
  legal_name: string | null;
  industry: string | null;
  hq_country: string | null;
  hq_city: string | null;
  employee_band: string | null;
  currency: string;
  fiscal_year_start_month: number;
  careers_email: string | null;
  onboarding_step: string;
  onboarded_at: string | null;
  status?: string;
  archived_at?: string | null;
  rejection_reason?: string | null;
  approved_at?: string | null;

};

export type OrgMember = {
  id: string;
  userId: string | null;
  email: string;
  fullName: string | null;
  title: string | null;
  status: string;
  isOwner: boolean;
  invitedRole: AppRole | null;
  roles: AppRole[];
  createdAt: string;
  joinedAt: string | null;
};

export type MyOrg = {
  org: Organization | null;
  membership: { id: string; isOwner: boolean; status: string } | null;
  roles: AppRole[];
};

const ROLE_LABELS: Record<AppRole, string> = {
  recruiter: "Recruiter",
  hiring_manager: "Hiring manager",
  department_head: "Department head",
  hr_head: "HR head",
  president_cbo: "President / CBO",
};

/**
 * Tell an invited colleague they now have access. Best-effort: the roster entry
 * is already saved, so a mail failure must never fail the invitation.
 */
async function notifyInvitedMember(args: {
  email: string;
  orgName: string;
  role: AppRole;
  title?: string | null;
  inviteeName?: string | null;
  inviterName?: string | null;
  memberId?: string | null;
}) {
  try {
    const { sendTemplateEmail } = await import("@/lib/email-templates/send-email");
    await sendTemplateEmail("member-invited", args.email, {
      idempotencyKey: `member-invited:${args.memberId ?? args.email}`,
      templateData: {
        orgName: args.orgName,
        roleLabel: ROLE_LABELS[args.role],
        title: args.title ?? undefined,
        inviteeName: args.inviteeName ?? undefined,
        inviterName: args.inviterName ?? undefined,
        email: args.email,
      },
    });
  } catch (e) {
    console.error("invitation email failed", args.email, e);
  }
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

function slugify(name: string) {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${base || "org"}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * The signed-in user's organisation. Also claims any invitation that was sent
 * to their email address, so an invited HR user lands straight in the workspace.
 */
export const myOrg = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<MyOrg> => {
    const db = await admin();
    const email = (context.claims?.email as string | undefined)?.toLowerCase() ?? null;

    let { data: member } = await db
      .from("org_members")
      .select("id, org_id, is_owner, status, invited_role")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .order("created_at")
      .limit(1)
      .maybeSingle();

    // Pending invitation for this email → claim it.
    if (!member && email) {
      const { data: invite } = await db
        .from("org_members")
        .select("id, org_id, is_owner, status, invited_role")
        .ilike("email", email)
        .is("user_id", null)
        .order("created_at")
        .limit(1)
        .maybeSingle();

      if (invite) {
        // Invitations only convert into real users once the tenant is approved and live.
        const { data: inviteOrg } = await db
          .from("organizations")
          .select("status")
          .eq("id", invite.org_id)
          .maybeSingle();
        if ((inviteOrg?.status ?? "active") === "active") {
          await db
            .from("org_members")
            .update({ user_id: context.userId, status: "active", joined_at: new Date().toISOString() })
            .eq("id", invite.id);
          if (invite.invited_role) {
            await db
              .from("user_roles")
              .insert({ user_id: context.userId, role: invite.invited_role, org_id: invite.org_id });
          }
          member = { ...invite, status: "active" };
        } else {
          member = invite;
        }
      }

    }

    if (!member) return { org: null, membership: null, roles: [] };

    const [{ data: org }, { data: roles }] = await Promise.all([
      db.from("organizations").select("*").eq("id", member.org_id).maybeSingle(),
      db.from("user_roles").select("role").eq("user_id", context.userId).eq("org_id", member.org_id),
    ]);

    return {
      org: (org as Organization) ?? null,
      membership: { id: member.id, isOwner: member.is_owner, status: member.status },
      roles: (roles ?? []).map((r) => r.role as AppRole),
    };
  });

const CreateInput = z.object({
  name: z.string().trim().min(2).max(120),
  legalName: z.string().trim().min(2, "Registered legal name is required").max(160),
  industry: z.string().trim().min(2, "Industry is required").max(80),
  hqCountry: z.string().trim().min(2, "HQ country is required").max(80),
  hqCity: z.string().trim().min(2, "HQ city is required").max(80),
  employeeBand: z.string().trim().min(1, "Headcount band is required").max(40),
  currency: z.string().trim().min(1).max(8).default("INR"),
  fiscalYearStartMonth: z.number().int().min(1).max(12).default(4),
  careersEmail: z.string().trim().email("A valid careers inbox is required").max(160),
  departments: z
    .array(z.object({ name: z.string().min(1).max(120), headName: z.string().max(120).default("") }))
    .min(1, "Add at least one department"),
  locations: z.array(z.string().min(1).max(120)).min(1, "Add at least one hiring location"),
  invites: z
    .array(z.object({ email: z.string().email(), role: z.enum(ROLES), title: z.string().max(120).default("") }))
    .default([]),
});


/**
 * Stand up a brand-new organisation: the creator becomes owner + CHRO admin,
 * departments and locations are seeded, and colleagues are invited by email.
 */
export const createOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => CreateInput.parse(data))
  .handler(async ({ data, context }) => {
    const db = await admin();
    const email = (context.claims?.email as string | undefined) ?? `${context.userId}@user`;

    // Only a verified corporate mailbox can register a tenant: the address must be
    // confirmed by the auth service and must not be a personal or disposable domain.
    if (!context.claims?.["email_confirmed_at"] && context.claims?.["email_verified"] === false)
      throw new Error("Confirm your work email address before registering an organisation.");
    const problem = workEmailProblem(email);
    if (problem) throw new Error(problem);

    const { data: existing } = await db
      .from("org_members")
      .select("org_id")
      .eq("user_id", context.userId)
      .eq("status", "active")
      .maybeSingle();
    if (existing) throw new Error("You already belong to an organisation.");

    // One company domain = one tenant. Every subdomain of the same company
    // (abc.as.com, sdf.as.com) collapses to the same registrable domain, so a
    // second registration is refused and the person must be invited instead.
    const companyDomain = registrableDomain(email);
    const { data: claimed } = await db
      .from("organizations")
      .select("id, name, status")
      .eq("email_domain", companyDomain)
      .in("status", ["pending", "active"])
      .limit(1)
      .maybeSingle();
    if (claimed)
      throw new Error(
        claimed.status === "pending"
          ? `${companyDomain} is already registered as "${claimed.name}" and is awaiting platform approval. Ask that organisation's owner to invite you instead.`
          : `${companyDomain} already has an organisation on ATSIQ ("${claimed.name}"). Ask its owner to invite you from Users, roles & access control.`,
      );

    // The tenant's own careers address: yavar.ai -> yavar@careers.atsiq.yavar.ai
    let inboxSlug =
      companyDomain.split(".")[0]?.replace(/[^a-z0-9-]+/g, "-") ||
      data.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 28) ||
      "org";
    for (let attempt = 2; attempt < 30; attempt++) {
      const { data: taken } = await db
        .from("organizations")
        .select("id")
        .ilike("inbox_slug", inboxSlug)
        .limit(1)
        .maybeSingle();
      if (!taken) break;
      inboxSlug = `${inboxSlug.replace(/-\d+$/, "")}-${attempt}`;
    }

    const { data: org, error } = await db
      .from("organizations")
      .insert({
        email_domain: companyDomain,

        name: data.name.trim(),
        slug: slugify(data.name),
        inbox_slug: inboxSlug,

        legal_name: data.legalName.trim() || null,
        industry: data.industry.trim() || null,
        hq_country: data.hqCountry.trim() || null,
        hq_city: data.hqCity.trim() || null,
        employee_band: data.employeeBand.trim() || null,
        currency: data.currency.trim() || "INR",
        fiscal_year_start_month: data.fiscalYearStartMonth,
        careers_email: data.careersEmail.trim() || null,
        onboarding_step: "pending_approval",
        onboarded_at: null,
        // Every new tenant waits for a platform super admin to approve it.
        status: "pending",
        created_by: context.userId,

      })
      .select("*")
      .single();
    if (error) throw new Error(error.message);

    await db.from("org_members").insert({
      org_id: org.id,
      user_id: context.userId,
      email,
      status: "active",
      is_owner: true,
      joined_at: new Date().toISOString(),
    });
    await db.from("user_roles").insert({ user_id: context.userId, role: "president_cbo", org_id: org.id });

    const departments = data.departments.filter((d) => d.name.trim());
    if (departments.length) {
      await db.from("departments").insert(
        departments.map((d) => ({
          org_id: org.id,
          name: d.name.trim(),
          head_name: d.headName.trim() || null,
        })),
      );
    }

    const locations = data.locations.map((l) => l.trim()).filter(Boolean);
    if (locations.length) {
      await db.from("master_items").insert(
        locations.map((name, i) => ({ org_id: org.id, kind: "location", name, sort_order: i })),
      );
    }

    for (const invite of data.invites) {
      if (invite.email.toLowerCase() === email.toLowerCase()) continue;
      // Internal users only: colleagues must be on the organisation's own domain.
      if (registrableDomain(invite.email) !== registrableDomain(email))
        throw new Error(`${invite.email} is not on the ${registrableDomain(email)} domain.`);
      const { data: row } = await db
        .from("org_members")
        .insert({
          org_id: org.id,
          email: invite.email.toLowerCase(),
          title: invite.title.trim() || null,
          invited_role: invite.role,
          invited_by: context.userId,
          status: "invited",
        })
        .select("id")
        .maybeSingle();
      await notifyInvitedMember({
        email: invite.email.toLowerCase(),
        orgName: org.name as string,
        role: invite.role,
        title: invite.title.trim() || null,
        memberId: row?.id ?? null,
      });
    }

    return { ok: true, orgId: org.id as string };
  });

async function assertOwner(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("org_members")
    .select("org_id, is_owner")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("You do not belong to an organisation yet.");
  if (!data.is_owner) throw new Error("Only an organisation owner can do this.");
  return data.org_id as string;
}

/**
 * User administration is not owner-only: the organisation owner and anyone
 * holding the President/CBO (CHRO admin) role can invite colleagues and
 * grant or revoke approval roles.
 */
async function assertAdmin(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("org_members")
    .select("org_id, is_owner")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("You do not belong to an organisation yet.");
  if (data.is_owner) return data.org_id as string;
  const { data: role } = await db
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("org_id", data.org_id)
    .eq("role", "president_cbo")
    .maybeSingle();
  if (!role) throw new Error("Only the organisation owner or a President/CBO admin can manage users and roles.");
  return data.org_id as string;
}


export async function orgOf(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("org_members")
    .select("org_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .maybeSingle();
  if (!data) throw new Error("You do not belong to an organisation yet.");
  return data.org_id as string;
}

export const updateOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        name: z.string().min(2).max(120).optional(),
        legalName: z.string().max(160).optional(),
        industry: z.string().max(80).optional(),
        hqCountry: z.string().max(80).optional(),
        hqCity: z.string().max(80).optional(),
        employeeBand: z.string().max(40).optional(),
        currency: z.string().max(8).optional(),
        fiscalYearStartMonth: z.number().int().min(1).max(12).optional(),
        careersEmail: z.string().max(160).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertOwner(context.userId);
    const db = await admin();
    type OrgPatch = {
      name?: string;
      legal_name?: string | null;
      industry?: string | null;
      hq_country?: string | null;
      hq_city?: string | null;
      employee_band?: string | null;
      currency?: string;
      fiscal_year_start_month?: number;
      careers_email?: string | null;
    };
    const patch: OrgPatch = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.legalName !== undefined) patch.legal_name = data.legalName.trim() || null;
    if (data.industry !== undefined) patch.industry = data.industry.trim() || null;
    if (data.hqCountry !== undefined) patch.hq_country = data.hqCountry.trim() || null;
    if (data.hqCity !== undefined) patch.hq_city = data.hqCity.trim() || null;
    if (data.employeeBand !== undefined) patch.employee_band = data.employeeBand.trim() || null;
    if (data.currency !== undefined) patch.currency = data.currency.trim() || "INR";
    if (data.fiscalYearStartMonth !== undefined) patch.fiscal_year_start_month = data.fiscalYearStartMonth;
    if (data.careersEmail !== undefined) patch.careers_email = data.careersEmail.trim() || null;

    const { error } = await db.from("organizations").update(patch).eq("id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Everyone in the organisation, invited or active, with their granted roles. */
export const listMembers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OrgMember[]> => {
    const orgId = await orgOf(context.userId);
    const db = await admin();
    const [{ data: members, error }, { data: roles }] = await Promise.all([
      db
        .from("org_members")
        .select("id, user_id, email, full_name, title, status, is_owner, invited_role, created_at, joined_at")
        .eq("org_id", orgId)
        .order("created_at"),
      db.from("user_roles").select("user_id, role").eq("org_id", orgId),
    ]);
    if (error) throw new Error(error.message);

    return (members ?? []).map((m) => ({
      id: m.id,
      userId: m.user_id,
      email: m.email,
      fullName: m.full_name,
      title: m.title,
      status: m.status,
      isOwner: m.is_owner,
      invitedRole: (m.invited_role as AppRole | null) ?? null,
      createdAt: m.created_at,
      joinedAt: m.joined_at,
      roles: (roles ?? []).filter((r) => r.user_id && r.user_id === m.user_id).map((r) => r.role as AppRole),
    }));
  });

export const inviteMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        email: z.string().email(),
        role: z.enum(ROLES),
        title: z.string().max(120).default(""),
        fullName: z.string().max(120).default(""),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertAdmin(context.userId);
    const db = await admin();
    const { data: org } = await db.from("organizations").select("status").eq("id", orgId).maybeSingle();
    if ((org?.status ?? "active") !== "active")
      throw new Error("Your organisation is not approved yet — internal users can be added after approval.");
    const email = data.email.toLowerCase();
    const problem = workEmailProblem(email);
    if (problem) throw new Error(problem);

    // The owner's verified domain defines who counts as an internal user.
    const { data: owner } = await db
      .from("org_members")
      .select("email")
      .eq("org_id", orgId)
      .eq("is_owner", true)
      .limit(1)
      .maybeSingle();
    if (owner?.email && registrableDomain(owner.email) !== registrableDomain(email))
      throw new Error(`Only ${registrableDomain(owner.email)} addresses can be invited into this organisation.`);

    const { data: existingUser } = await db
      .from("org_members")
      .select("id")
      .eq("org_id", orgId)
      .ilike("email", email)
      .maybeSingle();
    if (existingUser) throw new Error("That email is already on the roster.");

    const { data: row, error } = await db
      .from("org_members")
      .insert({
        org_id: orgId,
        email,
        full_name: data.fullName.trim() || null,
        title: data.title.trim() || null,
        invited_role: data.role,
        invited_by: context.userId,
        status: "invited",
      })
      .select("id")
      .maybeSingle();
    if (error) throw new Error(error.message);

    const [{ data: orgRow }, { data: inviter }] = await Promise.all([
      db.from("organizations").select("name").eq("id", orgId).maybeSingle(),
      db.from("org_members").select("full_name, email").eq("user_id", context.userId).eq("org_id", orgId).maybeSingle(),
    ]);
    await notifyInvitedMember({
      email,
      orgName: (orgRow?.name as string | undefined) ?? "your organisation",
      role: data.role,
      title: data.title.trim() || null,
      inviteeName: data.fullName.trim() || null,
      inviterName: inviter?.full_name ?? inviter?.email ?? null,
      memberId: row?.id ?? null,
    });
    return { ok: true, notified: true };
  });

export const setMemberRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ memberId: z.string().uuid(), role: z.enum(ROLES), grant: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertAdmin(context.userId);
    const db = await admin();
    const { data: member } = await db
      .from("org_members")
      .select("id, user_id, org_id, is_owner")
      .eq("id", data.memberId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!member) throw new Error("Member not found in your organisation.");

    // Not signed up yet → adjust the role they will receive on first sign-in.
    if (!member.user_id) {
      await db
        .from("org_members")
        .update({ invited_role: data.grant ? data.role : null })
        .eq("id", member.id);
      return { ok: true };
    }

    if (data.grant) {
      const { error } = await db
        .from("user_roles")
        .insert({ user_id: member.user_id, role: data.role, org_id: orgId });
      if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    } else {
      if (member.user_id === context.userId && data.role === "president_cbo")
        throw new Error("You cannot revoke your own CHRO access.");
      const { error } = await db
        .from("user_roles")
        .delete()
        .eq("user_id", member.user_id)
        .eq("role", data.role)
        .eq("org_id", orgId);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });

export const setMemberStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ memberId: z.string().uuid(), status: z.enum(["active", "disabled"]) }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertAdmin(context.userId);
    const db = await admin();
    const { data: member } = await db
      .from("org_members")
      .select("id, user_id, is_owner")
      .eq("id", data.memberId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!member) throw new Error("Member not found in your organisation.");
    if (member.user_id === context.userId) throw new Error("You cannot change your own access.");
    if (member.is_owner) throw new Error("Transfer ownership before disabling an owner.");

    const { error } = await db.from("org_members").update({ status: data.status }).eq("id", member.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const removeMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ memberId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await assertOwner(context.userId);
    const db = await admin();
    const { data: member } = await db
      .from("org_members")
      .select("id, user_id, is_owner")
      .eq("id", data.memberId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!member) throw new Error("Member not found in your organisation.");
    if (member.is_owner) throw new Error("An owner cannot be removed.");
    if (member.user_id === context.userId) throw new Error("You cannot remove yourself.");

    if (member.user_id) await db.from("user_roles").delete().eq("user_id", member.user_id).eq("org_id", orgId);
    const { error } = await db.from("org_members").delete().eq("id", member.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** The owner can correct a member's display name, title and (pre-signup) email. */
export const updateMember = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        memberId: z.string().uuid(),
        fullName: z.string().max(120).default(""),
        title: z.string().max(120).default(""),
        email: z.string().email().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertAdmin(context.userId);
    const db = await admin();
    const { data: member } = await db
      .from("org_members")
      .select("id, user_id")
      .eq("id", data.memberId)
      .eq("org_id", orgId)
      .maybeSingle();
    if (!member) throw new Error("Member not found in your organisation.");

    const patch: { full_name: string | null; title: string | null; email?: string } = {
      full_name: data.fullName.trim() || null,
      title: data.title.trim() || null,
    };
    // Changing the email only makes sense while the invitation is unclaimed.
    if (data.email && !member.user_id) patch.email = data.email.toLowerCase();

    const { error } = await db.from("org_members").update(patch).eq("id", member.id);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** An owner can archive their own organisation: everyone loses access, records are kept. */
export const archiveOwnOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ reason: z.string().max(300).default("") }).parse(data))
  .handler(async ({ data, context }) => {
    const orgId = await assertOwner(context.userId);
    const db = await admin();
    const { error } = await db
      .from("organizations")
      .update({
        status: "archived",
        archived_at: new Date().toISOString(),
        archived_reason: data.reason.trim() || null,
      })
      .eq("id", orgId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });
