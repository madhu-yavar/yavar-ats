import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  buildOntology,
  prettyName,
  type OntologyBuild,
  type OntologyDemandRow,
  type OntologySourceRow,
} from "./ontology.server";

type Sb = { from: (t: string) => any };

export type TalentBrain = OntologyBuild & {
  scope: "org" | "platform";
  orgName: string | null;
  builtAt: string | null;
  history: Array<{
    at: string;
    nodes: number;
    edges: number;
    added: number;
    grown: number;
    dormant: number;
    retired: number;
  }>;
  narrative: string | null;
  engine: string | null;
};

/** The Talent Brain is a governance view: CHRO, HR head, owner or the product super admin. */
async function requireBrainAccess(supabase: Sb, userId: string, email: string | null) {
  const { data: member } = await supabase
    .from("org_members")
    .select("org_id, is_owner, organizations(name)")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at")
    .limit(1)
    .maybeSingle();

  let superUser = false;
  if (email) {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: pa } = await supabaseAdmin
      .from("platform_admins")
      .select("id")
      .ilike("email", email.toLowerCase())
      .maybeSingle();
    superUser = Boolean(pa);
  }

  if (!member?.org_id) {
    if (superUser) return { orgId: null as string | null, orgName: null, superUser: true };
    throw new Error("You are not part of an organisation yet.");
  }

  if (member.is_owner || superUser) {
    return {
      orgId: member.org_id as string,
      orgName: (member as any).organizations?.name ?? null,
      superUser,
    };
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const allowed = (roles ?? []).some((r: { role: string }) =>
    ["president_cbo", "hr_head"].includes(r.role),
  );
  if (!allowed) {
    throw new Error("The Talent Brain is available to the CHRO, HR Head and the account owner.");
  }
  return {
    orgId: member.org_id as string,
    orgName: (member as any).organizations?.name ?? null,
    superUser: false,
  };
}

async function loadSources(db: Sb, orgId: string | null) {
  const scopeIt = (q: any) => (orgId ? q.eq("org_id", orgId) : q);

  const [cand, reqs, apps, prevNodes, snaps] = await Promise.all([
    scopeIt(db.from("candidates").select("id, skills, created_at, last_synced_at")).limit(5000),
    scopeIt(
      db
        .from("requisitions")
        .select("id, title, openings, status, must_have_skills, good_to_have_skills"),
    ).limit(2000),
    scopeIt(db.from("applications").select("candidate_id, stage")).limit(10000),
    scopeIt(
      db
        .from("skill_nodes")
        .select("slug, first_seen_at, last_seen_at, evidence_count, status, category, aliases"),
    ).limit(5000),
    scopeIt(db.from("ontology_snapshots").select("*"))
      .order("created_at", { ascending: false })
      .limit(12),
  ]);

  const hired = new Set(
    (apps.data ?? [])
      .filter((a: { stage: string }) =>
        ["hired", "joined", "offer_accepted", "offer_released"].includes(a.stage),
      )
      .map((a: { candidate_id: string }) => a.candidate_id),
  );

  const candidates: OntologySourceRow[] = (cand.data ?? []).map((c: any) => ({
    candidateId: c.id,
    skills: Array.isArray(c.skills) ? c.skills : [],
    observedAt: c.last_synced_at ?? c.created_at ?? new Date().toISOString(),
    hired: hired.has(c.id),
  }));

  const openStatuses = new Set(["approved", "pending_hr", "pending_cbo", "pending_dh", "draft"]);
  const demand: OntologyDemandRow[] = (reqs.data ?? []).map((r: any) => ({
    requisitionId: r.id,
    title: r.title,
    openings: Number(r.openings ?? 1),
    mustHave: Array.isArray(r.must_have_skills) ? r.must_have_skills : [],
    goodToHave: Array.isArray(r.good_to_have_skills) ? r.good_to_have_skills : [],
    open: openStatuses.has(r.status),
  }));

  const previous = (prevNodes.data ?? []).map((n: any) => ({
    slug: n.slug,
    firstSeenAt: n.first_seen_at,
    lastSeenAt: n.last_seen_at,
    evidence: Number(n.evidence_count ?? 0),
    status: n.status ?? "active",
  }));

  // Curation already learned (families, merged aliases) is reused on every read.
  const curated: Record<string, { category?: string; aliases?: string[] }> = {};
  for (const n of prevNodes.data ?? []) {
    const entry: { category?: string; aliases?: string[] } = {};
    if (typeof (n as any).category === "string" && (n as any).category !== "general")
      entry.category = (n as any).category;
    if (Array.isArray((n as any).aliases)) entry.aliases = (n as any).aliases;
    if (entry.category || entry.aliases?.length) curated[(n as any).slug] = entry;
  }

  return { candidates, demand, previous, curated, snapshots: snaps.data ?? [] };
}

