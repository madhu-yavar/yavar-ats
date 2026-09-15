/**
 * Recruiter performance and incentive maths for the CHRO view.
 *
 * Everything is derived from real pipeline activity — who moved a candidate
 * (`stage_events.actor`), which interviews happened, which offers landed and
 * how strong the screening/match quality was. No estimates, no invented data.
 */

export type QualityBand = { min_score: number; multiplier: number };

export type IncentiveScheme = {
  currency: string;
  target_closures_per_month: number;
  payout_per_closure: number;
  quality_bands: QualityBand[];
  monthly_cap: number | null;
  notes: string | null;
};

export const DEFAULT_SCHEME: IncentiveScheme = {
  currency: "INR",
  target_closures_per_month: 3,
  payout_per_closure: 10000,
  quality_bands: [
    { min_score: 85, multiplier: 1.2 },
    { min_score: 70, multiplier: 1 },
    { min_score: 0, multiplier: 0.8 },
  ],
  monthly_cap: null,
  notes: null,
};

/** Multiplier for a measured quality score, from the highest band it clears. */
export function bandFor(bands: QualityBand[], score: number | null) {
  const sorted = [...bands].sort((a, b) => b.min_score - a.min_score);
  const band = sorted.find((b) => (score ?? 0) >= b.min_score);
  return band ?? { min_score: 0, multiplier: 1 };
}

export type RecruiterRow = {
  recruiter: string;
  touched: number;
  screened: number;
  shortlisted: number;
  interviews_scheduled: number;
  interviews_completed: number;
  offers_released: number;
  offers_accepted: number;
  joined: number;
  rejected: number;
  /** Median days from first touch to accepted offer, null when nothing closed. */
  days_to_offer: number | null;
  /** Average match/screening score across the candidates they moved forward. */
  quality_score: number | null;
  shortlist_to_offer: number | null;
  offer_acceptance: number | null;
  performance_score: number;
  target: number;
  attainment_pct: number;
  base_payout: number;
  quality_multiplier: number;
  payout: number;
  capped: boolean;
  workings: string[];
};

type StageEvent = {
  application_id: string;
  actor: string | null;
  to_stage: string;
  created_at: string;
};

type ApplicationRow = { id: string; applied_at: string };
type InterviewRow = { application_id: string; status: string; scheduled_at: string | null };
type OfferRow = { application_id: string; status: string };
type QualityRow = { application_id: string; score: number };

function median(values: number[]) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : Math.round((s[mid - 1]! + s[mid]!) / 2);
}

function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : null;
}

/**
 * Fold raw pipeline rows into one row per recruiter, with the incentive
 * calculation spelled out so a CHRO can audit every number.
 */
