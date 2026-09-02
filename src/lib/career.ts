/**
 * Career-history analytics — deterministic and auditable.
 *
 * The AI only *extracts* the employment history from the CV; every number and
 * flag below is computed in plain TypeScript so a recruiter can reproduce it by
 * hand and nobody is penalised by an opaque model guess.
 */

export type EmploymentRow = {
  company: string;
  title: string;
  /** ISO-ish start (YYYY-MM or YYYY). Null when the CV does not state it. */
  start: string | null;
  /** Null (or "present") means still employed there. */
  end: string | null;
  level_hint?: string | null;
};

export type CareerMetrics = {
  employers: number;
  dated_employers: number;
  total_years: number;
  avg_tenure_years: number;
  shortest_stint_years: number | null;
  current_tenure_years: number | null;
  jobs_last_5y: number;
  longest_gap_months: number;
  total_gap_months: number;
  promotions: number;
  progression: "upward" | "lateral" | "unclear";
  skill_recency_years: number | null;
};

const LEVELS: [RegExp, number][] = [
  [/\b(intern|trainee|graduate)\b/i, 0],
  [/\b(junior|associate|jr\.?)\b/i, 1],
  [/\b(engineer|developer|analyst|designer|consultant|specialist|executive)\b/i, 2],
  [/\b(senior|sr\.?|sde ?(?:ii|iii|3|2))\b/i, 3],
  [/\b(lead|principal|staff|architect|manager|supervisor)\b/i, 4],
  [/\b(head|director|senior manager|group manager)\b/i, 5],
  [/\b(vp|vice president|cto|ceo|cxo|chief|founder|partner)\b/i, 6],
];

export function titleLevel(title: string) {
  let level = -1;
  for (const [re, value] of LEVELS) if (re.test(title)) level = Math.max(level, value);
  return level;
}

function toDate(value: string | null | undefined, fallbackToNow = false) {
  if (!value || /present|current|till date|to date|now/i.test(value)) return fallbackToNow ? new Date() : null;
  const m = value.match(/(\d{4})(?:[-/](\d{1,2}))?/);
  if (!m) return null;
  const year = Number(m[1]);
  if (year < 1950 || year > new Date().getFullYear() + 1) return null;
  return new Date(year, m[2] ? Math.max(0, Number(m[2]) - 1) : 0, 1);
}

const YEAR_MS = 365.25 * 86_400_000;
const round1 = (n: number) => Math.round(n * 10) / 10;

export function computeCareerMetrics(
  history: EmploymentRow[],
  opts?: { skillRecencyYears?: number | null },
): CareerMetrics {
  const rows = (history ?? []).filter((r) => r && (r.company || r.title));
  const spans = rows
    .map((r) => {
      const start = toDate(r.start);
      const end = toDate(r.end, true);
      if (!start || !end || end < start) return null;
      return { start, end, ongoing: !r.end || /present|current/i.test(r.end), title: r.title ?? "" };
    })
    .filter((s): s is NonNullable<typeof s> => s !== null)
    .sort((a, b) => a.start.getTime() - b.start.getTime());

  const tenures = spans.map((s) => (s.end.getTime() - s.start.getTime()) / YEAR_MS);
  const totalYears = tenures.reduce((sum, t) => sum + t, 0);

  // Gaps between consecutive roles (overlaps count as zero gap).
  let longestGap = 0;
  let totalGap = 0;
  for (let i = 1; i < spans.length; i++) {
    const gapMonths = (spans[i]!.start.getTime() - spans[i - 1]!.end.getTime()) / (YEAR_MS / 12);
    if (gapMonths > 1) {
      totalGap += gapMonths;
      longestGap = Math.max(longestGap, gapMonths);
    }
  }

  const fiveYearsAgo = new Date(Date.now() - 5 * YEAR_MS);
  const jobsLast5y = spans.filter((s) => s.end >= fiveYearsAgo).length;

  const levels = spans.map((s) => titleLevel(s.title)).filter((l) => l >= 0);
  let promotions = 0;
  for (let i = 1; i < levels.length; i++) if (levels[i]! > levels[i - 1]!) promotions++;
  const progression: CareerMetrics["progression"] =
    levels.length < 2 ? "unclear" : promotions > 0 ? "upward" : "lateral";

  const ongoing = spans.find((s) => s.ongoing) ?? spans[spans.length - 1];

  return {
    employers: rows.length,
    dated_employers: spans.length,
    total_years: round1(totalYears),
    avg_tenure_years: spans.length ? round1(totalYears / spans.length) : 0,
    shortest_stint_years: tenures.length ? round1(Math.min(...tenures)) : null,
    current_tenure_years: ongoing ? round1((ongoing.end.getTime() - ongoing.start.getTime()) / YEAR_MS) : null,
    jobs_last_5y: jobsLast5y,
    longest_gap_months: Math.round(longestGap),
    total_gap_months: Math.round(totalGap),
    promotions,
    progression,
    skill_recency_years:
      opts?.skillRecencyYears === null || opts?.skillRecencyYears === undefined
        ? null
        : round1(opts.skillRecencyYears),
  };
}