function history(snapshots: any[]) {
  return snapshots
    .slice()
    .reverse()
    .map((s) => ({
      at: s.created_at,
      nodes: Number(s.node_count ?? 0),
      edges: Number(s.edge_count ?? 0),
      added: (s.added ?? []).length,
      grown: (s.grown ?? []).length,
      dormant: (s.dormant ?? []).length,
      retired: (s.retired ?? []).length,
    }));
}

/** Read the stored graph (cheap) — falls back to a fresh in-memory build when empty. */
export const readTalentBrain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ scope: z.enum(["org", "platform"]).default("org") }).parse(input ?? {}),
  )
  .handler(async ({ data, context }): Promise<TalentBrain> => {
    const supabase = context.supabase as unknown as Sb;
    const email = (context.claims as any)?.email ?? null;
    const access = await requireBrainAccess(supabase, context.userId, email);
    const platform = data.scope === "platform" && access.superUser;
    if (data.scope === "platform" && !access.superUser) {
      throw new Error("Cross-organisation view is limited to the product super admin.");
    }

    const db: Sb = platform
      ? ((await import("@/integrations/supabase/client.server")).supabaseAdmin as unknown as Sb)
      : supabase;
    const orgId = platform ? null : access.orgId;
    if (!platform && !orgId) throw new Error("You are not part of an organisation yet.");

    const src = await loadSources(db, orgId);
    const build = buildOntology({
      candidates: src.candidates,
      demand: src.demand,
      previous: src.previous,
      aiCategories: src.curated,
    });

    return {
      ...build,
      scope: platform ? "platform" : "org",
      orgName: platform ? "All organisations" : access.orgName,
      builtAt: src.snapshots[0]?.created_at ?? null,
      history: history(src.snapshots),
      narrative: null,
      engine: null,
    };
  });

/**
 * Rebuild and persist the ontology: canonicalise skills with the configured model,
 * store nodes/edges/evidence, then record a snapshot so growth and shrink are auditable.
 */