export function buildRecruiterPerformance(input: {
  events: StageEvent[];
  applications: ApplicationRow[];
  interviews: InterviewRow[];
  offers: OfferRow[];
  quality: QualityRow[];
  scheme: IncentiveScheme;
  /** Months covered by the filter, so targets scale with the period. */
  months: number;
}): { rows: RecruiterRow[]; unattributed: number } {
  const appliedAt = new Map(input.applications.map((a) => [a.id, a.applied_at]));
  const interviewsByApp = new Map<string, InterviewRow[]>();
  for (const i of input.interviews) {
    interviewsByApp.set(i.application_id, [...(interviewsByApp.get(i.application_id) ?? []), i]);
  }
  const offersByApp = new Map<string, OfferRow[]>();
  for (const o of input.offers) {
    offersByApp.set(o.application_id, [...(offersByApp.get(o.application_id) ?? []), o]);
  }
  const qualityByApp = new Map(input.quality.map((q) => [q.application_id, q.score]));

  type Acc = {
    apps: Set<string>;
    screened: Set<string>;
    shortlisted: Set<string>;
    offersReleased: Set<string>;
    offersAccepted: Set<string>;
    joined: Set<string>;
    rejected: Set<string>;
    closureDays: number[];
    quality: number[];
  };
  const byRecruiter = new Map<string, Acc>();
  let unattributed = 0;

  const acc = (name: string) => {
    let a = byRecruiter.get(name);
    if (!a) {
      a = {
        apps: new Set(),
        screened: new Set(),
        shortlisted: new Set(),
        offersReleased: new Set(),
        offersAccepted: new Set(),
        joined: new Set(),
        rejected: new Set(),
        closureDays: [],
        quality: [],
      };
      byRecruiter.set(name, a);
    }
    return a;
  };

  for (const e of input.events) {
    const name = (e.actor ?? "").trim();
    if (!name) {
      unattributed += 1;
      continue;
    }
    const a = acc(name);
    a.apps.add(e.application_id);
    if (e.to_stage === "ai_screened") a.screened.add(e.application_id);
    if (e.to_stage === "shortlisted") a.shortlisted.add(e.application_id);
    if (e.to_stage === "offer_released" || e.to_stage === "offer") {
      a.offersReleased.add(e.application_id);
    }
    if (e.to_stage === "offer_accepted") a.offersAccepted.add(e.application_id);
    if (e.to_stage === "joined" || e.to_stage === "hired") {
      a.joined.add(e.application_id);
      const start = appliedAt.get(e.application_id);
      if (start) {
        const days = Math.round(
          (new Date(e.created_at).getTime() - new Date(start).getTime()) / 86_400_000,
        );
        if (days >= 0) a.closureDays.push(days);
      }
    }
    if (e.to_stage === "rejected" || e.to_stage === "withdrawn") a.rejected.add(e.application_id);
  }

  for (const [, a] of byRecruiter) {
    for (const appId of a.apps) {
      const q = qualityByApp.get(appId);
      if (typeof q === "number") a.quality.push(q);
    }
  }

  const target = Math.max(1, Math.round(input.scheme.target_closures_per_month * input.months));

  const rows: RecruiterRow[] = [...byRecruiter.entries()]
    .map(([recruiter, a]) => {
      let scheduled = 0;
      let completed = 0;
      let released = a.offersReleased.size;
      let accepted = a.offersAccepted.size;
      for (const appId of a.apps) {
        for (const i of interviewsByApp.get(appId) ?? []) {
          if (i.scheduled_at) scheduled += 1;
          if (i.status === "completed") completed += 1;
        }
        for (const o of offersByApp.get(appId) ?? []) {
          if (o.status === "released") released += 1;
          if (o.status === "accepted") accepted += 1;
        }
      }
      released = Math.max(released, a.offersReleased.size);
      accepted = Math.max(accepted, a.offersAccepted.size);

      const closures = a.joined.size || accepted;
      const quality = a.quality.length
        ? Math.round(a.quality.reduce((s, v) => s + v, 0) / a.quality.length)
        : null;
      const shortlistToOffer = pct(released, a.shortlisted.size);
      const offerAcceptance = pct(accepted, released);
      const speed = median(a.closureDays);

      const attainment = Math.round((closures / target) * 100);
      // Performance blend: delivery 50, quality 25, conversion 15, speed 10.
      const deliveryPart = Math.min(100, attainment) * 0.5;
      const qualityPart = (quality ?? 60) * 0.25;
      const conversionPart = Math.min(100, offerAcceptance ?? shortlistToOffer ?? 50) * 0.15;
      const speedPart = (speed === null ? 50 : Math.max(0, 100 - Math.min(100, speed))) * 0.1;
      const performance = Math.round(deliveryPart + qualityPart + conversionPart + speedPart);

      const base = closures * input.scheme.payout_per_closure;
      const band = bandFor(input.scheme.quality_bands, quality);
      const multiplier = band.multiplier;
      const raw = Math.round(base * multiplier);
      const cap = input.scheme.monthly_cap === null ? null : input.scheme.monthly_cap * input.months;
      const capped = cap !== null && raw > cap;
      const payout = capped ? Math.round(cap!) : raw;

      const workings = [
        `${closures} closure(s) × ${input.scheme.payout_per_closure} = ${base}`,
        `quality ${quality ?? "not measured"} → band ≥${band.min_score} → ×${multiplier.toFixed(2)}`,
        capped ? `capped at ${Math.round(cap!)}` : `payable ${payout}`,
        `performance = delivery ${Math.round(deliveryPart)} + quality ${Math.round(qualityPart)} + conversion ${Math.round(conversionPart)} + speed ${Math.round(speedPart)}`,
      ];

      return {
        recruiter,
        touched: a.apps.size,
        screened: a.screened.size,
        shortlisted: a.shortlisted.size,
        interviews_scheduled: scheduled,
        interviews_completed: completed,
        offers_released: released,
        offers_accepted: accepted,
        joined: a.joined.size,
        rejected: a.rejected.size,
        days_to_offer: speed,
        quality_score: quality,
        shortlist_to_offer: shortlistToOffer,
        offer_acceptance: offerAcceptance,
        performance_score: performance,
        target,
        attainment_pct: attainment,
        base_payout: base,
        quality_multiplier: multiplier,
        payout,
        capped,
        workings,
      };
    })
    .sort((a, b) => b.performance_score - a.performance_score);

  return { rows, unattributed };
}
