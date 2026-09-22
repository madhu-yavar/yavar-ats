/**
 * Market compensation agent — deep live research.
 *
 * Three stages, every run:
 *  1. DISCOVER — a live web search (multiple engines, several query shapes) for
 *     this exact role, location and year, keeping only results that land on a
 *     vetted compensation/job-market domain, plus a set of deterministic deep
 *     links into those same sites.
 *  2. READ — every candidate page is fetched through `safeFetch` (SSRF-safe),
 *     stripped to text and reduced to the sentences that actually carry pay
 *     figures, so the model sees evidence rather than page furniture.
 *  3. REASON — the org's own AI key derives low/median/high per career level,
 *     quoting the extract it used, and is additionally given this
 *     organisation's saved in-house figures as trusted internal evidence.
 *
 * Page text is attacker-controlled, so it enters the prompt only through
 * `untrusted()`.
 */

import { aiJson, untrusted } from "./ai-gateway.server";
import { safeFetchText } from "../server/safe-fetch";
import { readRoleKnowledge, type CompKnowledgeEntry } from "./comp-knowledge.server";

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

export type MarketSource = {
  title: string;
  url: string;
  read: boolean;
  /** "search" when a live search surfaced it, "direct" for a known deep link. */
  via: "search" | "direct";
  /** Publisher family, e.g. "levels.fyi". */
  domain: string;
};

export type MarketBenchmark = {
  currency: string;
  role: string;
  location: string;
  as_of: string;
  levels: MarketLevel[];
  recommended: { budget: number; band_min: number; band_max: number; rationale: string };
  caveats: string[];
  sources: MarketSource[];
  /** What the organisation itself has already decided to pay for this role. */
  in_house: CompKnowledgeEntry[];
  /** How wide the live sweep actually went, for the panel's honesty line. */
  research: {
    queries: string[];
    discovered: number;
    read: number;
    domains: string[];
  };
  /** Which model actually did the reasoning, so nobody has to guess. */
  engine: { provider: string; model: string };
};

/**
 * Publishers whose pay data is worth reading. Live search results outside this
 * list are dropped — that is what keeps "more sources" from meaning "worse
 * sources". Aggregators, job boards with pay filters and the big recruiting
 * firms' annual salary guides.
 */
const QUALITY_DOMAINS = [
  // salary aggregators / crowd data
  "levels.fyi",
  "ambitionbox.com",
  "6figr.com",
  "glassdoor.co.in",
  "glassdoor.com",
  "payscale.com",
  "salary.com",
  "salaryexpert.com",
  "talent.com",
  "in.talent.com",
  "jobted.in",
  "jobted.com",
  "comparably.com",
  "builtin.com",
  "getonbrd.com",
  // job boards that publish pay ranges
  "naukri.com",
  "indeed.com",
  "in.indeed.com",
  "foundit.in",
  "shine.com",
  "timesjobs.com",
  "instahyre.com",
  "cutshort.io",
  "wellfound.com",
  "dice.com",
  "ziprecruiter.com",
  "seek.com.au",
  "totaljobs.com",
  "reed.co.uk",
  "efinancialcareers.com",
  // recruiting-firm and consultancy salary guides
  "michaelpage.co.in",
  "michaelpage.com",
  "randstad.in",
  "randstad.com",
  "roberthalf.com",
  "robertwalters.co.in",
  "robertwalters.com",
  "hays.co.in",
  "hays.com",
  "kornferry.com",
  "mercer.com",
  "aon.com",
  "wtwco.com",
  "deloitte.com",
  "teamlease.com",
  "adecco.co.in",
  "xpheno.com",
  "quesscorp.com",
  // engineering pay communities
  "teamblind.com",
  "reddit.com",
];

