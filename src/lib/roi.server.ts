/**
 * Return on Individual (RoI) — the semantic layer between hiring data and
 * what the organisation can actually do with the people it hired.
 *
 * Pure computation only: no database, no AI, no request context. Everything is
 * derived from hiring records plus the Talent Brain ontology so every number a
 * CHRO sees can be traced back to the evidence that produced it.
 */
import type { OntologyNode } from "./ontology.server";

export type RoiHireInput = {
  applicationId: string;
  candidateId: string;
  name: string;
  requisitionTitle: string | null;
  department: string | null;
  stage: string;
  appliedAt: string;
  joinedAt: string | null;
  skills: string[];
  experienceYears: number;
  /** Cost actually committed (offer), when an offer exists. */
  offeredCtc: number | null;
  /** Budget on the requisition — the fallback cost anchor. */
  budgetCtc: number | null;
  scores: {
    overall: number | null;
    skills: number | null;
    experience: number | null;
    career: number | null;
    impact: number | null;
    innovation: number | null;
    education: number | null;
    social: number | null;
  };
};

export type RoiHire = {
  applicationId: string;
  candidateId: string;
  name: string;
  requisitionTitle: string | null;
  department: string | null;
  /** 0–100: how much capability this individual brings the organisation. */
  capability: number;
  /** Cost committed or budgeted, in org currency. */
  cost: number | null;
  costBasis: "offer" | "budget" | "unknown";
  /** 100 = exactly the value the median hire returns for the money. */
  roiIndex: number;
  verdict: "compounding" | "solid" | "watch";
  daysToHire: number | null;
  /** Scarce, in-demand capabilities this person brings into the organisation. */
  scarceSkills: string[];
  /** Capabilities where this person is currently the only real source. */
  soleSourceSkills: string[];
  contribution: Array<{ label: string; value: number; weight: number }>;
  evidence: string[];
};

export type CapabilityGoal = {
  id: string;
  title: string;
  outcome: string;
  horizon: string;
  readiness: number;
  status: "ready" | "partial" | "gap";
  covered: string[];
  missing: string[];
  contributors: Array<{ candidateId: string; name: string; skills: string[] }>;
  note: string;
};

export type OrgReading = {
  kind: "strength" | "weakness";
  title: string;
  detail: string;
  severity: "high" | "medium" | "low";
  skills: string[];
};

export type RoiReport = {
  hires: RoiHire[];
  goals: CapabilityGoal[];
  readings: OrgReading[];
  totals: {
    hires: number;
    scored: number;
    portfolioRoi: number;
    avgCapability: number;
    committedCost: number;
    costBasis: "offer" | "budget" | "mixed" | "unknown";
    costPerCapabilityPoint: number | null;
    medianCost: number | null;
    avgDaysToHire: number | null;
    compounding: number;
    watch: number;
    scarceCovered: number;
    soleSource: number;
    goalsReady: number;
    goalsPartial: number;
  };
  departments: Array<{
    name: string;
    hires: number;
    capability: number;
    roiIndex: number;
    cost: number;
  }>;
  /** Honest description of what the numbers are built on. */
  basis: string[];
};

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));
const round = (n: number) => Math.round(n * 10) / 10;

function median(values: number[]): number | null {
  const sorted = values.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s/g, "-");

/**
 * What an organisation can go and do, expressed as programmes rather than
 * skills. Each blueprint lists the capabilities the programme cannot start
 * without, plus the ones that make it go faster.
 */
