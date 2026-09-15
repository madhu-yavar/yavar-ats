import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Recruiter-to-recruiter collaboration on a shared talent pool: every candidate
 * can have an owning recruiter, be referred to a colleague's role, be handed
 * over with an audit trail, or be suggested against a colleague's open request.
 * The pool itself stays visible to the whole organisation.
 */

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** The signed-in user's active organisation, and whether they own it. */
async function membership(userId: string) {
  const db = await admin();
  const { data, error } = await db
    .from("org_members")
    .select("org_id, is_owner, full_name, email")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error("You are not a member of an organisation yet.");
  return data;
}

export type PoolTeammate = {
  userId: string;
  name: string;
  email: string;
  isOwner: boolean;
};

/** Colleagues who can own, receive or be mentioned on a candidate. */
export const poolTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PoolTeammate[]> => {
    const me = await membership(context.userId);
    const db = await admin();
    const { data, error } = await db
      .from("org_members")
      .select("user_id, full_name, email, is_owner")
      .eq("org_id", me.org_id)
      .eq("status", "active")
      .not("user_id", "is", null)
      .order("full_name");
    if (error) throw new Error(error.message);
    return (data ?? []).map((m) => ({
      userId: m.user_id as string,
      name: m.full_name || m.email,
      email: m.email,
      isOwner: m.is_owner,
    }));
  });

/** Assign, hand over or release ownership of candidates, with an audit trail. */
export const setCandidateOwner = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        candidateIds: z.array(z.string().uuid()).min(1).max(500),
        ownerId: z.string().uuid().nullable(),
        reason: z.string().trim().max(400).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const me = await membership(context.userId);
    const db = await admin();

    if (data.ownerId) {
      const { data: target } = await db
        .from("org_members")
        .select("id")
        .eq("org_id", me.org_id)
        .eq("user_id", data.ownerId)
        .eq("status", "active")
        .maybeSingle();
      if (!target) throw new Error("That colleague is not an active member of your organisation.");
    }

    const { data: rows, error } = await db
      .from("candidates")
      .select("id, owner_id")
      .eq("org_id", me.org_id)
      .in("id", data.candidateIds);
    if (error) throw new Error(error.message);
    if (!rows?.length)
      throw new Error("No candidates in your organisation matched that selection.");

    const ids = rows.map((r) => r.id);
    const { error: updErr } = await db
      .from("candidates")
      .update({ owner_id: data.ownerId })
      .in("id", ids);
    if (updErr) throw new Error(updErr.message);

    await db.from("candidate_ownership_events").insert(
      rows.map((r) => ({
        org_id: me.org_id,
        candidate_id: r.id,
        from_owner: r.owner_id,
        to_owner: data.ownerId,
        actor: context.userId,
        reason: data.reason ?? null,
      })),
    );

    return { updated: ids.length };
  });

/** Send a candidate to a colleague, optionally against one of their roles. */
export const referCandidate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        candidateId: z.string().uuid(),
        toUser: z.string().uuid(),
        requisitionId: z.string().uuid().nullable().optional(),
        note: z.string().trim().max(1000).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const me = await membership(context.userId);
    if (data.toUser === context.userId) throw new Error("Pick a colleague other than yourself.");
    const db = await admin();

    const { data: cand } = await db
      .from("candidates")
      .select("id")
      .eq("id", data.candidateId)
      .eq("org_id", me.org_id)
      .maybeSingle();
    if (!cand) throw new Error("That candidate is not in your organisation's pool.");

    const { data: peer } = await db
      .from("org_members")
      .select("id")
      .eq("org_id", me.org_id)
      .eq("user_id", data.toUser)
      .eq("status", "active")
      .maybeSingle();
    if (!peer) throw new Error("That colleague is not an active member of your organisation.");

    const { error } = await db.from("candidate_referrals").insert({
      org_id: me.org_id,
      candidate_id: data.candidateId,
      requisition_id: data.requisitionId ?? null,
      from_user: context.userId,
      to_user: data.toUser,
      note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/**
 * Accept or decline a referral. Accepting also makes the receiver the owner and
 * attaches the candidate to the role when one was named, so the hand-off is real.
 */
export const respondReferral = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        referralId: z.string().uuid(),
        accept: z.boolean(),
        note: z.string().trim().max(600).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const db = await admin();
    const { data: ref, error } = await db
      .from("candidate_referrals")
      .select("id, org_id, candidate_id, requisition_id, to_user, status")
      .eq("id", data.referralId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!ref) throw new Error("That referral no longer exists.");
    if (ref.to_user !== context.userId)
      throw new Error("Only the recruiter it was sent to can respond.");
    if (ref.status !== "pending") throw new Error("This referral has already been answered.");

    await db
      .from("candidate_referrals")
      .update({
        status: data.accept ? "accepted" : "declined",
        response_note: data.note ?? null,
        responded_at: new Date().toISOString(),
      })
      .eq("id", ref.id);

    if (data.accept) {
      const { data: prev } = await db
        .from("candidates")
        .select("owner_id")
        .eq("id", ref.candidate_id)
        .maybeSingle();
      await db.from("candidates").update({ owner_id: context.userId }).eq("id", ref.candidate_id);
      await db.from("candidate_ownership_events").insert({
        org_id: ref.org_id,
        candidate_id: ref.candidate_id,
        from_owner: prev?.owner_id ?? null,
        to_owner: context.userId,
        actor: context.userId,
        reason: "Accepted referral",
      });

      if (ref.requisition_id) {
        const { data: existing } = await db
          .from("applications")
          .select("id")
          .eq("candidate_id", ref.candidate_id)
          .eq("requisition_id", ref.requisition_id)
          .maybeSingle();
        if (!existing)
          await db.from("applications").insert({
            org_id: ref.org_id,
            candidate_id: ref.candidate_id,
            requisition_id: ref.requisition_id,
            stage: "sourced",
            source: "internal_referral",
          } as never);
      }
    }

    return { ok: true, accepted: data.accept };
  });

