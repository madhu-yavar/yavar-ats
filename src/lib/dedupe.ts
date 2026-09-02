/**
 * Talent-pool hygiene: duplicate detection, CV freshness, and record merging.
 *
 * The pool only gets bigger, so two problems compound over time:
 *  1. the same person arrives again (new CV, referral, job-board sync) under a
 *     slightly different name or a second email address;
 *  2. profiles quietly go stale — the CV is three years old and the person has
 *     changed jobs twice since.
 *
 * Everything here is deterministic and explainable: no AI call is needed to
 * tell a recruiter *why* two rows look like the same human.
 */
import { supabase } from "@/integrations/supabase/client";
import type { Candidate } from "@/lib/data";

export const normEmail = (v: string | null | undefined) => {
  const raw = (v ?? "").trim().toLowerCase();
  if (!raw || raw.endsWith("@import.local")) return "";
  const [user = "", domain = ""] = raw.split("@");
  // Gmail-style aliases and dots point at one inbox.
  const base = user.split("+")[0] ?? "";
  const canonicalUser = /^(gmail|googlemail)\.com$/.test(domain) ? base.replace(/\./g, "") : base;
  return canonicalUser && domain ? `${canonicalUser}@${domain}` : "";
};

/** Last 10 digits — handles +91, 0-prefix and spacing variants. */
export const normPhone = (v: string | null | undefined) => {
  const digits = (v ?? "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
};

export const normName = (v: string | null | undefined) =>
  (v ?? "")
    .toLowerCase()
    .replace(/\b(mr|mrs|ms|dr|prof)\.?\b/g, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(" ");

const normUrl = (v: string | null | undefined) =>
  (v ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");

export type DuplicateReason = "email" | "phone" | "linkedin" | "github" | "name+employer" | "name+phone-area";

export type DuplicateGroup = {
  key: string;
  reasons: DuplicateReason[];
  confidence: "certain" | "likely";
  /** Oldest record first — that is the record we merge into by default. */
  members: Candidate[];
};

/**
 * Cluster candidates that are probably the same person.
 * Strong keys (email, phone, social URL) are `certain`; a name match backed by
 * the same employer is `likely` and always needs a human to confirm.
 */
export function findDuplicateGroups(candidates: Candidate[]): DuplicateGroup[] {
  type Bucket = { reasons: Set<DuplicateReason>; ids: Set<string> };
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    const p = parent.get(id);
    if (!p || p === id) return id;
    const root = find(p);
    parent.set(id, root);
    return root;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };

  for (const c of candidates) parent.set(c.id, c.id);

  const pairReasons = new Map<string, Set<DuplicateReason>>();
  const link = (a: Candidate, b: Candidate, reason: DuplicateReason) => {
    union(a.id, b.id);
    const key = [a.id, b.id].sort().join("|");
    const set = pairReasons.get(key) ?? new Set<DuplicateReason>();
    set.add(reason);
    pairReasons.set(key, set);
  };

  const index = (keyOf: (c: Candidate) => string, reason: DuplicateReason) => {
    const map = new Map<string, Candidate[]>();
    for (const c of candidates) {
      const k = keyOf(c);
      if (!k) continue;
      const list = map.get(k) ?? [];
      list.push(c);
      map.set(k, list);
    }
    for (const list of map.values()) {
      for (let i = 1; i < list.length; i++) link(list[0]!, list[i]!, reason);
    }
  };

  index((c) => normEmail(c.email), "email");
  index((c) => normPhone(c.phone), "phone");
  index((c) => normUrl(c.linkedin_url), "linkedin");
  index((c) => normUrl(c.github_url), "github");
  index((c) => {
    const name = normName(c.full_name);
    const employer = (c.current_employer ?? "").trim().toLowerCase();
    return name && employer ? `${name}@@${employer}` : "";
  }, "name+employer");

  const groups = new Map<string, Bucket>();
  for (const c of candidates) {
    const root = find(c.id);
    const bucket = groups.get(root) ?? { reasons: new Set<DuplicateReason>(), ids: new Set<string>() };
    bucket.ids.add(c.id);
    groups.set(root, bucket);
  }
  for (const [pair, reasons] of pairReasons) {
    const [a] = pair.split("|") as [string];
    const bucket = groups.get(find(a));
    if (bucket) for (const r of reasons) bucket.reasons.add(r);
  }

  const byId = new Map(candidates.map((c) => [c.id, c]));
  return [...groups.entries()]
    .filter(([, b]) => b.ids.size > 1)
    .map(([key, b]) => {
      const members = [...b.ids]
        .map((id) => byId.get(id)!)
        .sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime());
      const reasons = [...b.reasons];
      const strong = reasons.some((r) => r !== "name+employer");
      return { key, reasons, confidence: strong ? ("certain" as const) : ("likely" as const), members };
    })
    .sort((a, b) => b.members.length - a.members.length);
}

/** Candidate ids that sit in any duplicate group, with the group's reasons. */
export function duplicateIndex(groups: DuplicateGroup[]) {
  const map = new Map<string, DuplicateGroup>();
  for (const g of groups) for (const m of g.members) map.set(m.id, g);
  return map;
}

export const FRESH_DAYS = 90;
export const STALE_DAYS = 365;

export type Freshness = { days: number; tier: "fresh" | "aging" | "stale"; label: string };

/** How old the profile data is — synced date if we ever re-synced, else intake date. */
export function freshness(c: Candidate): Freshness {
  const ref = c.last_synced_at ?? c.created_at;
  const days = Math.max(0, Math.floor((Date.now() - new Date(ref).getTime()) / 86_400_000));
  const tier = days <= FRESH_DAYS ? "fresh" : days <= STALE_DAYS ? "aging" : "stale";
  const label = days < 60 ? `${days}d old` : days < 730 ? `${Math.round(days / 30)}mo old` : `${(days / 365).toFixed(1)}y old`;
  return { days, tier, label };
}

const isBlank = (v: unknown) =>
  v === null ||
  v === undefined ||
  (typeof v === "string" && v.trim() === "") ||
  (Array.isArray(v) && v.length === 0) ||
  (typeof v === "number" && v === 0);

/**
 * Field-level merge that never loses information: the survivor keeps everything
 * it already has and only fills its blanks from the duplicate. Skills are
 * unioned, and the longest resume text wins.
 */
export function mergeCandidateFields(survivor: Candidate, dupes: Candidate[]) {
  const patch: Record<string, unknown> = {};
  const skills = new Set((survivor.skills ?? []).map((s) => s.trim()).filter(Boolean));
  let resume = survivor.resume_text ?? "";

  for (const d of dupes) {
    for (const [key, value] of Object.entries(d)) {
      if (key === "id" || key === "created_at" || key === "skills" || key === "resume_text") continue;
      const current = (patch[key] ?? (survivor as unknown as Record<string, unknown>)[key]) as unknown;
      if (isBlank(current) && !isBlank(value)) patch[key] = value;
    }
    for (const s of d.skills ?? []) if (s.trim()) skills.add(s.trim());
    if ((d.resume_text ?? "").length > resume.length) resume = d.resume_text ?? resume;
  }

  if (skills.size !== (survivor.skills ?? []).length) patch["skills"] = [...skills];
  if (resume !== (survivor.resume_text ?? "")) patch["resume_text"] = resume;
  return patch;
}

/**
 * Merge duplicates into one record: fill blanks, re-point applications and all
 * child records at the survivor, then delete the emptied duplicates. Nothing is
 * dropped silently — applications that already exist on the survivor for the
 * same requisition are removed as true duplicates.
 */
export async function mergeCandidates(survivor: Candidate, dupes: Candidate[]) {
  const others = dupes.filter((d) => d.id !== survivor.id);
  if (others.length === 0) return { merged: 0, movedApplications: 0 };

  const patch = mergeCandidateFields(survivor, others);
  if (Object.keys(patch).length > 0) {
    const { error } = await supabase.from("candidates").update(patch).eq("id", survivor.id);
    if (error) throw new Error(error.message);
  }

  const ids = others.map((d) => d.id);

  const { data: survivorApps, error: saErr } = await supabase
    .from("applications")
    .select("id, requisition_id")
    .eq("candidate_id", survivor.id);
  if (saErr) throw new Error(saErr.message);
  const taken = new Set((survivorApps ?? []).map((a) => a.requisition_id));

  const { data: dupeApps, error: daErr } = await supabase
    .from("applications")
    .select("id, requisition_id")
    .in("candidate_id", ids);
  if (daErr) throw new Error(daErr.message);

  let moved = 0;
  for (const a of dupeApps ?? []) {
    if (taken.has(a.requisition_id)) {
      await supabase.from("applications").delete().eq("id", a.id);
      continue;
    }
    const { error } = await supabase.from("applications").update({ candidate_id: survivor.id }).eq("id", a.id);
    if (error) throw new Error(error.message);
    taken.add(a.requisition_id);
    moved++;
  }

  // Child records that hang off the candidate directly.
  for (const table of ["social_profiles", "candidate_verifications", "candidate_assessments"] as const) {
    await supabase.from(table).update({ candidate_id: survivor.id }).in("candidate_id", ids);
  }

  const { error: delErr } = await supabase.from("candidates").delete().in("id", ids);
  if (delErr) throw new Error(delErr.message);

  return { merged: others.length, movedApplications: moved };
}

/** Find an existing person for an incoming CV, before inserting a new row. */
export async function findExistingCandidate(input: {
  email?: string | null;
  phone?: string | null;
  linkedin_url?: string | null;
  full_name?: string | null;
}) {
  const email = normEmail(input.email);
  const phone = normPhone(input.phone);
  const linkedin = normUrl(input.linkedin_url);
  const name = normName(input.full_name);
  if (!email && !phone && !linkedin) return null;

  const { data, error } = await supabase
    .from("candidates")
    .select("*")
    .order("created_at", { ascending: true })
    .limit(2000);
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Candidate[];
  const byEmail = email ? rows.find((r) => normEmail(r.email) === email) : undefined;
  if (byEmail) return { candidate: byEmail, reason: "email" as DuplicateReason };
  const byPhone = phone ? rows.find((r) => normPhone(r.phone) === phone) : undefined;
  if (byPhone) return { candidate: byPhone, reason: "phone" as DuplicateReason };
  const byLinkedin = linkedin ? rows.find((r) => normUrl(r.linkedin_url) === linkedin) : undefined;
  if (byLinkedin) return { candidate: byLinkedin, reason: "linkedin" as DuplicateReason };
  const byName = name ? rows.find((r) => normName(r.full_name) === name && normPhone(r.phone) && normPhone(r.phone) === phone) : undefined;
  if (byName) return { candidate: byName, reason: "name+phone-area" as DuplicateReason };
  return null;
}