export type CareerAssessment = { score: number; flags: string[]; notes: string[] };

/**
 * Turn the metrics into a 0-100 career-quality score. Penalties are explicit and
 * capped; a CV with no dates is scored neutrally (60) rather than punished.
 */
export function careerScore(m: CareerMetrics): CareerAssessment {
  const flags: string[] = [];
  const notes: string[] = [];

  if (m.dated_employers === 0) {
    return {
      score: 60,
      flags: ["Employment dates not readable from the CV — career quality could not be measured"],
      notes: ["Scored neutrally (60) because no dated roles were found."],
    };
  }

  let score = 100;
  const cut = (points: number, why: string) => {
    score -= points;
    notes.push(`-${points} · ${why}`);
  };

  if (m.avg_tenure_years < 1.5) {
    cut(25, `average tenure ${m.avg_tenure_years} yrs`);
    flags.push(`Short average tenure (${m.avg_tenure_years} yrs across ${m.dated_employers} employers)`);
  } else if (m.avg_tenure_years < 2.5) {
    cut(10, `average tenure ${m.avg_tenure_years} yrs`);
  } else {
    notes.push(`Stable: ${m.avg_tenure_years} yrs average tenure.`);
  }

  if (m.shortest_stint_years !== null && m.shortest_stint_years < 0.75) {
    cut(8, `shortest stint ${m.shortest_stint_years} yrs`);
    flags.push(`A role shorter than 9 months (${m.shortest_stint_years} yrs)`);
  }

  if (m.jobs_last_5y > 3) {
    cut(12, `${m.jobs_last_5y} employers in the last 5 years`);
    flags.push(`${m.jobs_last_5y} employers in the last 5 years`);
  }

  if (m.longest_gap_months > 12) {
    cut(14, `${m.longest_gap_months}-month break between roles`);
    flags.push(`Unexplained break of ${m.longest_gap_months} months — ask, do not assume`);
  } else if (m.longest_gap_months > 6) {
    cut(8, `${m.longest_gap_months}-month break between roles`);
    flags.push(`Break of ${m.longest_gap_months} months between roles`);
  }

  if (m.progression === "upward") {
    score += 8;
    notes.push(`+8 · ${m.promotions} step-up${m.promotions === 1 ? "" : "s"} in title level`);
  } else if (m.progression === "lateral" && m.total_years >= 6) {
    cut(12, "no title progression across 6+ years");
    flags.push("No visible title progression despite 6+ years of experience");
  }

  if (m.skill_recency_years !== null && m.skill_recency_years > 3) {
    cut(10, `core requisition skills last used ~${m.skill_recency_years} yrs ago`);
    flags.push(`Core skills last used about ${m.skill_recency_years} years ago`);
  }

  return { score: Math.max(0, Math.min(100, Math.round(score))), flags, notes };
}
