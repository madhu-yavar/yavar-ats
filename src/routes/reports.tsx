import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";

import {
  applicationsQuery,
  candidatesQuery,
  departmentsQuery,
  latestScores,
  matchScoresQuery,
  offersQuery,
  requisitionsQuery,
} from "@/lib/data";
import { PageHeader, ScoreBar, StatCard, inr } from "@/components/ats";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Hiring Analytics — funnel, sources & match quality" },
      {
        name: "description",
        content:
          "Funnel conversion, source effectiveness, budget utilisation and average match-score quality across every requisition.",
      },
      { property: "og:title", content: "Hiring Analytics — funnel, sources & match quality" },
      {
        property: "og:description",
        content: "Stage-wise funnel, source mix and match-score distribution for the talent acquisition team.",
      },
    ],
  }),
  component: Reports,
});

const STAGES = [
  "applied",
  "ai_screened",
  "shortlisted",
  "l1",
  "l2",
  "l3",
  "offer",
  "hired",
  "rejected",
] as const;

function Reports() {
  const apps = useQuery(applicationsQuery);
  const reqs = useQuery(requisitionsQuery);
  const cands = useQuery(candidatesQuery);
  const scores = useQuery(matchScoresQuery);
  const depts = useQuery(departmentsQuery);
  const offers = useQuery(offersQuery);

  const applications = apps.data ?? [];
  const scoreMap = latestScores(scores.data ?? []);
  const scored = applications.filter((a) => scoreMap.has(a.id));

  const funnel = STAGES.map((s) => ({ stage: s, count: applications.filter((a) => a.stage === s).length }));
  const maxStage = Math.max(1, ...funnel.map((f) => f.count));

  const sources = Object.entries(
    applications.reduce<Record<string, number>>((acc, a) => {
      acc[a.source] = (acc[a.source] ?? 0) + 1;
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);

  const bands = [
    { label: "Strong (75–100)", test: (n: number) => n >= 75 },
    { label: "Borderline (60–74)", test: (n: number) => n >= 60 && n < 75 },
    { label: "Weak (<60)", test: (n: number) => n < 60 },
  ].map((b) => ({
    ...b,
    count: scored.filter((a) => b.test(scoreMap.get(a.id)!.overall_score)).length,
  }));

  const avg = (pick: (id: string) => number) =>
    scored.length ? Math.round(scored.reduce((s, a) => s + pick(a.id), 0) / scored.length) : 0;

  const budget = (depts.data ?? []).reduce((s, d) => s + Number(d.budgeted_cost), 0);
  const committed = (reqs.data ?? []).reduce((s, r) => s + Number(r.budget_ctc) * r.openings, 0);
  const hired = applications.filter((a) => a.stage === "hired").length;

  return (
    <>
      <PageHeader
        eyebrow="Analytics"
        title="Hiring reports"
        description="Funnel health, source effectiveness and the quality of the matches your weights are producing."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Candidates in pool" value={(cands.data ?? []).length} />
        <StatCard label="Applications" value={applications.length} hint={`${scored.length} scored`} />
        <StatCard label="Hired" value={hired} hint={`${(offers.data ?? []).length} offers raised`} />
        <StatCard
          label="Budget utilisation"
          value={budget ? `${Math.round((committed / budget) * 100)}%` : "—"}
          hint={`${inr(committed)} of ${inr(budget)}`}
          tone={committed > budget ? "destructive" : "default"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="panel p-5">
          <h2 className="font-semibold">Funnel by stage</h2>
          <ul className="mt-4 space-y-3">
            {funnel.map((f) => (
              <li key={f.stage}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="capitalize">{f.stage.replace("_", " ")}</span>
                  <span className="num font-semibold">{f.count}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: `${(f.count / maxStage) * 100}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </section>

        <div className="space-y-6">
          <section className="panel p-5">
            <h2 className="font-semibold">Average score by dimension</h2>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <ScoreBar label="Skills" score={avg((id) => scoreMap.get(id)!.skills_score)} />
              <ScoreBar label="Experience" score={avg((id) => scoreMap.get(id)!.experience_score)} />
              <ScoreBar label="Education" score={avg((id) => scoreMap.get(id)!.education_score)} />
              <ScoreBar label="Social profile" score={avg((id) => scoreMap.get(id)!.social_score)} />
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Match quality distribution</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {bands.map((b) => (
                <li key={b.label} className="flex items-center justify-between">
                  <span>{b.label}</span>
                  <span className="num font-semibold">{b.count}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Source effectiveness</h2>
            {sources.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No applications yet.</p>
            ) : (
              <ul className="mt-3 space-y-2 text-sm">
                {sources.map(([source, count]) => (
                  <li key={source} className="flex items-center justify-between">
                    <span className="capitalize">{source}</span>
                    <span className="num font-semibold">{count}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>
    </>
  );
}