function slug(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function hostOf(url: string) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isQualityDomain(url: string) {
  const host = hostOf(url);
  if (!host) return false;
  return QUALITY_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

function isIndia(location: string, currency: string) {
  return (
    currency.toUpperCase() === "INR" ||
    /india|bengaluru|bangalore|chennai|mumbai|delhi|pune|hyderabad|noida|gurgaon|gurugram|kolkata|ahmedabad|coimbatore|kochi|trivandrum|jaipur/i.test(
      location,
    )
  );
}

/* --------------------------------------------------------- stage 1: discover */

/** Deterministic deep links into the vetted publishers for this role. */
function directSources(role: string, location: string, currency: string) {
  const r = slug(role);
  const q = encodeURIComponent(role.trim()).replace(/%20/g, "+");
  const loc = encodeURIComponent(location.trim()).replace(/%20/g, "+");
  const india = isIndia(location, currency);

  const list: { title: string; url: string }[] = [
    { title: `Levels.fyi — ${role}`, url: `https://www.levels.fyi/t/${r}` },
  ];

  if (india) {
    list.push(
      { title: `Talent.com India — ${role}`, url: `https://in.talent.com/salary?job=${q}` },
      { title: `6figr — ${role} salary`, url: `https://6figr.com/in/salary/${r}--t` },
      { title: `AmbitionBox — ${role} salary`, url: `https://www.ambitionbox.com/profile/${r}-salary` },
      { title: `Jobted India — ${role} salary`, url: `https://www.jobted.in/salary/${r}` },
      {
        title: `Naukri — ${role}${location ? ` in ${location}` : ""}`,
        url: `https://www.naukri.com/${r}-jobs${loc ? `-in-${slug(location)}` : ""}`,
      },
    );
  } else {
    list.push(
      { title: `Talent.com — ${role}`, url: `https://www.talent.com/salary?job=${q}` },
      {
        title: `Payscale — ${role}`,
        url: `https://www.payscale.com/research/US/Job=${encodeURIComponent(role)}/Salary`,
      },
      { title: `Salary.com — ${role}`, url: `https://www.salary.com/research/salary/alternate/${r}-salary` },
      { title: `Jobted — ${role} salary`, url: `https://www.jobted.com/salary/${r}` },
      { title: `Built In — ${role}`, url: `https://builtin.com/salaries/dev-engineer/${r}` },
    );
  }
  return list;
}

/** The search queries the agent runs live, every time. */
function searchQueries(role: string, location: string, currency: string) {
  const year = new Date().getFullYear();
  const where = location.trim() || (isIndia(location, currency) ? "India" : "");
  const unit = isIndia(location, currency) ? "LPA CTC" : "annual salary";
  return [
    `"${role}" salary ${where} ${year}`.replace(/\s+/g, " ").trim(),
    `${role} ${where} ${unit} range median`.replace(/\s+/g, " ").trim(),
    `${role} salary guide ${year} ${where}`.replace(/\s+/g, " ").trim(),
    `${role} ${where} compensation benchmark senior lead manager pay`.replace(/\s+/g, " ").trim(),
  ];
}

const LINK_RE = /href="(https?:\/\/[^"]+)"/gi;
const DDG_RE = /uddg=([^&"]+)/i;

function decodeDdg(href: string) {
  const m = DDG_RE.exec(href);
  if (!m?.[1]) return href;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return href;
  }
}

/** One engine call → vetted result URLs. Failures are silent by design. */
async function runSearch(engine: "ddg" | "bing" | "mojeek", query: string): Promise<string[]> {
  const q = encodeURIComponent(query);
  const url =
    engine === "ddg"
      ? `https://html.duckduckgo.com/html/?q=${q}`
      : engine === "bing"
        ? `https://www.bing.com/search?q=${q}&count=30`
        : `https://www.mojeek.com/search?q=${q}`;
  try {
    const { text } = await safeFetchText(url, { timeoutMs: 9000, maxBytes: 900_000, hops: 2 });
    const out: string[] = [];
    for (const m of text.matchAll(LINK_RE)) {
      const raw = decodeDdg(m[1] ?? "");
      if (!raw.startsWith("http")) continue;
      if (/duckduckgo|bing\.com|mojeek|microsoft|google\./i.test(hostOf(raw))) continue;
      if (!isQualityDomain(raw)) continue;
      const clean = raw.split("#")[0] ?? raw;
      if (!out.includes(clean)) out.push(clean);
      if (out.length >= 10) break;
    }
    return out;
  } catch {
    return [];
  }
}

/* ------------------------------------------------------------- stage 2: read */

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#\d+;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const FIGURE_RE =
  /(₹|rs\.?|inr|\$|usd|€|£)\s?[\d,.]+\s?(lakh|lakhs|lpa|l\b|cr|crore|k\b|m\b|million)?|[\d,.]+\s?(lpa|lakhs?|crore|cr\b)/i;
const PAY_WORD_RE =
  /salar|compensation|ctc|lpa|pay|package|median|average|percentile|base|bonus|per year|annual|experience/i;

/**
 * Reduce a page to the sentences that carry pay figures — far denser evidence
 * than the first N characters of a marketing page.
 */
function salaryExcerpt(text: string, cap = 5200) {
  const parts = text.split(/(?<=[.!?•|])\s+/);
  const kept: string[] = [];
  let size = 0;
  for (const part of parts) {
    const p = part.trim();
    if (p.length < 12 || p.length > 600) continue;
    if (!FIGURE_RE.test(p) || !PAY_WORD_RE.test(p)) continue;
    kept.push(p);
    size += p.length + 1;
    if (size >= cap) break;
  }
  if (kept.length === 0) return text.slice(0, 2500);
  return kept.join("\n");
}

async function readSource(url: string) {
  try {
    const { text } = await safeFetchText(url, { timeoutMs: 9000, maxBytes: 900_000, hops: 2 });
    const plain = htmlToText(text);
    if (!/salar|compensation|ctc|lpa|per year|annual/i.test(plain)) return null;
    return salaryExcerpt(plain);
  } catch {
    return null;
  }
}

/** Bounded-parallel map so a wide sweep stays inside the request budget. */
async function mapPool<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length) as R[];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      const item = items[i];
      if (i >= items.length || item === undefined) return;
      out[i] = await fn(item);
    }
  });
  await Promise.all(workers);
  return out;
}

/* ---------------------------------------------------------- stage 3: reason */

