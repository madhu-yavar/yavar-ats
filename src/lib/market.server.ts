/**
 * Market compensation agent.
 *
 * Fetches public salary pages in real time, strips them to readable text and
 * hands whatever came back to the configured model, which extracts a
 * low/median/high band per career level. Every band carries the sources that
 * were actually readable plus a confidence level, so HR can tell a researched
 * range apart from a model estimate.
 */

import { aiJson } from "./ai-gateway.server";

/** One quoted figure from a live page that supports a level's band. */
export type MarketEvidence = { source: string; url: string; quote: string };

export type MarketLevel = {
  level: string;
  experience_band: string;
  low: number;
  median: number;
  high: number;
  confidence: "high" | "medium" | "low";
  note: string;
  evidence: MarketEvidence[];
};

export type MarketSource = { title: string; url: string; read: boolean };

export type MarketBenchmark = {
  currency: string;
  role: string;
  location: string;
  as_of: string;
  levels: MarketLevel[];
  recommended: { budget: number; band_min: number; band_max: number; rationale: string };
  caveats: string[];
  sources: MarketSource[];
  /** Which model actually did the reasoning, so nobody has to guess. */
  engine: { provider: string; model: string };
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Public salary pages worth trying for a role + location. */
function candidateSources(role: string, location: string, currency: string) {
  const r = slug(role);
  const india =
    currency.toUpperCase() === "INR" ||
    /india|bengaluru|bangalore|chennai|mumbai|delhi|pune|hyderabad|noida|gurgaon|kolkata/i.test(
      location,
    );
  const q = encodeURIComponent(role.trim()).replace(/%20/g, "+");
  const list: { title: string; url: string }[] = [
    {
      title: `Talent.com salary — ${role}`,
      url: india
        ? `https://in.talent.com/salary?job=${q}`
        : `https://www.talent.com/salary?job=${q}`,
    },
    { title: `Levels.fyi — ${role}`, url: `https://www.levels.fyi/t/${r}` },
  ];
  if (india) {
    list.splice(1, 0, {
      title: `6figr — ${role} salary`,
      url: `https://6figr.com/in/salary/${r}--t`,
    });
    list.push({
      title: `AmbitionBox — ${role} salary`,
      url: `https://www.ambitionbox.com/profile/${r}-salary`,
    });
  } else {
    list.push({
      title: `Payscale — ${role}`,
      url: `https://www.payscale.com/research/US/Job=${encodeURIComponent(role)}/Salary`,
    });
  }
  return list.slice(0, 4);
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

async function readSource(url: string) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return null;
    const text = htmlToText(await res.text());
    // Only useful if the page actually mentions pay figures.
    if (!/salar|compensation|ctc|lpa|per year|annual/i.test(text)) return null;
    return text.slice(0, 7000);
  } catch {
    return null;
  }
}

export async function benchmarkMarket(input: {
  /** Org context for AI credential resolution. */
  orgId: string;
  role: string;
  location: string;
  currency: string;
  experienceMin: number;
  experienceMax: number;
  skills: string[];
  department?: string | null | undefined;
}): Promise<MarketBenchmark> {
  const wanted = candidateSources(input.role, input.location, input.currency);
  const fetched = await Promise.all(
    wanted.map(async (s) => ({ ...s, text: await readSource(s.url) })),
  );
  const sources: MarketSource[] = fetched.map((s) => ({
    title: s.title,
    url: s.url,
    read: Boolean(s.text),
  }));
  const evidence = fetched
    .filter((s) => s.text)
    .map((s) => `SOURCE: ${s.title} (${s.url})\n${s.text}`)
    .join("\n\n---\n\n");

  const result = await aiJson<MarketBenchmark>({
    orgId: input.orgId,
    system:
      "You are a compensation market-research analyst. From the supplied live web extracts, derive annual total " +
      "compensation bands for the role in the given location and currency, broken down by career level. " +
      "Use these levels, each mapped to an experience band: Intern (0-1 yrs), Junior (0-2), Mid (3-5), " +
      "Senior (6-9), Lead (10-15), Manager (10-15), Director (15+), VP/Head (15+). " +
      "Figures are absolute annual amounts in the requested currency (not lakhs, not abbreviated). " +
      "Set confidence 'high' only when a supplied source states figures for that level; 'medium' when " +
      "interpolated from supplied sources; 'low' when no source covered it and you are estimating. " +
      "Never invent a source. For every level, list the evidence you actually used: each entry is a short " +
      "VERBATIM quote from a supplied extract that mentions the pay figure, with the source title and its URL. " +
      "Leave evidence as an empty array when the level is an estimate with no supporting extract. " +
      "Return ONLY JSON with keys: currency, role, location, as_of (ISO date), " +
      "levels (array of {level, experience_band, low, median, high, confidence, note, evidence: [{source, url, quote}]}), " +
      "recommended ({budget, band_min, band_max, rationale}) sized for the requisition's own experience range, " +
      "caveats (2-4 short strings, including whether live sources were readable).",
    prompt: JSON.stringify({
      role: input.role,
      department: input.department ?? null,
      location: input.location,
      currency: input.currency,
      experience_range: [input.experienceMin, input.experienceMax],
      key_skills: input.skills.slice(0, 15),
      today: new Date().toISOString().slice(0, 10),
      live_sources_readable: sources.filter((s) => s.read).map((s) => s.url),
      live_source_extracts:
        evidence || "NONE — no public salary page was readable from the server.",
    }),
  });

  if (!result.ok) throw new Error(result.message);

  const num = (v: unknown) => Math.max(0, Math.round(Number(v) || 0));
  const levels = (Array.isArray(result.data.levels) ? result.data.levels : []).map((l) => ({
    level: String(l.level ?? ""),
    experience_band: String(l.experience_band ?? ""),
    low: num(l.low),
    median: num(l.median),
    high: num(l.high),
    confidence: (["high", "medium", "low"] as const).includes(l.confidence) ? l.confidence : "low",
    note: String(l.note ?? ""),
    evidence: (Array.isArray(l.evidence) ? l.evidence : [])
      .map((e) => ({
        source: String(e?.source ?? ""),
        url: String(e?.url ?? ""),
        quote: String(e?.quote ?? "").slice(0, 320),
      }))
      .filter((e) => e.quote)
      .slice(0, 4),
  }));

  return {
    currency: result.data.currency || input.currency,
    role: result.data.role || input.role,
    location: result.data.location || input.location,
    as_of: result.data.as_of || new Date().toISOString().slice(0, 10),
    levels,
    recommended: {
      budget: num(result.data.recommended?.budget),
      band_min: num(result.data.recommended?.band_min),
      band_max: num(result.data.recommended?.band_max),
      rationale: String(result.data.recommended?.rationale ?? ""),
    },
    caveats: Array.isArray(result.data.caveats) ? result.data.caveats.map(String).slice(0, 5) : [],
    sources,
    engine: { provider: result.provider, model: result.model },
  };
}
