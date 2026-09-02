/**
 * Deterministic, zero-cost pre-ranking of the talent pool against a JD.
 * Used to suggest who to pull into a requisition BEFORE spending AI calls;
 * the real scoring still runs through the AI matching pipeline.
 */
import type { Candidate, Requisition } from "@/lib/data";

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9+#.]/g, "");

export type PoolRank = {
  candidate: Candidate;
  /** 0-100 cheap overlap score. */
  fit: number;
  mustHits: string[];
  mustMisses: string[];
  goodHits: string[];
  experienceOk: boolean;
  locationOk: boolean;
};

export function rankPool(
  candidates: Candidate[],
  req: Pick<
    Requisition,
    "must_have_skills" | "good_to_have_skills" | "experience_min" | "experience_max" | "location"
  >,
): PoolRank[] {
  const must = (req.must_have_skills ?? []).filter(Boolean);
  const good = (req.good_to_have_skills ?? []).filter(Boolean);
  const reqLocations = (req.location ?? "")
    .split(/[|,]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return candidates
    .map((c) => {
      const haystack = [...(c.skills ?? []), c.resume_text ?? ""].map(norm).join(" ");
      const has = (skill: string) => haystack.includes(norm(skill));

      const mustHits = must.filter(has);
      const mustMisses = must.filter((s) => !has(s));
      const goodHits = good.filter(has);

      const mustPart = must.length ? (mustHits.length / must.length) * 70 : 55;
      const goodPart = good.length ? (goodHits.length / good.length) * 15 : 10;

      const years = Number(c.experience_years) || 0;
      const experienceOk = years >= req.experience_min && years <= req.experience_max;
      const expPart = experienceOk ? 15 : years < req.experience_min ? Math.max(0, 15 - (req.experience_min - years) * 4) : 8;

      const locationOk =
        reqLocations.length === 0 ||
        reqLocations.some((l) => (c.location ?? "").toLowerCase().includes(l.toLowerCase()));

      const fit = Math.round(Math.max(0, Math.min(100, mustPart + goodPart + expPart)));

      return { candidate: c, fit, mustHits, mustMisses, goodHits, experienceOk, locationOk };
    })
    .sort((a, b) => b.fit - a.fit);
}

/** Run an async mapper over a list with a hard concurrency ceiling. */
export async function mapWithLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return out;
}
