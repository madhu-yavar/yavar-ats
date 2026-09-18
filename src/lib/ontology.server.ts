/**
 * Talent ontology engine (server-only logic, no database calls).
 *
 * The ontology is a living skill graph for one organisation:
 *   nodes  — canonical skills with aliases, category, supply/demand/validated counts
 *   edges  — skills observed together (co-occurrence) with a normalised weight
 *   growth — every rebuild is compared with the previous snapshot so the graph can
 *            grow (new skills, more evidence) and shrink (dormant, then retired)
 *
 * Growth / shrink rules
 *   fresh evidence  (<= 180 days) counts at full strength
 *   ageing evidence (181-365 days) counts at half strength
 *   stale evidence  (> 365 days) counts at a quarter strength
 *   a skill with no evidence inside 365 days becomes `dormant`
 *   a dormant skill with no evidence inside 730 days is `retired` from the graph
 */

export type OntologySourceRow = {
  candidateId: string;
  skills: string[];
  observedAt: string;
  hired: boolean;
  /** Raw CV text — mined for skill tokens the parser missed. */
  resumeText?: string | null;
};

export type OntologyDemandRow = {
  requisitionId: string;
  title: string;
  openings: number;
  mustHave: string[];
  goodToHave: string[];
  open: boolean;
};

export type OntologyNode = {
  slug: string;
  name: string;
  category: string;
  aliases: string[];
  supply: number;
  demand: number;
  validated: number;
  evidence: number;
  weight: number;
  status: "active" | "dormant" | "retired";
  firstSeenAt: string;
  lastSeenAt: string;
  scarcity: number;
};

export type OntologyEdge = { from: string; to: string; weight: number; count: number };

export type OntologyInsight = {
  kind: "scarcity" | "bench" | "emerging" | "fading" | "bridge" | "coverage";
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  skills: string[];
  /** Where the CHRO acts on this insight (route), when one exists. */
  actionTo?: string;
  actionLabel?: string;
};

export type OntologyDiff = {
  added: string[];
  grown: string[];
  dormant: string[];
  retired: string[];
};

export type OntologyBuild = {
  nodes: OntologyNode[];
  edges: OntologyEdge[];
  insights: OntologyInsight[];
  diff: OntologyDiff;
  stats: {
    candidates: number;
    requisitions: number;
    nodeCount: number;
    edgeCount: number;
    scarce: number;
    dormant: number;
    coverage: number;
  };
};

const DAY = 86_400_000;

/** Hand-curated aliases so obvious variants never split the graph. */
const ALIASES: Record<string, string> = {
  reactjs: "react",
  "react.js": "react",
  "react js": "react",
  nodejs: "node",
  "node.js": "node",
  js: "javascript",
  ts: "typescript",
  postgres: "postgresql",
  psql: "postgresql",
  "ms sql": "sql server",
  mssql: "sql server",
  k8s: "kubernetes",
  gcp: "google cloud",
  aws: "amazon web services",
  ml: "machine learning",
  dl: "deep learning",
  nlp: "natural language processing",
  genai: "generative ai",
  "gen ai": "generative ai",
  llm: "large language models",
  llms: "large language models",
  "power bi": "powerbi",
  "excel advanced": "excel",
  hrms: "hr management systems",
  seo: "search engine optimisation",
  sem: "search engine marketing",
  "b2b sales": "b2b sales",
};

