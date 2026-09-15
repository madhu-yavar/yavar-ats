import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowRight, PhoneCall, Search } from "lucide-react";

import {
  allScreeningKitsQuery,
  allScreeningRunsQuery,
  applicationsQuery,
  candidatesQuery,
  latestScores,
  matchScoresQuery,
  requisitionsQuery,
} from "@/lib/data";
import { canonical, STAGE_LABEL, type Stage } from "@/lib/lifecycle";
import { StageBadge } from "@/components/ats";
import { RolePeek } from "@/components/RolePeek";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/screening")({
  head: () => ({
    meta: [
      { title: "Screening call support — questions, answers & second-level score" },
      {
        name: "description",
        content:
          "Prepare JD- and CV-specific screening questions for every candidate, capture what they answered by text or recording, and get an explainable second-level score.",
      },
      {
        property: "og:title",
        content: "Screening call support — questions, answers & second-level score",
      },
      {
        property: "og:description",
        content:
          "The HR helper agent: why each question matters, the answer to listen for, and a graded screening score per candidate.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ScreeningWorkspace,
});

type View = "to_call" | "graded" | "all";

function ScreeningWorkspace() {
  const apps = useQuery(applicationsQuery);
  const cands = useQuery(candidatesQuery);
  const reqs = useQuery(requisitionsQuery);
  const scores = useQuery(matchScoresQuery);
  const kits = useQuery(allScreeningKitsQuery);
  const runs = useQuery(allScreeningRunsQuery);

  const [view, setView] = useState<View>("to_call");
  const [term, setTerm] = useState("");

  const scoreMap = latestScores(scores.data ?? []);

  const rows = useMemo(() => {
    const candidates = cands.data ?? [];
    const requisitions = reqs.data ?? [];
    const kitList = kits.data ?? [];
    const runList = runs.data ?? [];

    return (apps.data ?? [])
      .map((app) => {
        const candidate = candidates.find((c) => c.id === app.candidate_id);
        const requisition = requisitions.find((r) => r.id === app.requisition_id);
        if (!candidate || !requisition) return null;
        const kit =
          kitList.find(
            (k) => k.candidate_id === candidate.id && k.requisition_id === app.requisition_id,
          ) ?? null;
        const run = kit ? (runList.find((r) => r.kit_id === kit.id) ?? null) : null;
        return {
          app,
          candidate,
          requisition,
          kit,
          run,
          match: scoreMap.get(app.id)?.overall_score ?? null,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .filter(
        (row) => !["joined", "rejected", "withdrawn"].includes(canonical(row.app.stage as Stage)),
      )
      .filter((row) => {
        if (view === "to_call") return !row.run;
        if (view === "graded") return Boolean(row.run);
        return true;
      })
      .filter((row) => {
        const q = term.trim().toLowerCase();
        if (!q) return true;
        return `${row.candidate.full_name} ${row.requisition.title} ${row.requisition.code}`
          .toLowerCase()
          .includes(q);
      })
      .sort((a, b) => (b.match ?? 0) - (a.match ?? 0))
      .slice(0, 200);
  }, [apps.data, cands.data, reqs.data, kits.data, runs.data, scoreMap, view, term]);

  const total = (apps.data ?? []).length;
  const gradedCount = (runs.data ?? []).length;
  const preparedCount = (kits.data ?? []).length;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="border-b border-border px-5 py-5 sm:px-7">
        <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase text-muted-foreground">
          <PhoneCall className="size-3.5 text-primary" /> Helper agent
        </div>
        <h1 className="text-2xl font-bold">Screening call support</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Pick a candidate to prepare the first call. The agent reads the job description against
          that CV, writes the questions to ask with the reason and the answer to listen for, then
          scores what the candidate actually said — typed in or from a recording.
        </p>
      </header>

      <section className="grid border-b border-border bg-surface-2/50 sm:grid-cols-3">
        {[
          { label: "Candidates in play", value: rows.length, note: `${total} applications` },
          { label: "Question sets prepared", value: preparedCount, note: "ready for the call" },
          { label: "Calls graded", value: gradedCount, note: "with score and rationale" },
        ].map((m) => (
          <div
            key={m.label}
            className="border-b border-border px-5 py-4 sm:border-b-0 sm:border-r sm:last:border-r-0"
          >
            <p className="text-xs font-medium text-muted-foreground">{m.label}</p>
            <p className="num mt-1 text-2xl font-bold">{m.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{m.note}</p>
          </div>
        ))}
      </section>

      <div className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:p-7">
        <label className="relative min-w-0 flex-1">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <span className="sr-only">Search candidate or role</span>
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            placeholder="Search candidate or role"
            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring/30"
          />
        </label>
        <div className="flex rounded-md bg-secondary p-1">
          {(
            [
              ["to_call", "Not screened"],
              ["graded", "Screened"],
              ["all", "All"],
            ] as const
          ).map(([value, label]) => (
            <Button
              key={value}
              size="sm"
              variant={view === value ? "outline" : "ghost"}
              onClick={() => setView(value)}
              className="shadow-none"
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto border-t border-border">
        <table className="w-full min-w-[820px] text-left text-sm">
          <thead className="border-b border-border bg-surface-2/70 text-xs text-muted-foreground">
            <tr>
              <th className="px-5 py-3 font-semibold">Candidate</th>
              <th className="px-4 py-3 font-semibold">Role</th>
              <th className="px-4 py-3 font-semibold">JD match</th>
              <th className="px-4 py-3 font-semibold">Screening</th>
              <th className="px-4 py-3 font-semibold">Stage</th>
              <th className="px-5 py-3 text-right font-semibold">Next step</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => (
              <tr key={row.app.id} className="hover:bg-surface-2/70">
                <td className="px-5 py-3">
                  <div className="font-semibold">{row.candidate.full_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {row.candidate.current_employer ||
                      row.candidate.location ||
                      "Profile available"}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <RolePeek requisition={row.requisition} />
                </td>
                <td className="num px-4 py-3">{row.match === null ? "—" : `${row.match}%`}</td>
                <td className="px-4 py-3">
                  {row.run ? (
                    <div>
                      <div className="num font-semibold">{row.run.screening_score}/100</div>
                      <div className="text-xs capitalize text-muted-foreground">
                        {row.run.recommendation ?? "graded"}
                      </div>
                    </div>
                  ) : row.kit ? (
                    <span className="text-xs text-muted-foreground">Questions ready</span>
                  ) : (
                    <span className="text-xs text-muted-foreground">Not prepared</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StageBadge stage={row.app.stage} />
                </td>
                <td className="px-5 py-3 text-right">
                  <Button asChild variant={row.run ? "ghost" : "outline"} size="sm">
                    <Link to="/candidates/$id" params={{ id: row.candidate.id }} hash="screening">
                      {row.run ? "Review call" : row.kit ? "Run the call" : "Prepare questions"}
                      <ArrowRight />
                    </Link>
                  </Button>
                </td>
              </tr>
            ))}
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-muted-foreground">
                  {apps.isLoading
                    ? "Loading…"
                    : "No candidates in this view. Add candidates to a role first, then prepare the call."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground sm:px-7">
        Stages shown: {STAGE_LABEL["applied"]} onwards. Hired, rejected and withdrawn candidates are
        left out.
      </p>
    </div>
  );
}