const GOAL_BLUEPRINTS: Array<{
  id: string;
  title: string;
  outcome: string;
  horizon: string;
  needs: string[][];
  nice: string[];
}> = [
  {
    id: "ml-platform",
    title: "Production ML platform",
    outcome: "Take models from notebook to monitored production service.",
    horizon: "2–3 quarters",
    needs: [
      ["python"],
      ["machine-learning", "deep-learning", "data-science"],
      ["docker", "kubernetes", "mlops", "devops"],
      ["sql", "postgresql", "spark"],
    ],
    nice: ["aws", "azure", "gcp", "airflow", "pytorch", "tensorflow"],
  },
  {
    id: "genai-copilot",
    title: "Enterprise AI copilot",
    outcome: "Ship an LLM assistant on top of internal knowledge, with guardrails.",
    horizon: "1–2 quarters",
    needs: [
      ["python", "typescript", "javascript"],
      ["llm", "generative-ai", "nlp", "machine-learning"],
      ["api", "node", "fastapi", "backend"],
    ],
    nice: ["vector-database", "react", "prompt-engineering", "aws", "azure"],
  },
  {
    id: "data-platform",
    title: "Unified data & reporting platform",
    outcome: "One governed source of truth feeding executive reporting.",
    horizon: "2 quarters",
    needs: [
      ["sql", "postgresql", "mysql", "snowflake"],
      ["etl", "data-engineering", "airflow", "spark"],
      ["power-bi", "tableau", "looker", "data-analysis"],
    ],
    nice: ["python", "dbt", "aws", "azure"],
  },
  {
    id: "cloud-modernisation",
    title: "Cloud modernisation & cost programme",
    outcome: "Move core workloads to cloud with cost and reliability under control.",
    horizon: "2–3 quarters",
    needs: [
      ["aws", "azure", "gcp"],
      ["kubernetes", "docker"],
      ["terraform", "devops", "ci-cd", "jenkins"],
    ],
    nice: ["linux", "monitoring", "python"],
  },
  {
    id: "customer-product",
    title: "New customer-facing product",
    outcome: "Design, build and launch a revenue-facing web product.",
    horizon: "1–2 quarters",
    needs: [
      ["react", "angular", "vue", "next"],
      ["typescript", "javascript"],
      ["node", "java", "python", "backend", "spring"],
    ],
    nice: ["ui-ux", "figma", "postgresql", "graphql", "product-management"],
  },
  {
    id: "mobile-launch",
    title: "Mobile channel launch",
    outcome: "Put the product in customers' hands on iOS and Android.",
    horizon: "2 quarters",
    needs: [
      ["react-native", "flutter", "android", "ios", "kotlin", "swift"],
      ["api", "node", "java", "backend"],
    ],
    nice: ["ui-ux", "firebase", "typescript"],
  },
  {
    id: "platform-modernisation",
    title: "Core platform modernisation",
    outcome: "Break the monolith into services that teams can ship independently.",
    horizon: "3 quarters",
    needs: [
      ["java", "node", "dotnet", "python", "golang"],
      ["microservices", "api", "spring"],
      ["postgresql", "mysql", "mongodb", "sql"],
    ],
    nice: ["docker", "kubernetes", "kafka", "redis"],
  },
  {
    id: "quality-automation",
    title: "Release quality automation",
    outcome: "Cut regression cycles with automated test and release gates.",
    horizon: "1 quarter",
    needs: [
      ["automation-testing", "selenium", "cypress", "playwright", "qa"],
      ["ci-cd", "jenkins", "devops", "github-actions"],
    ],
    nice: ["javascript", "python", "api-testing"],
  },
  {
    id: "security-hardening",
    title: "Security & compliance hardening",
    outcome: "Close audit findings and stand up continuous security control.",
    horizon: "2 quarters",
    needs: [
      ["security", "cyber-security", "application-security", "iam"],
      ["cloud-security", "aws", "azure", "devops"],
    ],
    nice: ["linux", "networking", "compliance"],
  },
  {
    id: "gtm-scale",
    title: "Go-to-market scale-up",
    outcome: "Scale pipeline generation and customer success capacity.",
    horizon: "1–2 quarters",
    needs: [
      ["sales", "business-development", "account-management"],
      ["marketing", "digital-marketing", "crm", "salesforce"],
    ],
    nice: ["data-analysis", "communication", "customer-success"],
  },
];

const CAPABILITY_WEIGHTS = [
  { key: "match", label: "JD ↔ CV match", weight: 0.28 },
  { key: "scarcity", label: "Scarce capability brought in", weight: 0.24 },
  { key: "impact", label: "Delivered impact", weight: 0.16 },
  { key: "innovation", label: "Innovation signal", weight: 0.1 },
  { key: "career", label: "Career trajectory", weight: 0.12 },
  { key: "breadth", label: "Capability breadth", weight: 0.1 },
] as const;

export type RoiInput = {
  hires: RoiHireInput[];
  nodes: OntologyNode[];
  /** Number of open requisitions — used to describe demand pressure. */
  openRequisitions: number;
};

