import { and, eq, inArray } from "drizzle-orm";

import { db } from "../server/db";
import { applications } from "@db/schema";

/**
 * Bias monitoring (EU AI Act Art. 10 / four-fifths rule).
 *
 * ATSIQ does not collect protected attributes, so the honest observable is
 * selection-rate parity by intake source: a materially lower shortlist rate
 * for one source signals pipeline unfairness worth investigating.
 */

const ADVANCED_STAGES = new Set([
  "shortlisted",
  "l1",
  "l2",
  "l3",
  "offer",
  "offer_pending",
  "offer_released",
  "offer_accepted",
  "hired",
  "joined",
]);

export type ParityRow = { source: string; advanced: number; total: number; rate: number; parity: number };

export async function selectionParity(orgId: string): Promise<{
  rows: ParityRow[];
  breaches: ParityRow[];
}> {
  const rows = await db
    .select({ source: applications.source, stage: applications.stage })
    .from(applications)
    .where(
      and(
        eq(applications.orgId, orgId),
        inArray(applications.stage, [
          "applied",
          "sourced",
          "ai_screened",
          "shortlisted",
          "l1",
          "l2",
          "l3",
          "offer",
          "offer_pending",
          "offer_released",
          "offer_accepted",
          "hired",
          "joined",
        ]),
      ),
    );

  const bySource = new Map<string, { advanced: number; total: number }>();
  for (const r of rows) {
    const agg = bySource.get(r.source) ?? { advanced: 0, total: 0 };
    agg.total += 1;
    if (ADVANCED_STAGES.has(r.stage)) agg.advanced += 1;
    bySource.set(r.source, agg);
  }

  const rates: ParityRow[] = [...bySource.entries()]
    .filter(([, v]) => v.total >= 10)
    .map(([source, v]) => ({ source, ...v, rate: v.advanced / v.total, parity: 1 }))
    .sort((a, b) => b.rate - a.rate);
  const best = rates[0]?.rate ?? 0;
  for (const r of rates) r.parity = best > 0 ? r.rate / best : 1;

  return { rows: rates, breaches: rates.filter((r) => r.parity < 0.8) };
}
