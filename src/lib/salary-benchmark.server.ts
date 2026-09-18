/**
 * Salary benchmark research. Prompts the org's configured AI model — with live
 * web search armed — for market CTC ranges per career level, then normalises
 * whatever comes back onto the shared career ladder so the UI always renders
 * the full table.
 */
import { createHash } from "node:crypto";
import { z } from "zod";

import {
  CAREER_LEVELS,
  CONFIDENCE_ORDER,
  type BenchmarkLevel,
  type BenchmarkPayload,
  type CareerLevelKey,
} from "./career-ladder";
import { aiResearchJson, type AiConfig } from "./ai-gateway.server";

export type BenchmarkResearchInput = {
  title: string;
  location?: string | null;
  experienceMin: number;
  experienceMax: number;
  currency: string;
};

export type BenchmarkResult = {
  payload: BenchmarkPayload;
  confidence: "high" | "medium" | "low";
  provider: string;
  model: string;
};

/** Deterministic cache key so identical role inputs reuse a recent run. */
export function benchmarkInputKey(input: {
  title: string;
  location?: string | null;
  experienceMin: number;
  experienceMax: number;
}) {
  return createHash("sha1")
    .update(
      [
        input.title.trim().toLowerCase(),
        (input.location ?? "").trim().toLowerCase(),
        input.experienceMin,
        input.experienceMax,
      ].join("|"),
    )
    .digest("hex");
}

const LevelSchema = z.object({
  key: z.string(),
  low: z.coerce.number().positive(),
  median: z.coerce.number().positive(),
  high: z.coerce.number().positive(),
  confidence: z.enum(["high", "medium", "low"]).default("medium"),
  sources: z.array(z.object({ title: z.string().default(""), url: z.string() })).default([]),
});
const OutputSchema = z.object({
  currency: z.string().default("INR"),
  notes: z.string().optional(),
  levels: z.array(LevelSchema).min(1),
});

const SYSTEM =
  "You are a meticulous compensation research analyst. Ground every number in sources you can " +
  "actually open with web search; where evidence is thin, say low confidence rather than " +
  "inventing precision.";

function buildPrompt(input: BenchmarkResearchInput) {
  const levelRows = CAREER_LEVELS.map(
    (l) => `- key: ${l.key} | level: ${l.label} | experience band: ${l.band}`,
  ).join("\n");
  return `Research current market salary data for this role and return annual cost-to-company (CTC) ranges.

Role: ${input.title}
Location: ${input.location?.trim() || "not specified — use the national market"}
Experience required: ${input.experienceMin}–${input.experienceMax} years
Currency: ${input.currency} per year (annual gross CTC — fixed pay plus typical variable)

Use web search to consult public salary sources (e.g. Glassdoor, AmbitionBox, Payscale, LinkedIn, Levels.fyi, recruiting-firm salary guides). Prefer data from the last 12–18 months, and adjust for the location's market when sources report a different city.

Return a row for EVERY level below, using the exact keys, in this order:
${levelRows}

Each level needs:
- low / median / high: annual CTC in ${input.currency} as whole numbers (roughly 25th / 50th / 75th percentiles)
- confidence: "high" | "medium" | "low"
- sources: 2–4 entries [{title, url}] you actually consulted

Levels sharing an experience band (e.g. Lead vs Manager, Intern vs Junior) must still reflect real market differences between those levels. Keep the ladder monotonic where the market is — a higher level should not be paid less than the one below it.

Respond with a single raw JSON object:
{"currency":"${input.currency}","notes":"<one short paragraph: assumptions, demand signals, caveats>","levels":[{"key":"intern","low":0,"median":0,"high":0,"confidence":"medium","sources":[{"title":"…","url":"https://…"}]}]}`;
}

/** Loose key matching — models return "VP/Head", "Senior ", "MID", aliases. */
function normaliseKey(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_");
}

const KEY_ALIASES: Record<string, CareerLevelKey> = {
  vp: "vp_head",
  vphead: "vp_head",
  head: "vp_head",
  vice_president: "vp_head",
  entry: "junior",
  associate: "junior",
  intermediate: "mid",
  principal: "lead",
  staff: "lead",
  engineering_manager: "manager",
  em: "manager",
  dir: "director",
};