export const rebuildTalentBrain = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).parse(input ?? {}))
  .handler(async ({ context }): Promise<TalentBrain> => {
    const supabase = context.supabase as unknown as Sb;
    const email = (context.claims as any)?.email ?? null;
    const access = await requireBrainAccess(supabase, context.userId, email);
    const orgId = access.orgId;
    if (!orgId) throw new Error("Choose an organisation before rebuilding its Talent Brain.");

    const src = await loadSources(supabase, orgId);

    // First pass without AI so the graph exists even when no model is configured.
    let build = buildOntology({
      candidates: src.candidates,
      demand: src.demand,
      previous: src.previous,
      aiCategories: src.curated,
    });

    // AI pass: canonical categories, merged aliases and an executive narrative.
    let engine: string | null = null;
    let narrative: string | null = null;
    try {
      const { aiJson } = await import("./ai-gateway.server");
      const top = build.nodes.slice(0, 220);
      const res = await aiJson<{
        skills?: Array<{ slug: string; category?: string; aliases?: string[] }>;
        narrative?: string;
      }>({
        system:
          "You curate an enterprise talent ontology. Group skills into consistent capability families, " +
          "merge obvious synonyms, and write a short executive reading of supply vs demand. " +
          'Return JSON: {"skills":[{"slug","category","aliases":[]}],"narrative":"..."}.',
        prompt: JSON.stringify({
          organisation: access.orgName,
          openRoles: build.stats.requisitions,
          candidates: build.stats.candidates,
          skills: top.map((n) => ({
            slug: n.slug,
            name: n.name,
            category: n.category,
            supply: n.supply,
            demand: n.demand,
            validated: n.validated,
            status: n.status,
          })),
        }),
      });
      if (res.ok) {
        engine = `${res.provider}/${res.model}`;
        narrative = res.data.narrative?.trim() || null;
        const aiCategories: Record<string, { category?: string; aliases?: string[] }> = {
          ...src.curated,
        };
        for (const s of res.data.skills ?? []) {
          if (!s?.slug) continue;
          const entry: { category?: string; aliases?: string[] } = {};
          if (typeof s.category === "string" && s.category.trim()) entry.category = s.category;
          if (Array.isArray(s.aliases)) entry.aliases = s.aliases;
          aiCategories[s.slug] = entry;
        }
        build = buildOntology({
          candidates: src.candidates,
          demand: src.demand,
          previous: src.previous,
          aiCategories,
        });
      }
    } catch {
      // A model outage must never block the deterministic graph.
    }

    // Persist nodes.
    const nowIso = new Date().toISOString();
    if (build.nodes.length) {
      const rows = build.nodes.map((n) => ({
        org_id: orgId,
        slug: n.slug,
        name: n.name,
        category: n.category,
        aliases: n.aliases,
        supply: n.supply,
        demand: n.demand,
        validated: n.validated,
        evidence_count: n.evidence,
        status: n.status,
        first_seen_at: n.firstSeenAt,
        last_seen_at: n.lastSeenAt,
        updated_at: nowIso,
      }));
      for (let i = 0; i < rows.length; i += 200) {
        const { error } = await (supabase.from("skill_nodes") as any).upsert(
          rows.slice(i, i + 200),
          { onConflict: "org_id,slug" },
        );
        if (error) throw new Error(error.message);
      }
    }

    // Retire nodes that lost all live evidence — this is how the graph shrinks.
    const liveSlugs = new Set(build.nodes.map((n) => n.slug));
    const gone = src.previous
      .filter((p: { slug: string }) => !liveSlugs.has(p.slug))
      .map((p: { slug: string }) => p.slug);
    if (gone.length) {
      await (supabase.from("skill_nodes") as any)
        .delete()
        .eq("org_id", orgId)
        .in("slug", gone.slice(0, 500));
      await (supabase.from("skill_edges") as any)
        .delete()
        .eq("org_id", orgId)
        .in("from_slug", gone.slice(0, 500));
    }

    // Replace edges for this organisation.
    await (supabase.from("skill_edges") as any).delete().eq("org_id", orgId);
    if (build.edges.length) {
      const edgeRows = build.edges.map((e) => ({
        org_id: orgId,
        from_slug: e.from,
        to_slug: e.to,
        kind: "cooccurs",
        weight: e.weight,
        evidence_count: e.count,
        updated_at: nowIso,
      }));
      for (let i = 0; i < edgeRows.length; i += 200) {
        const { error } = await (supabase.from("skill_edges") as any).insert(
          edgeRows.slice(i, i + 200),
        );
        if (error) throw new Error(error.message);
      }
    }

    await (supabase.from("ontology_snapshots") as any).insert({
      org_id: orgId,
      node_count: build.stats.nodeCount,
      edge_count: build.stats.edgeCount,
      added: build.diff.added.slice(0, 200),
      grown: build.diff.grown.slice(0, 200),
      dormant: build.diff.dormant.slice(0, 200),
      retired: [...new Set([...build.diff.retired, ...gone])].slice(0, 200),
      stats: build.stats,
      model: engine,
    });

    const { data: snaps } = await (supabase.from("ontology_snapshots") as any)
      .select("*")
      .eq("org_id", orgId)
      .order("created_at", { ascending: false })
      .limit(12);

    return {
      ...build,
      diff: { ...build.diff, retired: [...new Set([...build.diff.retired, ...gone])] },
      scope: "org",
      orgName: access.orgName,
      builtAt: nowIso,
      history: history(snaps ?? []),
      narrative,
      engine,
    };
  });

export { prettyName };
