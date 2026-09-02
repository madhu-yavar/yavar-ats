import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, Clock, Copy, Sparkles, TrendingUp } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  applicationsQuery,
  candidatesQuery,
  departmentsQuery,
  interviewsQuery,
  latestScores,
  matchScoresQuery,
  offersQuery,
  requisitionsQuery,
  type Candidate,
  type Requisition,
} from "@/lib/data";
import { canonical, stalledDays, STAGE_LABEL, type Stage } from "@/lib/lifecycle";
import { findDuplicateGroups, freshness } from "@/lib/dedupe";
import { rankPool } from "@/lib/shortlist";
import { PageHeader, ScoreChip, StageBadge, StatCard, StatusBadge, inr } from "@/components/ats";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "TA Command Centre — pipeline, match quality & pool health" },
      {
        name: "description",
        content:
          "Live analytics across requisitions, funnel conversion, JD↔CV match quality, talent-pool freshness, duplicate hygiene and AI-suggested candidates from history.",
      },
      { property: "og:title", content: "TA Command Centre — pipeline, match quality & pool health" },
      {
        property: "og:description",
        content:
          "Funnel conversion, offer health, interviewer load, pool freshness and automatic historic matches for every open requisition.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

const FUNNEL: Stage[] = ["sourced", "applied", "ai_screened", "shortlisted", "l1", "l2", "l3", "offer_pending", "offer_released", "offer_accepted", "joined"];

/** Compact horizontal bar used across the analytics panels. */
function Bar({
  label,
  value,
  max,
  hint,
  tone = "primary",
}: {
  label: string;
  value: number;
  max: number;
  hint?: string;
  tone?: "primary" | "accent" | "warning" | "destructive";
}) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  const bg =
    tone === "destructive"
      ? "bg-destructive"
      : tone === "warning"
        ? "bg-amber-500"
        : tone === "accent"
          ? "bg-accent"
          : "bg-primary";
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="truncate" title={label}>
          {label}
        </span>
        <span className="num shrink-0 text-muted-foreground">{hint ?? value}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className={`h-full rounded-full ${bg}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="flex items-start justify-between gap-3 border-b border-border p-5">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {subtitle ? <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Dashboard() {
  const qc = useQueryClient();
  const { roles, isAdmin } = useRoles();
  const execScope: "CHRO" | "HR head" | null = isAdmin
    ? "CHRO"
    : roles.includes("hr_head")
      ? "HR head"
      : null;
  const reqs = useQuery(requisitionsQuery);
  const apps = useQuery(applicationsQuery);
  const scores = useQuery(matchScoresQuery);
  const cands = useQuery(candidatesQuery);
  const depts = useQuery(departmentsQuery);
  const offers = useQuery(offersQuery);
  const interviews = useQuery(interviewsQuery);

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

  /* ---------- funnel ---------- */
  const stageCount = useMemo(() => {
    const m = new Map<Stage, number>();
    for (const a of applications) {
      const st = canonical(a.stage as Stage);
      m.set(st, (m.get(st) ?? 0) + 1);
    }
    return m;
  }, [applications]);

  const funnel = useMemo(() => {
    return FUNNEL.map((stage, i) => {
      const reached = FUNNEL.slice(i).reduce((s, st) => s + (stageCount.get(st) ?? 0), 0);
      return { stage, reached, here: stageCount.get(stage) ?? 0 };
    }).filter((row) => row.reached > 0 || row.here > 0);
  }, [stageCount]);
  const funnelTop = funnel[0]?.reached ?? 0;

  /* ---------- pool health ---------- */
  const poolHealth = useMemo(() => {
    let fresh = 0;
    let aging = 0;
    let stale = 0;
    for (const c of candidates) {
      const t = freshness(c).tier;
      if (t === "fresh") fresh++;
      else if (t === "aging") aging++;
      else stale++;
    }
    const groups = findDuplicateGroups(candidates);
    const dupRows = groups.reduce((s, g) => s + g.members.length, 0);
    const noEmail = candidates.filter((c) => !c.email || c.email.endsWith("@import.local")).length;
    const noSkills = candidates.filter((c) => (c.skills ?? []).length === 0).length;
    const pooledIds = new Set(applications.map((a) => a.candidate_id));
    const untapped = candidates.filter((c) => !pooledIds.has(c.id)).length;
    return { fresh, aging, stale, groups: groups.length, dupRows, noEmail, noSkills, untapped };
  }, [candidates, applications]);

  /* ---------- historic matching: who in the pool fits an open requisition ---------- */
  const [addingKey, setAddingKey] = useState<string | null>(null);
  const addToPipeline = useMutation({
    mutationFn: async (v: { requisitionId: string; candidateId: string }) => {
      const { error } = await supabase
        .from("applications")
        .insert({ requisition_id: v.requisitionId, candidate_id: v.candidateId, source: "talent_pool" });
      if (error) throw new Error(error.message);
    },
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ["applications"] });
      toast.success("Added to the requisition pipeline");
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const suggestions = useMemo(() => {
    if (open.length === 0 || candidates.length === 0) return [];
    const appliedTo = new Map<string, Set<string>>();
    for (const a of applications) {
      const set = appliedTo.get(a.requisition_id) ?? new Set<string>();
      set.add(a.candidate_id);
      appliedTo.set(a.requisition_id, set);
    }
    return open
      .slice(0, 4)
      .map((req) => {
        const taken = appliedTo.get(req.id) ?? new Set<string>();
        const pool = candidates.filter((c) => !taken.has(c.id));
        // Always show the best three the history has; weak fits are labelled
        // rather than hidden, so the recruiter knows the pool was checked.
        const ranked = rankPool(pool, req).slice(0, 3);
        return { req, ranked };
      })
      .filter((row) => row.ranked.length > 0);
  }, [open, candidates, applications]);

  /* ---------- offers & attention ---------- */
  const offerRows = offers.data ?? [];
  const accepted = offerRows.filter((o) => ["accepted", "released"].includes(o.status)).length;
  const acceptRate = offerRows.length ? Math.round((offerRows.filter((o) => o.status === "accepted").length / offerRows.length) * 100) : 0;

  const stalled = useMemo(
    () =>
      applications
        .map((a) => ({ app: a, days: stalledDays(a.stage as Stage, a.last_activity_at) }))
        .filter((r): r is { app: (typeof applications)[number]; days: number } => r.days !== null)
        .sort((a, b) => b.days - a.days)
        .slice(0, 6),
    [applications],
  );

  const upcoming = useMemo(() => {
    const now = Date.now();
    return (interviews.data ?? [])
      .filter((i) => i.scheduled_at && new Date(i.scheduled_at).getTime() >= now && i.status !== "cancelled")
      .slice(0, 5);
  }, [interviews.data]);

  const sourceMix = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of candidates) m.set(c.source, (m.get(c.source) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [candidates]);

  const scarceSkills = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of scores.data ?? []) for (const skill of s.missing_skills ?? []) m.set(skill, (m.get(skill) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [scores.data]);

  const topCandidates = applications
    .map((a) => ({ app: a, score: scoreMap.get(a.id) }))
    .filter((row) => row.score)
    .sort((a, b) => (b.score!.overall_score ?? 0) - (a.score!.overall_score ?? 0))
    .slice(0, 5);

  const candidateName = (id: string) => candidates.find((c) => c.id === id)?.full_name ?? "Unknown";
  const reqTitle = (id: string) => requisitions.find((r) => r.id === id)?.title ?? "—";

  return (
    <>
      <PageHeader
        eyebrow="Command centre"
        title="Talent acquisition at a glance"
        description="Pipeline health, match quality, pool hygiene and the candidates your history already knows about."
        actions={
          <div className="flex gap-2">
            <Button asChild variant="outline">
              <Link to="/candidates">Talent pool</Link>
            </Button>
            <Button asChild>
              <Link to="/matching">Open matching engine</Link>
            </Button>
          </div>
        }
      />

      {execScope ? <LeadershipBoard scope={execScope} /> : null}



      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Open requisitions" value={open.length} hint={`${pending.length} awaiting approval`} />
        <StatCard label="Talent pool" value={candidates.length} hint={`${poolHealth.untapped} not in any pipeline`} />
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

      {/* Historic matching — the pool works for every new requisition automatically. */}
      <Panel
        title="Suggested from your existing pool"
        subtitle="Deterministic must-have / experience / location overlap against every open requisition — no AI spend until you shortlist."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/matching">Score them</Link>
          </Button>
        }
      >
        {suggestions.length === 0 ? (
          <p className="p-5 text-sm text-muted-foreground">
            No pool matches yet. Add candidates to the talent pool or approve a requisition, and historic matches appear
            here automatically.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {suggestions.map(({ req, ranked }) => (
              <div key={req.id} className="p-5">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="num text-xs text-muted-foreground">{req.code}</div>
                    <Link
                      to="/requisitions/$id"
                      params={{ id: req.id }}
                      className="truncate font-medium hover:underline"
                    >
                      {req.title}
                    </Link>
                  </div>
                  <span className="num shrink-0 text-xs text-muted-foreground">
                    {req.openings} opening(s) · {req.experience_min}–{req.experience_max} yrs
                  </span>
                </div>
                <ul className="mt-3 space-y-2">
                  {ranked.map((r) => {
                    const key = `${req.id}:${r.candidate.id}`;
                    const f = freshness(r.candidate);
                    return (
                      <li
                        key={key}
                        className="flex flex-wrap items-center gap-3 rounded-md bg-surface-2 px-3 py-2 text-sm"
                      >
                        <ScoreChip score={r.fit} size="sm" />
                        <Link
                          to="/candidates/$id"
                          params={{ id: r.candidate.id }}
                          className="font-medium hover:underline"
                        >
                          {r.candidate.full_name}
                        </Link>
                        <span className="text-xs text-muted-foreground">
                          {r.mustHits.length}/{r.mustHits.length + r.mustMisses.length} must-haves ·{" "}
                          {r.candidate.experience_years} yrs
                          {r.experienceOk ? "" : " (band mismatch)"}
                          {r.locationOk ? "" : " · location mismatch"}
                          {r.fit < 40 ? " · weak fit" : ""}
                        </span>
                        <span
                          className={
                            "text-xs " + (f.tier === "stale" ? "text-destructive" : "text-muted-foreground")
                          }
                        >
                          CV {f.label}
                        </span>
                        <Button
                          size="sm"
                          variant="outline"
                          className="ml-auto"
                          disabled={addingKey === key && addToPipeline.isPending}
                          onClick={() => {
                            setAddingKey(key);
                            addToPipeline.mutate({ requisitionId: req.id, candidateId: r.candidate.id });
                          }}
                        >
                          <Sparkles className="size-4" /> Add to pipeline
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Panel>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Pipeline funnel" subtitle="Cumulative candidates that reached each stage" className="lg:col-span-1">
          <div className="space-y-3 p-5">
            {funnel.length === 0 ? (
              <p className="text-sm text-muted-foreground">No applications yet.</p>
            ) : (
              funnel.map((row, i) => {
                const prev = funnel[i - 1];
                const conv = prev && prev.reached > 0 ? Math.round((row.reached / prev.reached) * 100) : null;
                return (
                  <Bar
                    key={row.stage}
                    label={STAGE_LABEL[row.stage] ?? row.stage}
                    value={row.reached}
                    max={funnelTop}
                    hint={`${row.reached}${conv !== null ? ` · ${conv}%` : ""}`}
                  />
                );
              })
            )}
          </div>
        </Panel>

        <Panel
          title="Talent pool health"
          subtitle="Freshness and duplicate hygiene — the pool ages, so we track it"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/candidates">Clean up</Link>
            </Button>
          }
        >
          <div className="space-y-3 p-5">
            <Bar label="Fresh (under 90 days)" value={poolHealth.fresh} max={candidates.length || 1} tone="accent" />
            <Bar label="Aging (3–12 months)" value={poolHealth.aging} max={candidates.length || 1} tone="warning" />
            <Bar label="Stale (over a year)" value={poolHealth.stale} max={candidates.length || 1} tone="destructive" />
            <div className="grid grid-cols-2 gap-3 pt-2 text-xs">
              <div className="rounded-md bg-surface-2 p-3">
                <div className="num text-lg font-semibold">{poolHealth.groups}</div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <Copy className="size-3" /> duplicate sets ({poolHealth.dupRows} rows)
                </div>
              </div>
              <div className="rounded-md bg-surface-2 p-3">
                <div className="num text-lg font-semibold">{poolHealth.noSkills + poolHealth.noEmail}</div>
                <div className="flex items-center gap-1 text-muted-foreground">
                  <AlertTriangle className="size-3" /> incomplete profiles
                </div>
              </div>
            </div>
          </div>
        </Panel>

        <Panel title="Where candidates come from" subtitle="Source mix across the whole pool">
          <div className="space-y-3 p-5">
            {sourceMix.length === 0 ? (
              <p className="text-sm text-muted-foreground">No candidates yet.</p>
            ) : (
              sourceMix.map(([src, n]) => (
                <Bar key={src} label={src} value={n} max={sourceMix[0]![1]} hint={`${n}`} />
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-5">
        <Panel
          title="Requisition pipeline"
          subtitle="Applicants and match quality per requisition"
          className="lg:col-span-3"
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/requisitions">View all</Link>
            </Button>
          }
        >
          <div className="divide-y divide-border">
            {requisitions.slice(0, 6).map((r: Requisition) => {
              const list = applications.filter((a) => a.requisition_id === r.id);
              const best = list.reduce((m, a) => Math.max(m, scoreMap.get(a.id)?.overall_score ?? 0), 0);
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
                  <div className="flex shrink-0 items-center gap-4">
                    {best > 0 ? <ScoreChip score={best} size="sm" /> : null}
                    <div className="num text-right text-sm">
                      <div className="font-semibold">{list.length}</div>
                      <div className="text-xs text-muted-foreground">applicants</div>
                    </div>
                  </div>
                </Link>
              );
            })}
            {requisitions.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No requisitions raised yet.</p>
            ) : null}
          </div>
        </Panel>

        <Panel
          title="Best matched candidates"
          subtitle="Weighted JD↔CV score including social profiling"
          className="lg:col-span-2"
        >
          <div className="divide-y divide-border">
            {topCandidates.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No scored candidates yet.</p>
            ) : (
              topCandidates.map(({ app, score }) => (
                <Link
                  key={app.id}
                  to="/candidates/$id"
                  params={{ id: app.candidate_id }}
                  className="flex items-center gap-4 p-4 transition-colors hover:bg-surface-2"
                >
                  <ScoreChip score={score!.overall_score} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{candidateName(app.candidate_id)}</div>
                    <div className="truncate text-xs text-muted-foreground">{reqTitle(app.requisition_id)}</div>
                  </div>
                  <StageBadge stage={app.stage} />
                </Link>
              ))
            )}
          </div>
        </Panel>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel title="Needs attention" subtitle="Candidates sitting past the stage SLA">
          <div className="divide-y divide-border">
            {stalled.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">Nothing stalled. Pipeline is moving.</p>
            ) : (
              stalled.map(({ app, days }) => (
                <Link
                  key={app.id}
                  to="/candidates/$id"
                  params={{ id: app.candidate_id }}
                  className="flex items-center justify-between gap-3 p-4 text-sm transition-colors hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{candidateName(app.candidate_id)}</div>
                    <div className="truncate text-xs text-muted-foreground">{reqTitle(app.requisition_id)}</div>
                  </div>
                  <span className="num flex shrink-0 items-center gap-1 text-xs text-amber-600">
                    <Clock className="size-3.5" /> {days}d
                  </span>
                </Link>
              ))
            )}
          </div>
        </Panel>

        <Panel title="Scarcest must-have skills" subtitle="Most frequently missing across scored CVs">
          <div className="space-y-3 p-5">
            {scarceSkills.length === 0 ? (
              <p className="text-sm text-muted-foreground">Run the matching engine to see skill gaps.</p>
            ) : (
              scarceSkills.map(([skill, n]) => (
                <Bar key={skill} label={skill} value={n} max={scarceSkills[0]![1]} hint={`${n} CVs`} tone="warning" />
              ))
            )}
          </div>
        </Panel>

        <Panel
          title="Offers & interviews"
          subtitle={`${offerRows.length} offer(s) · ${acceptRate}% accepted`}
          action={
            <Button asChild variant="ghost" size="sm">
              <Link to="/offers">Manage</Link>
            </Button>
          }
        >
          <div className="space-y-4 p-5 text-sm">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <TrendingUp className="size-3.5" /> {accepted} in flight or accepted
            </div>
            {offerRows.length === 0 ? (
              <p className="text-muted-foreground">No offers raised yet.</p>
            ) : (
              <ul className="space-y-2">
                {offerRows.slice(0, 4).map((o) => (
                  <li key={o.id} className="flex items-center justify-between">
                    <span className="num">{inr(Number(o.offered_ctc))}</span>
                    <StatusBadge status={o.status} />
                  </li>
                ))}
              </ul>
            )}
            <div className="border-t border-border pt-3">
              <div className="mb-2 text-xs font-medium text-muted-foreground">Next interviews</div>
              {upcoming.length === 0 ? (
                <p className="text-xs text-muted-foreground">Nothing scheduled.</p>
              ) : (
                <ul className="space-y-1.5 text-xs">
                  {upcoming.map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2">
                      <span className="truncate">
                        L{i.level} · {i.interviewer || "unassigned"}
                      </span>
                      <span className="num shrink-0 text-muted-foreground">
                        {i.scheduled_at ? new Date(i.scheduled_at).toLocaleString() : "—"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <Button asChild variant="ghost" size="sm" className="mt-2 px-0">
                <Link to="/interviews">
                  Interview board <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </div>
        </Panel>
      </div>
    </>
  );
}

/** Kept for type-narrowing of the pool candidates in suggestions. */
export type PoolCandidate = Candidate;