function resolveLevel(rawKey: string): CareerLevelKey | null {
  const key = normaliseKey(rawKey);
  if ((CAREER_LEVELS as { key: string }[]).some((l) => l.key === key)) return key as CareerLevelKey;
  const byLabel = CAREER_LEVELS.find((l) => normaliseKey(l.label) === key);
  if (byLabel) return byLabel.key;
  const alias = KEY_ALIASES[key];
  if (alias) return alias;
  for (const [aliasPart, target] of Object.entries(KEY_ALIASES)) {
    if (key.includes(aliasPart)) return target;
  }
  return null;
}

/** low ≤ median ≤ high, all non-negative whole numbers. */
function orderNumbers(low: number, median: number, high: number) {
  const sorted = [low, median, high]
    .map((n) => Math.max(0, Math.round(Number.isFinite(n) ? n : 0)))
    .sort((a, b) => a - b);
  return { low: sorted[0] ?? 0, median: sorted[1] ?? sorted[0] ?? 0, high: sorted[2] ?? 0 };
}

export async function researchSalaryBenchmark(
  input: BenchmarkResearchInput,
  config?: AiConfig,
): Promise<BenchmarkResult> {
  const ai = await aiResearchJson<unknown>({
    system: SYSTEM,
    prompt: buildPrompt(input),
    ...(config ? { config } : {}),
  });
  if (!ai.ok) throw new Error(ai.message);

  const parsed = OutputSchema.safeParse(ai.data);
  if (!parsed.success) {
    throw new Error("The model's answer did not match the expected benchmark shape — try again.");
  }

  const returned = new Map<CareerLevelKey, z.infer<typeof LevelSchema>>();
  for (const level of parsed.data.levels) {
    const key = resolveLevel(level.key);
    if (key && !returned.has(key)) returned.set(key, level);
  }

  // Fill gaps by scaling the nearest returned level to the missing band's
  // midpoint — flagged low-confidence with no sources so the UI is honest.
  const bandMid = (l: (typeof CAREER_LEVELS)[number]) => (l.expMin + l.expMax) / 2;
  const levels: BenchmarkLevel[] = CAREER_LEVELS.map((ladder, i) => {
    const hit = returned.get(ladder.key);
    if (hit) {
      const { low, median, high } = orderNumbers(hit.low, hit.median, hit.high);
      return {
        key: ladder.key,
        label: ladder.label,
        expBand: { min: ladder.expMin, max: ladder.expMax, label: ladder.band },
        low,
        median,
        high,
        confidence: hit.confidence,
        sources: hit.sources.filter((s) => s.url.startsWith("http")),
      };
    }
    let nearestIdx = -1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let j = 0; j < CAREER_LEVELS.length; j++) {
      const level = CAREER_LEVELS[j];
      if (!level || !returned.has(level.key)) continue;
      const d = Math.abs(i - j);
      if (d < bestDistance) {
        bestDistance = d;
        nearestIdx = j;
      }
    }
    const nearest = nearestIdx >= 0 ? CAREER_LEVELS[nearestIdx] : undefined;
    const near = nearest ? returned.get(nearest.key) : undefined;
    if (!nearest || !near) {
      return {
        key: ladder.key,
        label: ladder.label,
        expBand: { min: ladder.expMin, max: ladder.expMax, label: ladder.band },
        low: 0,
        median: 0,
        high: 0,
        confidence: "low",
        sources: [],
      };
    }
    const scale = bandMid(nearest) > 0 ? bandMid(ladder) / bandMid(nearest) : 1;
    const { low, median, high } = orderNumbers(
      near.low * scale,
      near.median * scale,
      near.high * scale,
    );
    return {
      key: ladder.key,
      label: ladder.label,
      expBand: { min: ladder.expMin, max: ladder.expMax, label: ladder.band },
      low,
      median,
      high,
      confidence: "low",
      sources: [],
    };
  });

  const confidence = levels.reduce<"high" | "medium" | "low">(
    (min, l) => (CONFIDENCE_ORDER[l.confidence] < CONFIDENCE_ORDER[min] ? l.confidence : min),
    "high",
  );

  return {
    payload: {
      currency: parsed.data.currency || input.currency,
      grounded: ai.grounded,
      ...(parsed.data.notes ? { notes: parsed.data.notes } : {}),
      levels,
    },
    confidence,
    provider: ai.provider,
    model: ai.model,
  };
}