export async function benchmarkMarket(input: {
  /** Org context for AI credential resolution and in-house knowledge. */
  orgId: string;
  role: string;
  location: string;
  currency: string;
  experienceMin: number;
  experienceMax: number;
  skills: string[];
  department?: string | null | undefined;
}): Promise<MarketBenchmark> {
  const queries = searchQueries(input.role, input.location, input.currency);

  // Live discovery + the org's own saved figures, in parallel.
  const [discoveredLists, inHouse] = await Promise.all([
    mapPool(
      [
        ...queries.map((q) => ({ engine: "ddg" as const, q })),
        ...queries.slice(0, 2).map((q) => ({ engine: "bing" as const, q })),
        { engine: "mojeek" as const, q: queries[0] ?? input.role },
      ],
      4,
      ({ engine, q }) => runSearch(engine, q),
    ),
    readRoleKnowledge(input.orgId, input.role).catch(() => [] as CompKnowledgeEntry[]),
  ]);

  const direct = directSources(input.role, input.location, input.currency);
  const seen = new Set<string>();
  const candidates: { title: string; url: string; via: "search" | "direct" }[] = [];
  const pushCandidate = (c: { title: string; url: string; via: "search" | "direct" }) => {
    const key = c.url.replace(/\/$/, "");
    if (seen.has(key)) return;
    seen.add(key);
    candidates.push(c);
  };
  // Live search results lead (freshest), with the deep links as the floor.
  for (const list of discoveredLists) {
    for (const url of list) {
      pushCandidate({ title: `${hostOf(url)} — ${input.role}`, url, via: "search" });
    }
  }
  for (const d of direct) pushCandidate({ ...d, via: "direct" });

  // At most two pages per publisher, so one chatty domain can't crowd the sweep.
  const perDomain = new Map<string, number>();
  const shortlist = candidates
    .filter((c) => {
      const host = hostOf(c.url);
      const n = perDomain.get(host) ?? 0;
      if (n >= 2) return false;
      perDomain.set(host, n + 1);
      return true;
    })
    .slice(0, 14);

  const fetched = await mapPool(shortlist, 6, async (s) => ({ ...s, text: await readSource(s.url) }));

  const sources: MarketSource[] = fetched.map((s) => ({
    title: s.title,
    url: s.url,
    read: Boolean(s.text),
    via: s.via,
    domain: hostOf(s.url),
  }));
  const readCount = sources.filter((s) => s.read).length;

  const extracts = fetched
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
      "Weigh sources by quality: crowd-sourced aggregators and recruiting-firm salary guides first, single job " +
      "postings last; prefer figures published in the last 12-18 months and say so in the caveats when the " +
      "freshest evidence is older. Where the extracts disagree, take the mid-point of the credible ones and " +
      "explain the spread in the level's note. " +
      "The organisation's own previously saved figures (internal_knowledge) are trusted internal evidence: " +
      "anchor the recommendation on them where they cover the level, and call out explicitly in the rationale " +
      "when the internal figure sits below or above the market band. " +
      "Set confidence 'high' only when a supplied source states figures for that level; 'medium' when " +
      "interpolated from supplied sources or from internal knowledge; 'low' when no source covered it and you are estimating. " +
      "Never invent a source. For every level, list the evidence you actually used: each entry is a short " +
      "VERBATIM quote from a supplied extract that mentions the pay figure, with the source title and its URL. " +
      "Leave evidence as an empty array when the level is an estimate with no supporting extract. " +
      "Return ONLY JSON with keys: currency, role, location, as_of (ISO date), " +
      "levels (array of {level, experience_band, low, median, high, confidence, note, evidence: [{source, url, quote}]}), " +
      "recommended ({budget, band_min, band_max, rationale}) sized for the requisition's own experience range, " +
      "caveats (2-4 short strings, including how many live sources were readable and how fresh they are).",
    prompt: [
      JSON.stringify({
        role: input.role,
        department: input.department ?? null,
        location: input.location,
        currency: input.currency,
        experience_range: [input.experienceMin, input.experienceMax],
        key_skills: input.skills.slice(0, 15),
        today: new Date().toISOString().slice(0, 10),
        search_queries_run: queries,
        pages_read: sources.filter((s) => s.read).map((s) => s.url),
        pages_unreachable: sources.filter((s) => !s.read).map((s) => s.url),
        internal_knowledge: inHouse.map((k) => ({
          level: k.level_key,
          low: k.low,
          median: k.median,
          high: k.high,
          location: k.location,
          currency: k.currency,
          decided_on: k.created_at.slice(0, 10),
          kind: k.source,
          note: k.note,
        })),
      }),
      untrusted(
        "live_salary_page_extracts",
        extracts || "NONE — no public salary page was readable from the server.",
      ),
    ].join("\n\n"),
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
    in_house: inHouse,
    research: {
      queries,
      discovered: candidates.length,
      read: readCount,
      domains: Array.from(new Set(sources.filter((s) => s.read).map((s) => s.domain))),
    },
    engine: { provider: result.provider, model: result.model },
  };
}
