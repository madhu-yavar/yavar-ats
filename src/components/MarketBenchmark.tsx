import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { benchmarkCompensation, type MarketBenchmark } from "@/lib/market.functions";
import { Button } from "@/components/ui/button";
import { inr } from "@/components/ats";

type Props = {
  role: string;
  location: string;
  department?: string | null;
  experienceMin: number;
  experienceMax: number;
  skills: string[];
  currency?: string;
  /** Fill the requisition's budget and band from a market figure. */
  onApply: (v: { budget: number; bandMin: number; bandMax: number }) => void;
};

const confidenceTone: Record<string, string> = {
  high: "text-emerald-600",
  medium: "text-amber-600",
  low: "text-muted-foreground",
};

const engineLabel: Record<string, string> = {
  lovable: "Built-in Lovable AI (uses Lovable credits)",
  openai: "Your OpenAI key",
  anthropic: "Your Claude key",
  gemini: "Your Google Gemini key",
};

export function MarketBenchmarkPanel(props: Props) {
  const run = useServerFn(benchmarkCompensation);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MarketBenchmark | null>(null);
  const [openLevel, setOpenLevel] = useState<string | null>(null);
  const currency = props.currency ?? "INR";
  const money = (n: number) => (currency === "INR" ? inr(n) : `${currency} ${n.toLocaleString()}`);

  async function research() {
    if (props.role.trim().length < 2) {
      toast.error("Add the role title first.");
      return;
    }
    setLoading(true);
    try {
      const out = await run({
        data: {
          role: props.role,
          location: props.location,
          currency,
          experienceMin: props.experienceMin,
          experienceMax: props.experienceMax,
          skills: props.skills,
          department: props.department ?? null,
        },
      });
      setData(out);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Market research failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Market pay benchmark</p>
          <p className="text-xs text-muted-foreground">
            Reads public salary pages live and returns a range per career level for this role and
            location.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={research} disabled={loading}>
          {loading ? "Researching…" : data ? "Refresh" : "Get market range"}
        </Button>
      </div>

      {data && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {data.role} · {data.location || "Location not set"} · as of {data.as_of}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-muted-foreground">
                <tr>
                  <th className="py-1 pr-2 font-medium">Level</th>
                  <th className="py-1 pr-2 font-medium">Experience</th>
                  <th className="py-1 pr-2 font-medium">Low</th>
                  <th className="py-1 pr-2 font-medium">Median</th>
                  <th className="py-1 pr-2 font-medium">High</th>
                  <th className="py-1 pr-2 font-medium">Evidence</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.levels.map((l) => (
                  <>
                    <tr key={l.level} className="border-t">
                      <td className="py-1.5 pr-2 font-medium">{l.level}</td>
                      <td className="py-1.5 pr-2 text-muted-foreground">{l.experience_band}</td>
                      <td className="py-1.5 pr-2">{money(l.low)}</td>
                      <td className="py-1.5 pr-2 font-semibold">{money(l.median)}</td>
                      <td className="py-1.5 pr-2">{money(l.high)}</td>
                      <td className={`py-1.5 pr-2 ${confidenceTone[l.confidence] ?? ""}`}>
                        <button
                          type="button"
                          className="underline-offset-2 hover:underline"
                          onClick={() => setOpenLevel(openLevel === l.level ? null : l.level)}
                        >
                          {l.confidence === "high"
                            ? "From sources"
                            : l.confidence === "medium"
                              ? "Interpolated"
                              : "Estimate"}
                          {l.evidence.length > 0 ? ` (${l.evidence.length})` : ""}
                          {openLevel === l.level ? " ▴" : " ▾"}
                        </button>
                      </td>
                      <td className="py-1.5 text-right">
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={() =>
                            props.onApply({ budget: l.median, bandMin: l.low, bandMax: l.high })
                          }
                        >
                          Use
                        </button>
                      </td>
                    </tr>
                    {openLevel === l.level && (
                      <tr key={`${l.level}-evidence`} className="border-t bg-muted/40">
                        <td colSpan={7} className="p-2.5">
                          {l.note && <p className="text-xs">{l.note}</p>}
                          {l.evidence.length > 0 ? (
                            <ul className="mt-1.5 space-y-1.5">
                              {l.evidence.map((e, i) => (
                                <li key={`${e.url}-${i}`} className="text-xs">
                                  <span className="text-muted-foreground">“{e.quote}”</span>{" "}
                                  {e.url ? (
                                    <a
                                      href={e.url}
                                      target="_blank"
                                      rel="noreferrer noopener"
                                      className="text-primary underline-offset-2 hover:underline"
                                    >
                                      {e.source || "source"}
                                    </a>
                                  ) : (
                                    <span className="text-muted-foreground">
                                      {e.source || "source"}
                                    </span>
                                  )}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            <p className="mt-1 text-xs text-muted-foreground">
                              No live page quoted a figure for this level — the range is an estimate
                              from the levels above and below.
                            </p>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>

          {data.recommended.budget > 0 && (
            <div className="rounded-md border border-primary/30 bg-primary/5 p-2.5">
              <p className="text-xs">
                <span className="font-semibold">Suggested for this requisition:</span>{" "}
                {money(data.recommended.budget)} budget, band {money(data.recommended.band_min)}–
                {money(data.recommended.band_max)}
              </p>
              {data.recommended.rationale && (
                <p className="mt-1 text-xs text-muted-foreground">{data.recommended.rationale}</p>
              )}
              <Button
                type="button"
                size="sm"
                className="mt-2"
                onClick={() =>
                  props.onApply({
                    budget: data.recommended.budget,
                    bandMin: data.recommended.band_min,
                    bandMax: data.recommended.band_max,
                  })
                }
              >
                Apply to budget &amp; band
              </Button>
            </div>
          )}

          {data.caveats.length > 0 && (
            <ul className="list-inside list-disc text-xs text-muted-foreground">
              {data.caveats.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}

          <div className="text-xs text-muted-foreground">
            <p className="font-medium">Sources checked</p>
            <ul className="mt-1 space-y-0.5">
              {data.sources.map((s) => (
                <li key={s.url}>
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="underline-offset-2 hover:underline"
                  >
                    {s.title}
                  </a>{" "}
                  — {s.read ? "read live" : "not reachable"}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
