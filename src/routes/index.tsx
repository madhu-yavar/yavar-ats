import { createFileRoute, Link } from "@tanstack/react-router";
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
import { PageHeader, ScoreChip, StageBadge, StatCard, StatusBadge, inr } from "@/components/ats";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TA Command Centre — AI Applicant Tracking System" },
      {
        name: "description",
        content:
          "Live view of requisitions, approvals, JD↔CV match quality and offer pipeline across the talent acquisition lifecycle.",
      },
      { property: "og:title", content: "TA Command Centre — AI Applicant Tracking System" },
      {
        property: "og:description",
        content: "Requisition-to-offer visibility with weighted JD↔CV matching and social profile scoring.",
      },
    ],
  }),
  component: Dashboard,
});

function Dashboard() {
  const reqs = useQuery(requisitionsQuery);
  const apps = useQuery(applicationsQuery);
  const scores = useQuery(matchScoresQuery);
  const cands = useQuery(candidatesQuery);
  const depts = useQuery(departmentsQuery);
  const offers = useQuery(offersQuery);

  const requisitions = reqs.data ?? [];
  const applications = apps.data ?? [];
  const candidates = cands.data ?? [];
  const scoreMap = latestScores(scores.data ?? []);

  const open = requisitions.filter((r) => r.status === "approved");
  const pending = requisitions.filter((r) => r.status.startsWith("pending"));
  const scored = applications.filter((a) => scoreMap.has(a.id));
  const avgMatch = scored.length
    ? Math.round(scored.reduce((s, a) => s + (scoreMap.get(a.id)?.overall_score ?? 0), 0) / scored.length)
    : 0;
  const budgeted = (depts.data ?? []).reduce((s, d) => s + Number(d.budgeted_cost), 0);
  const committed = requisitions.reduce((s, r) => s + Number(r.budget_ctc) * r.openings, 0);

  const topCandidates = applications
    .map((a) => ({ app: a, score: scoreMap.get(a.id) }))
    .filter((row) => row.score)
    .sort((a, b) => (b.score!.overall_score ?? 0) - (a.score!.overall_score ?? 0))
    .slice(0, 5);

  return (
    <>
      <PageHeader
        eyebrow="Command centre"
        title="Talent acquisition at a glance"
        description="Requisition health, match quality and offer status across every department."
        actions={
          <Button asChild>
            <Link to="/matching">Open matching engine</Link>
          </Button>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open requisitions" value={open.length} hint={`${pending.length} awaiting approval`} />
        <StatCard label="Active candidates" value={candidates.length} hint={`${applications.length} applications`} />
        <StatCard
          label="Avg match score"
          value={avgMatch}
          hint={`${scored.length} of ${applications.length} CVs scored`}
          tone={avgMatch >= 75 ? "success" : avgMatch >= 60 ? "warning" : "destructive"}
        />
        <StatCard
          label="Cost committed"
          value={inr(committed)}
          hint={`of ${inr(budgeted)} budgeted`}
          tone={committed > budgeted ? "destructive" : "default"}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <section className="panel lg:col-span-3">
          <div className="flex items-center justify-between border-b border-border p-5">
            <h2 className="font-semibold">Requisition pipeline</h2>
            <Button asChild variant="ghost" size="sm">
              <Link to="/requisitions">View all</Link>
            </Button>
          </div>
          <div className="divide-y divide-border">
            {requisitions.slice(0, 6).map((r) => {
              const count = applications.filter((a) => a.requisition_id === r.id).length;
              return (
                <Link
                  key={r.id}
                  to="/requisitions/$id"
                  params={{ id: r.id }}
                  className="flex items-center justify-between gap-4 p-5 transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="num text-xs text-muted-foreground">{r.code}</span>
                      <StatusBadge status={r.status} />
                    </div>
                    <div className="mt-1 truncate font-medium">{r.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {r.location} · {r.openings} opening(s) · {r.experience_min}-{r.experience_max} yrs ·{" "}
                      {inr(Number(r.budget_ctc))}
                    </div>
                  </div>
                  <div className="num shrink-0 text-right text-sm">
                    <div className="font-semibold">{count}</div>
                    <div className="text-xs text-muted-foreground">applicants</div>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="panel lg:col-span-2">
          <div className="border-b border-border p-5">
            <h2 className="font-semibold">Best matched candidates</h2>
            <p className="text-xs text-muted-foreground">Weighted JD↔CV score including social profiling</p>
          </div>
          <div className="divide-y divide-border">
            {topCandidates.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No scored candidates yet.</p>
            ) : (
              topCandidates.map(({ app, score }) => {
                const cand = candidates.find((c) => c.id === app.candidate_id);
                const req = requisitions.find((r) => r.id === app.requisition_id);
                return (
                  <Link
                    key={app.id}
                    to="/candidates/$id"
                    params={{ id: app.candidate_id }}
                    className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
                  >
                    <ScoreChip score={score!.overall_score} />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{cand?.full_name ?? "Unknown"}</div>
                      <div className="truncate text-xs text-muted-foreground">{req?.title}</div>
                    </div>
                    <StageBadge stage={app.stage} />
                  </Link>
                );
              })
            )}
          </div>
        </section>
      </div>

      <section className="panel">
        <div className="flex items-center justify-between border-b border-border p-5">
          <h2 className="font-semibold">Offers in flight</h2>
          <Button asChild variant="ghost" size="sm">
            <Link to="/offers">Manage offers</Link>
          </Button>
        </div>
        <div className="p-5">
          {(offers.data ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No offers raised yet. Offers appear here once a candidate clears L3 evaluation.
            </p>
          ) : (
            <ul className="space-y-2 text-sm">
              {(offers.data ?? []).map((o) => (
                <li key={o.id} className="flex items-center justify-between">
                  <span className="num">{inr(Number(o.offered_ctc))}</span>
                  <StatusBadge status={o.status} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