/** Leave a note on a candidate and optionally pull colleagues in by mention. */
export const addCandidateNote = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        candidateId: z.string().uuid(),
        body: z.string().trim().min(1).max(4000),
        mentions: z.array(z.string().uuid()).max(20).default([]),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const me = await membership(context.userId);
    const db = await admin();

    const { data: cand } = await db
      .from("candidates")
      .select("id")
      .eq("id", data.candidateId)
      .eq("org_id", me.org_id)
      .maybeSingle();
    if (!cand) throw new Error("That candidate is not in your organisation's pool.");

    let mentions: string[] = [];
    if (data.mentions.length) {
      const { data: peers } = await db
        .from("org_members")
        .select("user_id")
        .eq("org_id", me.org_id)
        .eq("status", "active")
        .in("user_id", data.mentions);
      mentions = (peers ?? []).map((p) => p.user_id as string);
    }

    const { error } = await db.from("candidate_notes").insert({
      org_id: me.org_id,
      candidate_id: data.candidateId,
      author_id: context.userId,
      author_name: me.full_name || me.email,
      body: data.body,
      mentions,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Ask the rest of the team for people matching a skill or role. */
export const createTalentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        title: z.string().trim().min(2).max(160),
        skills: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
        note: z.string().trim().max(1000).optional(),
        requisitionId: z.string().uuid().nullable().optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const me = await membership(context.userId);
    const db = await admin();
    const { error } = await db.from("talent_requests").insert({
      org_id: me.org_id,
      requester_id: context.userId,
      requisition_id: data.requisitionId ?? null,
      title: data.title,
      skills: data.skills,
      note: data.note ?? null,
    });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Suggest one of your candidates against a colleague's request. */
export const suggestToRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        requestId: z.string().uuid(),
        candidateId: z.string().uuid(),
        note: z.string().trim().max(600).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const me = await membership(context.userId);
    const db = await admin();
    const { data: req } = await db
      .from("talent_requests")
      .select("id, org_id, status")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req || req.org_id !== me.org_id)
      throw new Error("That request is not open in your organisation.");
    if (req.status !== "open") throw new Error("This request has already been closed.");

    const { data: cand } = await db
      .from("candidates")
      .select("id")
      .eq("id", data.candidateId)
      .eq("org_id", me.org_id)
      .maybeSingle();
    if (!cand) throw new Error("That candidate is not in your organisation's pool.");

    const { error } = await db.from("talent_request_suggestions").insert({
      org_id: me.org_id,
      request_id: data.requestId,
      candidate_id: data.candidateId,
      suggested_by: context.userId,
      note: data.note ?? null,
    });
    if (error && /duplicate|unique/i.test(error.message))
      throw new Error("That candidate has already been suggested for this request.");
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Close your own request once you have what you need. */
export const closeTalentRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({ requestId: z.string().uuid() }).parse(data))
  .handler(async ({ data, context }) => {
    const me = await membership(context.userId);
    const db = await admin();
    const { data: req } = await db
      .from("talent_requests")
      .select("id, org_id, requester_id")
      .eq("id", data.requestId)
      .maybeSingle();
    if (!req || req.org_id !== me.org_id) throw new Error("Request not found.");
    if (req.requester_id !== context.userId && !me.is_owner)
      throw new Error("Only the recruiter who raised it, or an organisation owner, can close it.");
    await db
      .from("talent_requests")
      .update({ status: "closed", closed_at: new Date().toISOString() })
      .eq("id", req.id);
    return { ok: true };
  });

