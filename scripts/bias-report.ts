/**
 * Bias monitoring report (EU AI Act Art. 10 / NYC LL144-style four-fifths check).
 *
 * ATSIQ does not collect protected attributes, so this report monitors the
 * proxy it CAN measure honestly: selection rates by application source. A
 * materially lower shortlist rate for one source signals pipeline unfairness
 * worth investigating (e.g. a scoring blind spot for one intake channel).
 *
 * Run: DATABASE_URL=... bun scripts/bias-report.ts [orgId]
 * Exit code 1 when a source's shortlist rate is below 80% of the best source.
 */
import { and, eq, inArray } from "drizzle-orm";

import { db } from "../src/server/db";
import { applications } from "@db/schema";

type Row = { source: string; stage: string };

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("usage: bun scripts/bias-report.ts <orgId>");
    process.exit(2);
  }

  const rows: Row[] = await db
    .select({ source: applications.source, stage: applications.stage })
    .from(applications)
    .where(and(eq(applications.orgId, orgId), inArray(applications.stage, [
      "applied", "sourced", "ai_screened", "shortlisted", "l1", "l2", "l3", "offer",
      "offer_pending", "offer_released", "offer_accepted", "hired", "joined",
    ])));

  const bySource = new Map<string, { total: number; advanced: number }>();
  for (const r of rows) {
    const agg = bySource.get(r.source) ?? { total: 0, advanced: 0 };
    agg.total += 1;
    const advancedStages = new Set(["shortlisted", "l1", "l2", "l3", "offer", "offer_pending", "offer_released", "offer_accepted", "hired", "joined"]);
    if (advancedStages.has(r.stage)) agg.advanced += 1;
    bySource.set(r.source, agg);
  }

  const rates = [...bySource.entries()]
    .filter(([, v]) => v.total >= 10)
    .map(([source, v]) => ({ source, ...v, rate: v.advanced / v.total }))
    .sort((a, b) => b.rate - a.rate);

  if (rates.length < 2) {
    console.log("Not enough applications (need ≥10 in ≥2 sources) for a disparity check.");
    return;
  }

  const best = rates[0]!;
  let flagged = false;
  console.log(`Selection-rate parity for org ${orgId} (best source: ${best.source} @ ${(best.rate * 100).toFixed(1)}%)`);
  for (const r of rates) {
    const ratio = r.rate / best.rate;
    const flag = ratio < 0.8 ? "  ← BELOW 0.8 — investigate" : "";
    if (ratio < 0.8) flagged = true;
    console.log(`  ${r.source.padEnd(16)} ${String(r.advanced).padStart(4)}/${String(r.total).padEnd(5)} rate=${(r.rate * 100).toFixed(1)}%  parity=${ratio.toFixed(2)}${flag}`);
  }
  if (flagged) process.exit(1);
}

main().then(
  () => process.exit(0),
  (e) => {
    console.error(e);
    process.exit(2);
  },
);
