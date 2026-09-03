/**
 * Requisition / JD duplicate detection.
 *
 * Two requisitions are near-duplicates when they hire for essentially the same
 * role: similar title, same department (when both name one), overlapping
 * locations and overlapping must-have skills. Only live requisitions are
 * compared — closed and rejected ones are history, not duplicates.
 */

const STOP = new Set([
  "a", "an", "the", "and", "or", "of", "for", "to", "in", "at", "with",
  "senior", "sr", "junior", "jr", "lead", "principal", "staff", "i", "ii", "iii",
  "engineer2", "specialist", "executive", "officer",
]);

const LIVE_STATUSES = new Set([
  "draft",
  "pending_dh",
  "pending_hr",
  "pending_cbo",
  "approved",
  "on_hold",
]);

function tokens(text: string | null | undefined) {
  return new Set(
    (text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9+#. ]+/g, " ")
      .split(/\s+/)
      .map((t) => t.trim())
      .filter((t) => t.length > 1 && !STOP.has(t)),
  );
}

function jaccard(a: Set<string>, b: Set<string>) {
  if (!a.size || !b.size) return 0;
  let hit = 0;
  for (const t of a) if (b.has(t)) hit += 1;
  return hit / (a.size + b.size - hit);
}

function listTokens(values: string[] | null | undefined) {
  return new Set((values ?? []).map((v) => v.trim().toLowerCase()).filter(Boolean));
}

export type ReqLike = {
  id: string;
  code: string;
  title: string;
  status: string;
  department_id: string | null;
  location: string | null;
  must_have_skills: string[] | null;
  openings?: number | null;
};

export type DuplicateMatch = {
  req: ReqLike;
  score: number;
  reasons: string[];
};

/** Candidate duplicates for a draft requisition, strongest first. */
export function findDuplicateRequisitions(
  draft: {
    title: string;
    department_id?: string | null;
    location?: string | null;
    must_have_skills?: string[] | null;
  },
  existing: ReqLike[],
  opts: { excludeId?: string } = {},
): DuplicateMatch[] {
  const dTitle = tokens(draft.title);
  if (!dTitle.size) return [];
  const dSkills = listTokens(draft.must_have_skills);
  const dLoc = tokens(draft.location);

  const out: DuplicateMatch[] = [];
  for (const r of existing) {
    if (opts.excludeId && r.id === opts.excludeId) continue;
    if (!LIVE_STATUSES.has(r.status)) continue;

    const titleSim = jaccard(dTitle, tokens(r.title));
    if (titleSim < 0.5) continue;

    const reasons: string[] = [];
    let score = titleSim;
    reasons.push(
      titleSim >= 0.99 ? "Identical role title" : `Very similar role title (${Math.round(titleSim * 100)}% match)`,
    );

    if (draft.department_id && r.department_id && draft.department_id === r.department_id) {
      score += 0.25;
      reasons.push("Same department");
    }

    const locSim = jaccard(dLoc, tokens(r.location));
    if (locSim > 0) {
      score += 0.15 * locSim;
      reasons.push("Overlapping location");
    }

    const skillSim = jaccard(dSkills, listTokens(r.must_have_skills));
    if (skillSim >= 0.4) {
      score += 0.2 * skillSim;
      reasons.push(`Must-have skills overlap (${Math.round(skillSim * 100)}%)`);
    }

    out.push({ req: r, score: Math.min(1, score), reasons });
  }
  return out.sort((a, b) => b.score - a.score).slice(0, 5);
}