export type PoolShare = {
  id: string;
  direction: "outgoing" | "incoming";
  status: string;
  scope: string | null;
  partnerName: string;
  partnerOrg: string;
  createdAt: string;
};

/** Cross-organisation pool sharing agreements, both directions. */
export const listPoolShares = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PoolShare[]> => {
    const me = await membership(context.userId);
    const db = await admin();
    const { data, error } = await db
      .from("org_pool_shares")
      .select("id, owner_org, partner_org, status, scope, created_at")
      .or(`owner_org.eq.${me.org_id},partner_org.eq.${me.org_id}`)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const ids = new Set<string>();
    for (const s of data ?? []) {
      ids.add(s.owner_org);
      ids.add(s.partner_org);
    }
    const { data: orgs } = await db
      .from("organizations")
      .select("id, name")
      .in("id", [...ids].length ? [...ids] : [me.org_id]);
    const nameOf = new Map((orgs ?? []).map((o) => [o.id, o.name]));

    return (data ?? []).map((s) => {
      const outgoing = s.owner_org === me.org_id;
      const partner = outgoing ? s.partner_org : s.owner_org;
      return {
        id: s.id,
        direction: outgoing ? ("outgoing" as const) : ("incoming" as const),
        status: s.status,
        scope: s.scope,
        partnerOrg: partner,
        partnerName: nameOf.get(partner) ?? "Unknown organisation",
        createdAt: s.created_at,
      };
    });
  });

/**
 * Offer your pool to another organisation. Nothing is visible to them until
 * they accept, and either side can revoke it at any time.
 */
export const offerPoolShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({
        partnerName: z.string().trim().min(2).max(160),
        scope: z.string().trim().max(400).optional(),
      })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const me = await membership(context.userId);
    if (!me.is_owner)
      throw new Error("Only an organisation owner can agree to share the talent pool.");
    const db = await admin();

    const { data: matches } = await db
      .from("organizations")
      .select("id, name")
      .ilike("name", `%${data.partnerName}%`)
      .eq("status", "active")
      .limit(5);
    const found = (matches ?? []).filter((o) => o.id !== me.org_id);
    if (found.length === 0) throw new Error("No active organisation matched that name.");
    if (found.length > 1)
      throw new Error(
        `Several organisations matched: ${found.map((o) => o.name).join(", ")}. Be more specific.`,
      );

    const { error } = await db.from("org_pool_shares").insert({
      owner_org: me.org_id,
      partner_org: found[0]!.id,
      scope: data.scope ?? null,
      requested_by: context.userId,
    });
    if (error && /duplicate|unique/i.test(error.message))
      throw new Error(`An agreement with ${found[0]!.name} already exists.`);
    if (error) throw new Error(error.message);
    return { ok: true, partnerName: found[0]!.name };
  });

/** Accept, decline or revoke a sharing agreement. */
export const respondPoolShare = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z
      .object({ shareId: z.string().uuid(), action: z.enum(["accept", "decline", "revoke"]) })
      .parse(data),
  )
  .handler(async ({ data, context }) => {
    const me = await membership(context.userId);
    if (!me.is_owner) throw new Error("Only an organisation owner can change a sharing agreement.");
    const db = await admin();
    const { data: share } = await db
      .from("org_pool_shares")
      .select("id, owner_org, partner_org, status")
      .eq("id", data.shareId)
      .maybeSingle();
    if (!share) throw new Error("Agreement not found.");
    const mine = share.owner_org === me.org_id || share.partner_org === me.org_id;
    if (!mine) throw new Error("This agreement does not involve your organisation.");

    if (data.action === "revoke") {
      await db
        .from("org_pool_shares")
        .update({
          status: "revoked",
          revoked_at: new Date().toISOString(),
          responded_by: context.userId,
        })
        .eq("id", share.id);
      return { ok: true, status: "revoked" };
    }

    if (share.partner_org !== me.org_id)
      throw new Error("Only the receiving organisation can accept or decline.");
    const status = data.action === "accept" ? "active" : "declined";
    await db
      .from("org_pool_shares")
      .update({ status, responded_at: new Date().toISOString(), responded_by: context.userId })
      .eq("id", share.id);
    return { ok: true, status };
  });