export function buildRoi(input: RoiInput): RoiReport {
  const nodeBySlug = new Map<string, OntologyNode>();
  for (const n of input.nodes) {
    nodeBySlug.set(n.slug, n);
    for (const alias of n.aliases ?? []) nodeBySlug.set(slugify(alias), n);
  }

  const resolve = (skill: string) => nodeBySlug.get(slugify(skill));

  // Who supplies each capability, so we can see single points of failure.
  const suppliers = new Map<string, Set<string>>();
  for (const h of input.hires) {
    for (const s of h.skills) {
      const node = resolve(s);
      if (!node) continue;
      const set = suppliers.get(node.slug) ?? new Set<string>();
      set.add(h.candidateId);
      suppliers.set(node.slug, set);
    }
  }

  const costs = input.hires.map((h) => Number(h.offeredCtc ?? h.budgetCtc ?? 0));
  const medianCost = median(costs);

  const hires: RoiHire[] = input.hires.map((h) => {
    const resolved = h.skills.map(resolve).filter(Boolean) as OntologyNode[];
    const scarce = resolved.filter((n) => n.demand > 0 && n.scarcity >= 55);
    const sole = resolved.filter((n) => (suppliers.get(n.slug)?.size ?? 0) <= 1 && n.demand > 0);

    // Scarcity value: how much of what the organisation is short of this person covers.
    const scarcityScore = resolved.length
      ? clamp(
          (scarce.reduce((sum, n) => sum + n.scarcity, 0) / Math.max(resolved.length, 1)) * 1.4 +
            scarce.length * 6,
          0,
          100,
        )
      : 0;

    const matchScore =
      h.scores.overall ??
      (h.scores.skills !== null && h.scores.experience !== null
        ? (h.scores.skills + h.scores.experience) / 2
        : null);
    const breadth = clamp(resolved.length * 9, 0, 100);
    const careerScore =
      h.scores.career ?? clamp((h.experienceYears / 15) * 100, 0, 100);
    const impactScore = h.scores.impact ?? clamp((h.experienceYears / 12) * 90, 0, 100);
    const innovationScore = h.scores.innovation ?? clamp(scarce.length * 18, 0, 100);

    const raw: Record<string, number> = {
      match: matchScore ?? clamp(60 + h.experienceYears * 2, 0, 100),
      scarcity: scarcityScore,
      impact: impactScore,
      innovation: innovationScore,
      career: careerScore,
      breadth,
    };

    const capability = clamp(
      CAPABILITY_WEIGHTS.reduce((sum, c) => sum + (raw[c.key] ?? 0) * c.weight, 0),
      0,
      100,
    );

    const cost = h.offeredCtc ?? h.budgetCtc ?? null;
    const costBasis: RoiHire["costBasis"] =
      h.offeredCtc !== null ? "offer" : h.budgetCtc !== null ? "budget" : "unknown";

    // 100 = the capability the median-cost hire returns. Above 100 the
    // organisation is getting more capability per rupee than its own median.
    const roiIndex =
      cost && medianCost
        ? clamp(Math.round(capability * (medianCost / cost)), 0, 250)
        : Math.round(capability);

    const daysToHire =
      h.joinedAt && h.appliedAt
        ? Math.max(
            0,
            Math.round(
              (new Date(h.joinedAt).getTime() - new Date(h.appliedAt).getTime()) / 86_400_000,
            ),
          )
        : null;

    const evidence: string[] = [];
    if (matchScore !== null)
      evidence.push(`Weighted JD ↔ CV match scored ${Math.round(matchScore)}/100.`);
    if (scarce.length)
      evidence.push(
        `Brings ${scarce.length} capability${scarce.length > 1 ? "ies" : ""} the organisation is short of.`,
      );
    if (sole.length)
      evidence.push(
        `Only source for ${sole
          .slice(0, 3)
          .map((n) => n.name)
          .join(", ")} — succession risk.`,
      );
    if (costBasis === "budget")
      evidence.push("Cost read from the requisition budget; no released offer on record yet.");
    if (costBasis === "unknown") evidence.push("No cost on record — value shown without a cost view.");
    if (daysToHire !== null) evidence.push(`Closed in ${daysToHire} days from application.`);

    return {
      applicationId: h.applicationId,
      candidateId: h.candidateId,
      name: h.name,
      requisitionTitle: h.requisitionTitle,
      department: h.department,
      capability: round(capability),
      cost: cost === null ? null : Number(cost),
      costBasis,
      roiIndex,
      verdict: roiIndex >= 120 ? "compounding" : roiIndex >= 80 ? "solid" : "watch",
      daysToHire,
      scarceSkills: scarce.slice(0, 6).map((n) => n.name),
      soleSourceSkills: sole.slice(0, 6).map((n) => n.name),
      contribution: CAPABILITY_WEIGHTS.map((c) => ({
        label: c.label,
        value: Math.round(raw[c.key] ?? 0),
        weight: c.weight,
      })),
      evidence,
    };
  });

  // ---- capability → goal engine -------------------------------------------
  const goals: CapabilityGoal[] = GOAL_BLUEPRINTS.map((bp) => {
    const covered: string[] = [];
    const missing: string[] = [];
    const contributorIds = new Map<string, Set<string>>();

    for (const group of bp.needs) {
      let hit: OntologyNode | null = null;
      for (const slug of group) {
        const node = nodeBySlug.get(slug);
        if (node && node.weight > 0) {
          hit = node;
          break;
        }
      }
      if (hit) {
        covered.push(hit.name);
      } else {
        missing.push(prettyGroup(group));
      }
    }

    // Contributors: hires whose skills touch any capability this goal needs.
    const needSlugs = new Set(bp.needs.flat());
    for (const h of input.hires) {
      const matched = h.skills
        .map((s) => resolve(s))
        .filter((n): n is OntologyNode => Boolean(n) && needSlugs.has(n!.slug))
        .map((n) => n.name);
      if (matched.length) {
        const set = contributorIds.get(h.candidateId) ?? new Set<string>();
        matched.forEach((m) => set.add(m));
        contributorIds.set(h.candidateId, set);
      }
    }

    const readiness = Math.round((covered.length / bp.needs.length) * 100);
    const niceHits = bp.nice.filter((slug) => (nodeBySlug.get(slug)?.weight ?? 0) > 0).length;
    const boosted = clamp(readiness + Math.min(niceHits * 3, 12), 0, 100);
    const status: CapabilityGoal["status"] =
      boosted >= 80 ? "ready" : boosted >= 45 ? "partial" : "gap";

    const contributors = Array.from(contributorIds.entries())
      .map(([candidateId, skills]) => ({
        candidateId,
        name: input.hires.find((h) => h.candidateId === candidateId)?.name ?? "Team member",
        skills: Array.from(skills).slice(0, 4),
      }))
      .slice(0, 6);

    const note =
      status === "ready"
        ? `Every core capability is on the bench — ${contributors.length || "no"} named ${
            contributors.length === 1 ? "person" : "people"
          } from recent hiring can staff it.`
        : status === "partial"
          ? `Startable with a lead hire: ${missing.slice(0, 2).join(" and ") || "one gap"} still missing.`
          : `Not staffable today — ${missing.slice(0, 3).join(", ")} absent from the organisation.`;

    return {
      id: bp.id,
      title: bp.title,
      outcome: bp.outcome,
      horizon: bp.horizon,
      readiness: boosted,
      status,
      covered,
      missing,
      contributors,
      note,
    };
  }).sort((a, b) => b.readiness - a.readiness);

  // ---- organisation strengths & weaknesses --------------------------------
  const readings: OrgReading[] = [];
  const active = input.nodes.filter((n) => n.status === "active");

  const deep = active
    .filter((n) => n.weight >= 3 && n.scarcity < 55)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, 6);
  if (deep.length) {
    readings.push({
      kind: "strength",
      title: "Deep bench the organisation can build on",
      detail: `${deep.length} capabilities carry real depth — ${deep
        .slice(0, 3)
        .map((n) => n.name)
        .join(", ")} can absorb new work without hiring first.`,
      severity: "high",
      skills: deep.map((n) => n.name),
    });
  }

  const validatedStrong = active
    .filter((n) => n.validated >= 2)
    .sort((a, b) => b.validated - a.validated)
    .slice(0, 6);
  if (validatedStrong.length) {
    readings.push({
      kind: "strength",
      title: "Capabilities proven through the funnel",
      detail: `${validatedStrong
        .slice(0, 3)
        .map((n) => n.name)
        .join(", ")} were validated by interviews and offers, not just claimed on CVs.`,
      severity: "medium",
      skills: validatedStrong.map((n) => n.name),
    });
  }

  const shortages = active
    .filter((n) => n.demand > 0 && n.scarcity >= 65)
    .sort((a, b) => b.scarcity - a.scarcity)
    .slice(0, 8);
  if (shortages.length) {
    readings.push({
      kind: "weakness",
      title: "Demand the organisation cannot cover",
      detail: `${shortages.length} capabilities are being asked for faster than the bench can supply — ${shortages
        .slice(0, 3)
        .map((n) => n.name)
        .join(", ")} lead the shortfall.`,
      severity: "high",
      skills: shortages.map((n) => n.name),
    });
  }

  const soloSkills = Array.from(suppliers.entries())
    .filter(([slug, set]) => set.size === 1 && (nodeBySlug.get(slug)?.demand ?? 0) > 0)
    .map(([slug]) => nodeBySlug.get(slug)!.name)
    .slice(0, 8);
  if (soloSkills.length) {
    readings.push({
      kind: "weakness",
      title: "Single-person dependencies",
      detail: `${soloSkills.length} in-demand capabilities rest on one hire — ${soloSkills
        .slice(0, 3)
        .join(", ")}. Plan a second owner or a succession bench.`,
      severity: "high",
      skills: soloSkills,
    });
  }

  const dormant = input.nodes.filter((n) => n.status === "dormant").slice(0, 8);
  if (dormant.length) {
    readings.push({
      kind: "weakness",
      title: "Capability going quiet",
      detail: `${dormant.length} capabilities have had no fresh evidence recently — ${dormant
        .slice(0, 3)
        .map((n) => n.name)
        .join(", ")}. Refresh, redeploy or retire them.`,
      severity: "medium",
      skills: dormant.map((n) => n.name),
    });
  }

  // ---- rollups -------------------------------------------------------------
  const withCost = hires.filter((h) => h.cost && h.cost > 0);
  const committedCost = withCost.reduce((sum, h) => sum + (h.cost ?? 0), 0);
  const capabilitySum = hires.reduce((sum, h) => sum + h.capability, 0);
  const basisSet = new Set(hires.map((h) => h.costBasis));
  const costBasis: RoiReport["totals"]["costBasis"] =
    basisSet.size > 1
      ? "mixed"
      : basisSet.has("offer")
        ? "offer"
        : basisSet.has("budget")
          ? "budget"
          : "unknown";

  const deptMap = new Map<string, { hires: number; capability: number; roi: number; cost: number }>();
  for (const h of hires) {
    const key = h.department ?? "Unassigned";
    const row = deptMap.get(key) ?? { hires: 0, capability: 0, roi: 0, cost: 0 };
    row.hires += 1;
    row.capability += h.capability;
    row.roi += h.roiIndex;
    row.cost += h.cost ?? 0;
    deptMap.set(key, row);
  }

  const days = hires.map((h) => h.daysToHire).filter((d): d is number => d !== null);

  const basis: string[] = [
    `${hires.length} hired or joined individuals, scored against ${input.nodes.length} capabilities in the Talent Brain.`,
  ];
  if (costBasis !== "offer")
    basis.push(
      "Where no offer is released, cost falls back to the requisition budget — the RoI index is then indicative, not committed spend.",
    );
  if (input.hires.some((h) => h.scores.overall === null))
    basis.push("Hires without a weighted match score use experience and capability breadth instead.");
  basis.push(`${input.openRequisitions} open requisitions set the demand side of every scarcity read.`);

  return {
    hires: hires.sort((a, b) => b.roiIndex - a.roiIndex),
    goals,
    readings,
    totals: {
      hires: hires.length,
      scored: input.hires.filter((h) => h.scores.overall !== null).length,
      portfolioRoi: hires.length
        ? Math.round(hires.reduce((sum, h) => sum + h.roiIndex, 0) / hires.length)
        : 0,
      avgCapability: hires.length ? round(capabilitySum / hires.length) : 0,
      committedCost,
      costBasis,
      costPerCapabilityPoint:
        capabilitySum > 0 && committedCost > 0 ? Math.round(committedCost / capabilitySum) : null,
      medianCost,
      avgDaysToHire: days.length
        ? Math.round(days.reduce((a, b) => a + b, 0) / days.length)
        : null,
      compounding: hires.filter((h) => h.verdict === "compounding").length,
      watch: hires.filter((h) => h.verdict === "watch").length,
      scarceCovered: new Set(hires.flatMap((h) => h.scarceSkills)).size,
      soleSource: soloSkills.length,
      goalsReady: goals.filter((g) => g.status === "ready").length,
      goalsPartial: goals.filter((g) => g.status === "partial").length,
    },
    departments: Array.from(deptMap.entries())
      .map(([name, row]) => ({
        name,
        hires: row.hires,
        capability: round(row.capability / row.hires),
        roiIndex: Math.round(row.roi / row.hires),
        cost: row.cost,
      }))
      .sort((a, b) => b.roiIndex - a.roiIndex),
    basis,
  };
}

function prettyGroup(group: string[]): string {
  const first = group[0] ?? "capability";
  return first
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
