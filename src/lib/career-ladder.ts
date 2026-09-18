/**
 * Shared career ladder — client-safe constants mapping standard levels to
 * years-of-experience bands. Consumed by the salary benchmark (prompt + UI)
 * and by any surface that needs to name a level for an experience range.
 */

export type CareerLevelKey =
  "intern" | "junior" | "mid" | "senior" | "lead" | "manager" | "director" | "vp_head";

export type CareerLevel = {
  key: CareerLevelKey;
  label: string;
  expMin: number;
  expMax: number;
  band: string;
};

export const CAREER_LEVELS: CareerLevel[] = [
  { key: "intern", label: "Intern", expMin: 0, expMax: 2, band: "0–2 yrs" },
  { key: "junior", label: "Junior", expMin: 0, expMax: 2, band: "0–2 yrs" },
  { key: "mid", label: "Mid", expMin: 3, expMax: 5, band: "3–5 yrs" },
  { key: "senior", label: "Senior", expMin: 6, expMax: 9, band: "6–9 yrs" },
  { key: "lead", label: "Lead", expMin: 10, expMax: 15, band: "10–15 yrs" },
  { key: "manager", label: "Manager", expMin: 10, expMax: 15, band: "10–15 yrs" },
  { key: "director", label: "Director", expMin: 15, expMax: 40, band: "15+ yrs" },
  { key: "vp_head", label: "VP / Head", expMin: 15, expMax: 40, band: "15+ yrs" },
];

/**
 * Best career level for a requisition: explicit title keywords win ("Vice
 * President", "Engineering Manager"…), otherwise the first ladder level whose
 * band contains the experience midpoint.
 */
export function inferLevelKey(
  experienceMin: number,
  experienceMax: number,
  title?: string | null,
): CareerLevelKey {
  const t = (title ?? "").toLowerCase();
  if (/\bintern|\btrainee\b|\bapprentice\b/.test(t)) return "intern";
  if (/\bjunior\b|\bjr\.?\b/.test(t)) return "junior";
  if (/\bvp\b|vice president|chief|head of|president\b/.test(t)) return "vp_head";
  if (/\bdirector\b/.test(t)) return "director";
  if (/\bmanager\b/.test(t)) return "manager";
  if (/\blead\b/.test(t)) return "lead";

  const min = Number.isFinite(experienceMin) ? Math.max(0, experienceMin) : 0;
  const max = Number.isFinite(experienceMax) ? Math.max(min, experienceMax) : min;
  const mid = (min + max) / 2;
  const hit = CAREER_LEVELS.find((l) => mid >= l.expMin && mid <= l.expMax);
  return hit?.key ?? CAREER_LEVELS[2]?.key ?? "mid";
}

/* ------------------------------------------------- benchmark payload types */

export type BenchmarkSource = { title: string; url: string };

export type BenchmarkLevel = {
  key: CareerLevelKey;
  label: string;
  expBand: { min: number; max: number; label: string };
  low: number;
  median: number;
  high: number;
  confidence: "high" | "medium" | "low";
  sources: BenchmarkSource[];
};

export type BenchmarkPayload = {
  currency: string;
  grounded: boolean;
  notes?: string;
  levels: BenchmarkLevel[];
};

export const CONFIDENCE_ORDER: Record<"high" | "medium" | "low", number> = {
  high: 2,
  medium: 1,
  low: 0,
};

/** Compact money for table cells — ₹18L, ₹1.2Cr (falls back to en-IN grouping). */
export function formatMoney(value: number, currency = "INR") {
  try {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return `${Math.round(value).toLocaleString("en-IN")} ${currency}`;
  }
}
