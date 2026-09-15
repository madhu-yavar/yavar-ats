import { Fragment, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { getHrPerformance, saveIncentiveScheme } from "@/lib/hr-performance.functions";
import { useRoles } from "@/hooks/useRoles";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState, ScoreChip } from "@/components/ats";

const PERIODS = [
  { value: 30, label: "Last 30 days" },
  { value: 90, label: "Last quarter" },
  { value: 180, label: "Last 6 months" },
  { value: 365, label: "Last 12 months" },
];

function csv(name: string, rows: (string | number)[][]) {
  const body = rows
    .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
    .join("\n");
  const url = URL.createObjectURL(new Blob([body], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${name}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Team delivery, quality and incentive payouts — leadership only. */
export function HrPerformance() {
  const { roles, isAdmin } = useRoles();
  const allowed = isAdmin || roles.includes("hr_head");
  const load = useServerFn(getHrPerformance);
  const save = useServerFn(saveIncentiveScheme);

  const [days, setDays] = useState(90);
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<{
    currency: string;
    target: string;
    payout: string;
    cap: string;
    bands: string;
  } | null>(null);

  const perf = useQuery({
    queryKey: ["hr_performance", days],
    queryFn: () => load({ data: { days } }),
    enabled: allowed,
  });

  if (!allowed) return null;

  const data = perf.data;
  const scheme = data?.scheme;

  async function persist() {
    if (!draft) return;
    try {
      const bands = draft.bands
        .split(",")
        .map((part) => part.trim())
        .filter(Boolean)
        .map((part) => {
          const [min, mult] = part.split(":");
          return { min_score: Number(min), multiplier: Number(mult) };
        });
      if (bands.some((b) => Number.isNaN(b.min_score) || Number.isNaN(b.multiplier))) {
        throw new Error("Write quality bands as score:multiplier pairs, e.g. 85:1.2, 70:1, 0:0.8");
      }
      await save({
        data: {
          currency: draft.currency.trim() || "INR",
          target_closures_per_month: Number(draft.target) || 3,
          payout_per_closure: Number(draft.payout) || 0,
          quality_bands: bands,
          monthly_cap: draft.cap.trim() ? Number(draft.cap) : null,
          notes: null,
        },
      });
      setEditing(false);
      await perf.refetch();
      toast.success("Incentive plan saved — payouts recalculated.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save the plan.");
    }
  }

  return (
    <section className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Recruiter performance & incentives</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Built from actual pipeline movement: who moved candidates, what closed, how fast, and
            how strong the shortlisted quality was.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={days}
            onChange={(e) => setDays(Number(e.target.value))}
          >
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <Button
            size="sm"
            variant="outline"
            disabled={!data?.rows.length}
            onClick={() =>
              csv("recruiter-performance", [
                [
                  "Recruiter",
                  "Candidates moved",
                  "Screened",
                  "Shortlisted",
                  "Interviews completed",
                  "Offers released",
                  "Offers accepted",
                  "Joined",
                  "Median days to close",
                  "Quality",
                  "Offer acceptance %",
                  "Target",
                  "Attainment %",
                  "Performance",
                  `Payout (${scheme?.currency ?? ""})`,
                ],
                ...(data?.rows ?? []).map((r) => [
                  r.recruiter,
                  r.touched,
                  r.screened,
                  r.shortlisted,
                  r.interviews_completed,
                  r.offers_released,
                  r.offers_accepted,
                  r.joined,
                  r.days_to_offer ?? "—",
                  r.quality_score ?? "—",
                  r.offer_acceptance ?? "—",
                  r.target,
                  r.attainment_pct,
                  r.performance_score,
                  r.payout,
                ]),
              ])
            }
          >
            Export CSV
          </Button>
        </div>
      </div>

      {scheme ? (
        <div className="mt-4 rounded-lg border bg-muted/30 p-3 text-sm">
          {editing && draft ? (
            <div className="grid gap-3 sm:grid-cols-5">
              <div className="space-y-1">
                <Label className="text-xs">Currency</Label>
                <Input
                  value={draft.currency}
                  onChange={(e) => setDraft({ ...draft, currency: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Closures per month</Label>
                <Input
                  value={draft.target}
                  onChange={(e) => setDraft({ ...draft, target: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Payout per closure</Label>
                <Input
                  value={draft.payout}
                  onChange={(e) => setDraft({ ...draft, payout: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Monthly cap (blank = none)</Label>
                <Input
                  value={draft.cap}
                  onChange={(e) => setDraft({ ...draft, cap: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Quality bands (score:multiplier)</Label>
                <Input
                  value={draft.bands}
                  onChange={(e) => setDraft({ ...draft, bands: e.target.value })}
                />
              </div>
              <div className="sm:col-span-5">
                <Button size="sm" onClick={persist}>
                  Save plan
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="ml-2"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1">
              <span>
                Target <strong>{scheme.target_closures_per_month}</strong> closures / month
              </span>
              <span>
                {scheme.currency} <strong>{scheme.payout_per_closure}</strong> per closure
              </span>
              <span>
                Quality bands{" "}
                <strong>
                  {scheme.quality_bands.map((b) => `≥${b.min_score} → ×${b.multiplier}`).join(", ")}
                </strong>
              </span>
              <span>
                Monthly cap <strong>{scheme.monthly_cap ?? "none"}</strong>
              </span>
              <button
                type="button"
                className="text-primary underline-offset-2 hover:underline"
                onClick={() => {
                  setDraft({
                    currency: scheme.currency,
                    target: String(scheme.target_closures_per_month),
                    payout: String(scheme.payout_per_closure),
                    cap: scheme.monthly_cap === null ? "" : String(scheme.monthly_cap),
                    bands: scheme.quality_bands
                      .map((b) => `${b.min_score}:${b.multiplier}`)
                      .join(", "),
                  });
                  setEditing(true);
                }}
              >
                Edit plan
              </button>
            </div>
          )}
        </div>
      ) : null}

      {perf.isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Working out the numbers…</p>
      ) : perf.error ? (
        <p className="mt-4 text-sm text-destructive">
          {perf.error instanceof Error ? perf.error.message : "Could not load performance."}
        </p>
      ) : !data?.rows.length ? (
        <div className="mt-4">
          <EmptyState
            title="No recruiter activity in this period"
            hint="Stage movements are recorded against the person who made them; pick a longer period or move a candidate to see numbers here."
          />
        </div>
      ) : (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Recruiters active</p>
              <p className="text-xl font-semibold">{data.totals.recruiters}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Closures</p>
              <p className="text-xl font-semibold">{data.totals.closures}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">
                Incentive due ({scheme?.currency ?? ""})
              </p>
              <p className="text-xl font-semibold">{data.totals.payout.toLocaleString()}</p>
            </div>
          </div>

          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3">Recruiter</th>
                  <th className="py-2 pr-3">Moved</th>
                  <th className="py-2 pr-3">Shortlisted</th>
                  <th className="py-2 pr-3">Interviews</th>
                  <th className="py-2 pr-3">Offers</th>
                  <th className="py-2 pr-3">Joined</th>
                  <th className="py-2 pr-3">Days to close</th>
                  <th className="py-2 pr-3">Quality</th>
                  <th className="py-2 pr-3">Attainment</th>
                  <th className="py-2 pr-3">Performance</th>
                  <th className="py-2 pr-3">Payout</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <Fragment key={r.recruiter}>
                    <tr className="border-b align-top">
                      <td className="py-2 pr-3">
                        <button
                          type="button"
                          className="font-medium hover:text-primary"
                          onClick={() => setOpen(open === r.recruiter ? null : r.recruiter)}
                        >
                          {r.recruiter}
                        </button>
                      </td>
                      <td className="py-2 pr-3">{r.touched}</td>
                      <td className="py-2 pr-3">{r.shortlisted}</td>
                      <td className="py-2 pr-3">
                        {r.interviews_completed}/{r.interviews_scheduled}
                      </td>
                      <td className="py-2 pr-3">
                        {r.offers_accepted}/{r.offers_released}
                      </td>
                      <td className="py-2 pr-3">{r.joined}</td>
                      <td className="py-2 pr-3">{r.days_to_offer ?? "—"}</td>
                      <td className="py-2 pr-3">
                        {r.quality_score === null ? (
                          "—"
                        ) : (
                          <ScoreChip score={r.quality_score} size="sm" />
                        )}
                      </td>
                      <td className="py-2 pr-3">
                        {r.attainment_pct}%{" "}
                        <span className="text-muted-foreground">of {r.target}</span>
                      </td>
                      <td className="py-2 pr-3">
                        <ScoreChip score={r.performance_score} size="sm" />
                      </td>
                      <td className="py-2 pr-3 font-medium">
                        {r.payout.toLocaleString()}
                        {r.capped ? (
                          <span className="ml-1 text-xs text-amber-600">capped</span>
                        ) : null}
                      </td>
                    </tr>
                    {open === r.recruiter ? (
                      <tr className="border-b bg-muted/30">
                        <td colSpan={11} className="px-3 py-2 text-xs text-muted-foreground">
                          <ul className="list-inside list-disc space-y-0.5">
                            {r.workings.map((w) => (
                              <li key={w}>{w}</li>
                            ))}
                          </ul>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>

          {data.unattributed > 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">
              {data.unattributed} stage change(s) in this period carry no recruiter name, so they
              are not counted against anyone.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}