/** Coarse categories keep the graph readable without an external taxonomy. */
const CATEGORY_RULES: Array<[RegExp, string]> = [
  [/(react|angular|vue|css|html|frontend|next\.?js|tailwind)/, "frontend"],
  [/(node|java|python|golang|\.net|c#|spring|django|backend|php|ruby)/, "backend"],
  [/(sql|postgres|mysql|mongo|oracle|redis|snowflake|warehouse|etl|dbt)/, "data platform"],
  [/(machine learning|deep learning|nlp|generative ai|llm|pytorch|tensorflow|data science)/, "ai"],
  [/(aws|azure|google cloud|kubernetes|docker|devops|terraform|ci\/cd|linux)/, "cloud & devops"],
  [/(qa|testing|selenium|cypress|automation test)/, "quality"],
  [/(sales|business development|account management|crm|salesforce)/, "sales"],
  [/(marketing|seo|sem|content|campaign|brand|social media)/, "marketing"],
  [/(recruit|payroll|hr |hris|hrms|talent|compensation)/, "people"],
  [/(finance|accounting|audit|taxation|fp&a)/, "finance"],
  [/(communication|leadership|stakeholder|ownership|problem solving|mentoring)/, "behavioural"],
];

export function slugify(raw: string) {
  const cleaned = raw
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const canonical = ALIASES[cleaned] ?? cleaned;
  return canonical.replace(/\s+/g, "-");
}

export function prettyName(slug: string) {
  return slug
    .split("-")
    .map((w) =>
      w.length <= 3 && /^[a-z]+$/.test(w)
        ? w.toUpperCase()
        : `${(w[0] ?? "").toUpperCase()}${w.slice(1)}`,
    )
    .join(" ");
}

function categorise(slug: string) {
  const probe = slug.replace(/-/g, " ");
  for (const [re, cat] of CATEGORY_RULES) if (re.test(probe)) return cat;
  return "general";
}

/**
 * Mine raw CV text for skills the parser missed: word-boundary scan against the
 * alias table, the stored graph's slugs/aliases and the slug itself. Returns
 * canonical slugs found in the text. Bounded — only known tokens count, so free
 * prose cannot invent nodes.
 */
function mineSkills(
  text: string | null | undefined,
  tokens: Map<string, string>,
): string[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const found = new Set<string>();
  for (const [token, slug] of tokens) {
    if (token.length < 2) continue;
    const re = new RegExp(`(^|[^a-z0-9+#])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9+#]|$)`);
    if (re.test(hay)) found.add(slug);
  }
  return [...found];
}

function decay(observedAt: string, now: number) {
  const age = (now - new Date(observedAt).getTime()) / DAY;
  if (!Number.isFinite(age) || age <= 180) return 1;
  if (age <= 365) return 0.5;
  return 0.25;
}

/**
 * Fold the organisation's live records into a skill graph.
 * `previous` is the last stored node set, used to keep first-seen dates and to
 * decide what grew, went dormant or should be retired.
 */
export function buildOntology(input: {
  candidates: OntologySourceRow[];
  demand: OntologyDemandRow[];
  previous: Array<{
    slug: string;
    firstSeenAt: string;
    evidence: number;
    status: string;
    lastSeenAt: string;
  }>;
  aiCategories?: Record<string, { category?: string; aliases?: string[] }>;
  now?: number;
}): OntologyBuild {
  const now = input.now ?? Date.now();
  const prev = new Map(input.previous.map((p) => [p.slug, p]));

  type Acc = {
    slug: string;
    surface: Map<string, number>;
    supply: number;
    validated: number;
    evidence: number;
    weight: number;
    demand: number;
    lastSeen: number;
    freshWithinYear: boolean;
    freshWithinTwoYears: boolean;
  };
  const nodes = new Map<string, Acc>();

  // Token index for CV-text mining: alias table + stored graph + parsed skills.
  const knownSlugs = new Set<string>();
  for (const c of input.candidates)
    for (const raw of c.skills ?? []) {
      const sl = slugify(raw);
      if (sl && sl.length >= 2) knownSlugs.add(sl);
    }
  for (const p of input.previous) knownSlugs.add(p.slug);
  const tokens = new Map<string, string>();
  for (const [alias, slug] of Object.entries(ALIASES)) tokens.set(alias, slug);
  for (const slug of knownSlugs) tokens.set(slug.replace(/-/g, " "), slug);

  function touch(slug: string, surface: string) {
    let acc = nodes.get(slug);
    if (!acc) {
      acc = {
        slug,
        surface: new Map(),
        supply: 0,
        validated: 0,
        evidence: 0,
        weight: 0,
        demand: 0,
        lastSeen: 0,
        freshWithinYear: false,
        freshWithinTwoYears: false,
      };
      nodes.set(slug, acc);
    }
    const label = surface.trim();
    if (label) acc.surface.set(label, (acc.surface.get(label) ?? 0) + 1);
    return acc;
  }

  // Supply side: every candidate skill is evidence, decayed by age.
  const pairCounts = new Map<string, { count: number; from: string; to: string }>();
  for (const c of input.candidates) {
    const observed = new Date(c.observedAt).getTime();
    const w = decay(c.observedAt, now);
    const ageDays = (now - observed) / DAY;
    const unique = new Set<string>();
    // Skills mined straight from the CV text count exactly like parsed ones —
    // the parser misses plenty, and the pool is the evidence, not the field.
    const mined = mineSkills(c.resumeText, tokens);
    for (const raw of [...(c.skills ?? []), ...mined.map((sl) => prettyName(sl))]) {
      if (!raw || typeof raw !== "string") continue;
      const slug = slugify(raw);
      if (!slug || slug.length < 2) continue;
      unique.add(slug);
      const acc = touch(slug, raw);
      acc.supply += 1;
      acc.evidence += 1;
      acc.weight += w;
      if (c.hired) acc.validated += 1;
      acc.lastSeen = Math.max(acc.lastSeen, observed);
      if (ageDays <= 365) acc.freshWithinYear = true;
      if (ageDays <= 730) acc.freshWithinTwoYears = true;
    }
    // Co-occurrence edges: which skills this organisation's people actually pair.
    const list = [...unique].sort();
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const key = `${list[i]}|${list[j]}`;
        const cur = pairCounts.get(key) ?? { count: 0, from: list[i]!, to: list[j]! };
        cur.count += 1;
        pairCounts.set(key, cur);
      }
    }
  }

  // Demand side: open requisitions weight must-have skills highest.
  for (const r of input.demand) {
    if (!r.open) continue;
    const openings = Math.max(1, r.openings || 1);
    for (const raw of r.mustHave ?? []) {
      const slug = slugify(raw);
      if (!slug) continue;
      touch(slug, raw).demand += openings * 2;
    }
    for (const raw of r.goodToHave ?? []) {
      const slug = slugify(raw);
      if (!slug) continue;
      touch(slug, raw).demand += openings;
    }
  }

  const built: OntologyNode[] = [];
  for (const acc of nodes.values()) {
    const before = prev.get(acc.slug);
    const bestSurface = [...acc.surface.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
    const ai = input.aiCategories?.[acc.slug];
    const status: OntologyNode["status"] = acc.freshWithinYear
      ? "active"
      : acc.freshWithinTwoYears
        ? "dormant"
        : acc.demand > 0
          ? "dormant"
          : "retired";
    const supply = acc.supply;
    const demand = acc.demand;
    // Scarcity: how badly demand outruns live, decayed supply (0 = comfortable).
    const scarcity = demand === 0 ? 0 : Math.round((demand / (demand + acc.weight)) * 100);
    built.push({
      slug: acc.slug,
      name: bestSurface ? bestSurface.replace(/\s+/g, " ").trim() : prettyName(acc.slug),
      category: ai?.category?.trim() || categorise(acc.slug),
      aliases: [...new Set([...acc.surface.keys(), ...(ai?.aliases ?? [])])].slice(0, 8),
      supply,
      demand,
      validated: acc.validated,
      evidence: acc.evidence,
      weight: Math.round(acc.weight * 10) / 10,
      status,
      firstSeenAt: before?.firstSeenAt ?? new Date(acc.lastSeen || now).toISOString(),
      lastSeenAt: new Date(acc.lastSeen || now).toISOString(),
      scarcity,
    });
  }

  const live = built.filter((n) => n.status !== "retired");
  const liveSlugs = new Set(live.map((n) => n.slug));
  const supplyBySlug = new Map(built.map((n) => [n.slug, n.supply]));

  const edges: OntologyEdge[] = [];
  for (const pair of pairCounts.values()) {
    if (!liveSlugs.has(pair.from) || !liveSlugs.has(pair.to)) continue;
    const base = Math.min(supplyBySlug.get(pair.from) ?? 1, supplyBySlug.get(pair.to) ?? 1);
    const weight = Math.round((pair.count / Math.max(1, base)) * 100) / 100;
    if (pair.count < 2 || weight < 0.15) continue;
    edges.push({ from: pair.from, to: pair.to, weight, count: pair.count });
  }
  edges.sort((a, b) => b.count - a.count);
  const trimmedEdges = edges.slice(0, 600);

  // Growth / shrink versus the previous snapshot.
  const diff: OntologyDiff = { added: [], grown: [], dormant: [], retired: [] };
  for (const n of built) {
    const before = prev.get(n.slug);
    if (!before) {
      if (n.status !== "retired") diff.added.push(n.slug);
      continue;
    }
    if (n.evidence > before.evidence) diff.grown.push(n.slug);
    if (n.status === "dormant" && before.status !== "dormant") diff.dormant.push(n.slug);
    if (n.status === "retired" && before.status !== "retired") diff.retired.push(n.slug);
  }
  for (const before of prev.values()) {
    if (!nodes.has(before.slug) && before.status !== "retired") diff.retired.push(before.slug);
  }

  const insights = deriveInsights(live, trimmedEdges, input.demand);
  const coveredRoles = input.demand.filter((r) => {
    if (!r.open) return false;
    const need = (r.mustHave ?? []).map(slugify).filter(Boolean);
    if (!need.length) return true;
    return need.every((s) => (supplyBySlug.get(s) ?? 0) > 0);
  }).length;
  const openRoles = input.demand.filter((r) => r.open).length;

  return {
    nodes: live.sort((a, b) => b.supply + b.demand - (a.supply + a.demand)),
    edges: trimmedEdges,
    insights,
    diff,
    stats: {
      candidates: input.candidates.length,
      requisitions: openRoles,
      nodeCount: live.length,
      edgeCount: trimmedEdges.length,
      scarce: live.filter((n) => n.scarcity >= 60).length,
      dormant: live.filter((n) => n.status === "dormant").length,
      coverage: openRoles ? Math.round((coveredRoles / openRoles) * 100) : 100,
    },
  };
}

/** Prescriptions a CHRO can act on, derived from the graph itself. */
export function deriveInsights(
  nodes: OntologyNode[],
  edges: OntologyEdge[],
  demand: OntologyDemandRow[],
): OntologyInsight[] {
  const out: OntologyInsight[] = [];
  const bySlug = new Map(nodes.map((n) => [n.slug, n]));
  const now = Date.now();

  const scarce = nodes
    .filter((n) => n.demand > 0 && n.scarcity >= 60)
    .sort((a, b) => b.scarcity - a.scarcity)
    .slice(0, 6);
  if (scarce.length) {
    out.push({
      kind: "scarcity",
      title: "Skills your hiring plan cannot cover",
      detail: `${scarce
        .map((n) => `${n.name} (${n.supply} in pool for ${n.demand} weighted openings)`)
        .join(", ")}. Open a sourcing campaign or relax these to good-to-have.`,
      severity: "high",
      skills: scarce.map((n) => n.slug),
      actionTo: "/matching",
      actionLabel: "Open matching",
    });
  }

  const bench = nodes
    .filter((n) => n.demand === 0 && n.supply >= 5)
    .sort((a, b) => b.supply - a.supply)
    .slice(0, 6);
  if (bench.length) {
    out.push({
      kind: "bench",
      title: "Deep bench nobody is hiring for",
      detail: `${bench.map((n) => `${n.name} (${n.supply})`).join(", ")} sit unused. Redeploy through internal postings before sourcing outside.`,
      severity: "low",
      skills: bench.map((n) => n.slug),
      actionTo: "/ijp",
      actionLabel: "Redeploy via internal postings",
    });
  }

  const emerging = nodes
    .filter((n) => (now - new Date(n.firstSeenAt).getTime()) / DAY <= 120 && n.supply >= 2)
    .sort((a, b) => b.supply - a.supply)
    .slice(0, 6);
  if (emerging.length) {
    out.push({
      kind: "emerging",
      title: "Skills entering your organisation",
      detail: `${emerging.map((n) => n.name).join(", ")} appeared in the last four months. Add them to job architecture and interview kits.`,
      severity: "medium",
      skills: emerging.map((n) => n.slug),
      actionTo: "/masters",
      actionLabel: "Update job architecture",
    });
  }

  const fading = nodes
    .filter((n) => n.status === "dormant")
    .sort((a, b) => new Date(a.lastSeenAt).getTime() - new Date(b.lastSeenAt).getTime())
    .slice(0, 6);
  if (fading.length) {
    out.push({
      kind: "fading",
      title: "Skills going dormant",
      detail: `${fading.map((n) => n.name).join(", ")} have had no fresh evidence for over a year. They are still searchable but will retire from the graph if nothing new arrives.`,
      severity: "low",
      skills: fading.map((n) => n.slug),
      actionTo: "/candidates",
      actionLabel: "Search the pool",
    });
  }

  // Bridge skills: strongly adjacent to a scarce skill and well supplied — reskill paths.
  const bridges: Array<{ from: string; to: string; supply: number; weight: number }> = [];
  for (const target of scarce) {
    for (const e of edges) {
      const other = e.from === target.slug ? e.to : e.to === target.slug ? e.from : null;
      if (!other) continue;
      const node = bySlug.get(other);
      if (!node || node.supply < 3) continue;
      bridges.push({ from: other, to: target.slug, supply: node.supply, weight: e.weight });
    }
  }
  bridges.sort((a, b) => b.weight * b.supply - a.weight * a.supply);
  if (bridges.length) {
    const top = bridges.slice(0, 4);
    out.push({
      kind: "bridge",
      title: "Reskilling paths into scarce skills",
      detail: top
        .map(
          (b) =>
            `${bySlug.get(b.from)?.name ?? b.from} → ${bySlug.get(b.to)?.name ?? b.to} (${b.supply} people already adjacent)`,
        )
        .join("; "),
      severity: "medium",
      skills: [...new Set(top.flatMap((b) => [b.from, b.to]))],
    });
  }

  const uncovered = demand
    .filter((r) => r.open)
    .map((r) => {
      const missing = (r.mustHave ?? [])
        .map(slugify)
        .filter((s) => s && (bySlug.get(s)?.supply ?? 0) === 0);
      return { title: r.title, missing };
    })
    .filter((r) => r.missing.length)
    .slice(0, 5);
  if (uncovered.length) {
    out.push({
      kind: "coverage",
      title: "Open roles with an empty pool on a must-have",
      detail: uncovered
        .map((r) => `${r.title} — no evidence for ${r.missing.map(prettyName).join(", ")}`)
        .join("; "),
      severity: "high",
      skills: [...new Set(uncovered.flatMap((r) => r.missing))],
      actionTo: "/requisitions",
      actionLabel: "Open requisitions",
    });
  }

  return out;
}
