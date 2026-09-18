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
import { selectionParity } from "../src/lib/bias.server";

async function main() {
  const orgId = process.argv[2];
  if (!orgId) {
    console.error("usage: bun scripts/bias-report.ts <orgId>");
    process.exit(2);
  }

  const { rows } = await selectionParity(orgId);
  if (rows.length < 2) {
    console.log("Not enough applications (need ≥10 in ≥2 sources) for a disparity check.");
    return;
  }

  let flagged = false;
  console.log(`Selection-rate parity for org ${orgId} (best source: ${rows[0]!.source} @ ${(rows[0]!.rate * 100).toFixed(1)}%)`);
  for (const r of rows) {
    const flag = r.parity < 0.8 ? "  ← BELOW 0.8 — investigate" : "";
    if (r.parity < 0.8) flagged = true;
    console.log(`  ${r.source.padEnd(16)} ${String(r.advanced).padStart(4)}/${String(r.total).padEnd(5)} rate=${(r.rate * 100).toFixed(1)}%  parity=${r.parity.toFixed(2)}${flag}`);
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
