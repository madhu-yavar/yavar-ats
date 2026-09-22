import { Fragment, useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";

import { benchmarkCompensation, type MarketBenchmark } from "@/lib/market.functions";
import {
  listRoleCompKnowledge,
  saveCompFigure,
  type CompKnowledgeEntry,
} from "@/lib/comp-knowledge.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { inr } from "@/components/ats";

type Props = {
  role: string;
  location: string;
  department?: string | null;
  experienceMin: number;
  experienceMax: number;
  skills: string[];
  currency?: string;
  /** Saved figures are tied back to the requisition when there is one. */
  requisitionId?: string | null;
  /** Fill the requisition's budget and band from a market figure. */
  onApply: (v: { budget: number; bandMin: number; bandMax: number }) => void;
};

const confidenceTone: Record<string, string> = {
  high: "text-emerald-600",
  medium: "text-amber-600",
  low: "text-muted-foreground",
};

const engineLabel: Record<string, string> = {
  openai: "Your OpenAI key",
  anthropic: "Your Claude key",
  google: "Your Google Gemini key",
  gemini: "Your Google Gemini key",
};

type Draft = { level: string; low: string; median: string; high: string };

export function MarketBenchmarkPanel(props: Props) {
  const run = useServerFn(benchmarkCompensation);
  const save = useServerFn(saveCompFigure);
  const listSaved = useServerFn(listRoleCompKnowledge);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<MarketBenchmark | null>(null);
  const [openLevel, setOpenLevel] = useState<string | null>(null);
  const [saved, setSaved] = useState<CompKnowledgeEntry[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const currency = props.currency ?? "INR";
  const money = (n: number) => (currency === "INR" ? inr(n) : `${currency} ${n.toLocaleString()}`);

  // Show what this organisation already decided for the role, before any research.
  useEffect(() => {
    const title = props.role.trim();
    if (title.length < 2) {
      setSaved([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      void listSaved({ data: { title } })
        .then((rows) => {
          if (live) setSaved(rows);
        })
        .catch(() => undefined);
    }, 400);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [props.role, listSaved]);

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
      setSaved(out.in_house);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Market research failed.");
    } finally {
      setLoading(false);
    }
  }

  async function persist(
    input: {
      levelKey: string;
      low: number;
      median: number;
      high: number;
      source: "user_override" | "market_applied";
      note?: string;
    },
    successMessage: string,
  ) {
    if (!input.median) {
      toast.error("Enter a median figure to save.");
      return;
    }
    setSaving(true);
    try {
      const rows = await save({
        data: {
          title: props.role,
          location: props.location || null,
          levelKey: input.levelKey,
          currency,
          low: input.low || null,
          median: input.median,
          high: input.high || null,
          experienceMin: props.experienceMin || null,
          experienceMax: props.experienceMax || null,
          source: input.source,
          note: input.note ?? null,
          requisitionId: props.requisitionId ?? null,
        },
      });
      setSaved(rows);
      setDraft(null);
      toast.success(successMessage);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save that figure.");
    } finally {
      setSaving(false);
    }
  }

  function applyAndRemember(
    v: { budget: number; bandMin: number; bandMax: number },
    levelKey: string,
  ) {
    props.onApply(v);
    void persist(
      {
        levelKey,
        low: v.bandMin,
        median: v.budget,
        high: v.bandMax,
        source: "market_applied",
        note: "Accepted from the market benchmark",
      },
      "Filled in and remembered for this role.",
    );
  }

  return (
    <div className="rounded-lg border bg-card/50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-semibold">Market pay benchmark</p>
          <p className="text-xs text-muted-foreground">
            Searches the web live across vetted salary publishers and recruiting salary guides, reads
            each page, and blends in what your organisation has already decided to pay.
          </p>
        </div>
        <Button type="button" size="sm" variant="outline" onClick={research} disabled={loading}>
          {loading ? "Searching live…" : data ? "Search again" : "Get market range"}
        </Button>
      </div>

      {saved.length > 0 && (
        <div className="mt-3 rounded-md border border-dashed bg-background/60 p-2.5">
          <p className="text-xs font-semibold">What we pay for this role (our own record)</p>
          <ul className="mt-1 grid gap-1 sm:grid-cols-2">
            {saved.slice(0, 6).map((k) => (
              <li key={k.id} className="text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{k.level_key}</span> ·{" "}
                {money(k.median)}
                {k.low && k.high ? ` (${money(k.low)}–${money(k.high)})` : ""} ·{" "}
                {k.created_at.slice(0, 10)}
                {k.source === "user_override" ? " · edited by us" : ""}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>
              {data.role} · {data.location || "Location not set"} · as of {data.as_of}
            </span>
            <span className="rounded-full border px-2 py-0.5">
              {engineLabel[data.engine.provider] ?? data.engine.provider} · {data.engine.model}
            </span>
            <span className="rounded-full border px-2 py-0.5">
              {data.research.grounded ? "Live web search on" : "Live web search off"} ·{" "}
              {data.research.read} of {data.sources.length} publisher pages read
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
                  <Fragment key={l.level}>
                    <tr className="border-t">
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
                      <td className="py-1.5 text-right whitespace-nowrap">
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={() =>
                            applyAndRemember(
                              { budget: l.median, bandMin: l.low, bandMax: l.high },
                              l.level,
                            )
                          }
                        >
                          Use
                        </button>
                        <span className="px-1 text-muted-foreground">·</span>
                        <button
                          type="button"
                          className="text-muted-foreground underline-offset-2 hover:underline"
                          onClick={() =>
                            setDraft(
                              draft?.level === l.level
                                ? null
                                : {
                                    level: l.level,
                                    low: String(l.low),
                                    median: String(l.median),
                                    high: String(l.high),
                                  },
                            )
                          }
                        >
                          Correct
                        </button>
                      </td>
                    </tr>

                    {draft?.level === l.level && (
                      <tr className="border-t bg-background">
                        <td colSpan={7} className="p-2.5">
                          <p className="text-xs font-medium">
                            Our figure for {l.level} — saved for future recommendations
                          </p>
                          <div className="mt-2 flex flex-wrap items-end gap-2">
                            {(["low", "median", "high"] as const).map((field) => (
                              <label key={field} className="text-xs">
                                <span className="block capitalize text-muted-foreground">
                                  {field}
                                </span>
                                <Input
                                  className="h-8 w-32"
                                  inputMode="numeric"
                                  value={draft[field]}
                                  onChange={(e) =>
                                    setDraft((d) => (d ? { ...d, [field]: e.target.value } : d))
                                  }
                                />
                              </label>
                            ))}
                            <Button
                              type="button"
                              size="sm"
                              disabled={saving}
                              onClick={() =>
                                void persist(
                                  {
                                    levelKey: l.level,
                                    low: Number(draft.low) || 0,
                                    median: Number(draft.median) || 0,
                                    high: Number(draft.high) || 0,
                                    source: "user_override",
                                    note: "Corrected on the benchmark panel",
                                  },
                                  "Saved as our figure for this role.",
                                )
                              }
                            >
                              {saving ? "Saving…" : "Save as ours"}
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              onClick={() => setDraft(null)}
                            >
                              Cancel
                            </Button>
                          </div>
                        </td>
                      </tr>
                    )}

                    {openLevel === l.level && (
                      <tr className="border-t bg-muted/40">
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
                  </Fragment>
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
                  applyAndRemember(
                    {
                      budget: data.recommended.budget,
                      bandMin: data.recommended.band_min,
                      bandMax: data.recommended.band_max,
                    },
                    "requisition",
                  )
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
                  {s.via === "search" ? " · found by live search" : ""}
                </li>
              ))}
            </ul>
            {data.research.queries.length > 0 && (
              <p className="mt-1.5">
                Searched for: {data.research.queries.map((q) => `“${q}”`).join(", ")}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
