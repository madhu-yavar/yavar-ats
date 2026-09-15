import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BriefcaseBusiness,
  CalendarClock,
  CheckCircle2,
  Clock,
  Copy,
  Search,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
} from "lucide-react";

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
import { ScoreChip, StageBadge, StatusBadge, inr } from "@/components/ats";
import { useRoles } from "@/hooks/useRoles";
import { useOrg } from "@/hooks/useOrg";
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
      <div className="flex items-start justify-between gap-3 border-b border-border p-4">
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
  const { org, isOwner } = useOrg();
  const roleLabel = isOwner
    ? "Organisation owner"
    : isAdmin
      ? "CHRO"
      : roles.includes("hr_head")
        ? "HR head"
        : roles.includes("department_head")
          ? "Department head"
          : roles.includes("hiring_manager")
            ? "Hiring manager"
            : "Recruiter";
  const isExecutive = isAdmin || roles.includes("hr_head");
  const [queueView, setQueueView] = useState<"priority" | "matches" | "recent">("priority");
  const [queueSearch, setQueueSearch] = useState("");
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

  const queueRows = useMemo(() => {
    const rows = applications
      .map((app) => {
        const candidate = candidates.find((c) => c.id === app.candidate_id);
        const requisition = requisitions.find((r) => r.id === app.requisition_id);
        const score = scoreMap.get(app.id)?.overall_score ?? 0;
        return candidate && requisition ? { app, candidate, requisition, score } : null;
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row));

    const term = queueSearch.trim().toLowerCase();
    return rows
      .filter((row) => {
        if (term && !`${row.candidate.full_name} ${row.requisition.title} ${row.candidate.current_employer ?? ""}`.toLowerCase().includes(term)) return false;
        if (queueView === "matches") return row.score >= 70;
        if (queueView === "recent") return Date.now() - new Date(row.app.last_activity_at).getTime() < 7 * 86_400_000;
        return !["joined", "rejected", "withdrawn"].includes(canonical(row.app.stage as Stage));
      })
      .sort((a, b) => {
        if (queueView === "recent") return new Date(b.app.last_activity_at).getTime() - new Date(a.app.last_activity_at).getTime();
        return b.score - a.score;
      })
      .slice(0, 8);
  }, [applications, candidates, requisitions, scoreMap, queueSearch, queueView]);

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      <header className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:px-7 lg:flex-row lg:items-center lg:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold text-muted-foreground">
            <span className="uppercase">Talent acquisition</span>
            <span aria-hidden="true" className="size-1 rounded-full bg-border" />
            <span>Command centre</span>
          </div>
          <h1 className="truncate text-2xl font-bold">{org?.name ?? "Organisation"}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><ShieldCheck className="size-3.5 text-primary" />{roleLabel} view</span>
            <span>Organisation-scoped access</span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><Link to="/candidates"><Users />Talent pool</Link></Button>
          <Button asChild><Link to="/requisitions">Raise requisition</Link></Button>
        </div>
      </header>

      <section className="grid border-b border-border bg-surface-2/50 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: "Open requisitions", value: open.length, note: `${pending.length} awaiting approval` },
          { label: "Candidates in play", value: applications.filter((a) => !["joined", "rejected", "withdrawn"].includes(canonical(a.stage as Stage))).length, note: `${candidates.length} in talent pool` },
          { label: "Average match", value: `${avgMatch}%`, note: `${scored.length} of ${applications.length} scored` },
          isExecutive
            ? { label: "Salary committed", value: inr(committed), note: `${inr(budgeted)} budgeted` }
            : { label: "Upcoming interviews", value: upcoming.length, note: `${stalled.length} candidates need attention` },
        ].map((metric) => (
          <div key={metric.label} className="border-b border-border px-5 py-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r xl:border-b-0 xl:border-r xl:last:border-r-0">
            <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
            <p className="num mt-1 text-2xl font-bold">{metric.value}</p>
            <p className="mt-1 text-xs text-muted-foreground">{metric.note}</p>
          </div>
        ))}
      </section>

      <div className="grid lg:grid-cols-[minmax(0,1.65fr)_minmax(280px,0.75fr)]">
        <section className="border-b border-border p-5 sm:p-7 lg:border-b-0 lg:border-r">
          <div className="mb-5 flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">Priority workspace</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">The next candidates and decisions for your role.</p>
            </div>
            <Button asChild variant="ghost" size="sm"><Link to="/matching">Matching engine <ArrowUpRight /></Link></Button>
          </div>

          <div className="mb-4 flex flex-col gap-3 xl:flex-row">
            <label className="relative min-w-0 flex-1">
              <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <span className="sr-only">Search candidates or roles</span>
              <input value={queueSearch} onChange={(event) => setQueueSearch(event.target.value)} placeholder="Search candidates or roles" className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring/30" />
            </label>
            <div className="flex rounded-md bg-secondary p-1" aria-label="Queue view">
              {([['priority', 'Priority'], ['matches', 'Top matches'], ['recent', 'Recent']] as const).map(([value, label]) => (
                <Button key={value} type="button" size="sm" variant={queueView === value ? "outline" : "ghost"} onClick={() => setQueueView(value)} className="flex-1 shadow-none xl:flex-none">{label}</Button>
              ))}
            </div>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[680px] text-left text-sm">
              <thead className="border-b border-border bg-surface-2/70 text-xs text-muted-foreground">
                <tr><th className="px-4 py-3 font-semibold">Candidate</th><th className="px-4 py-3 font-semibold">Role</th><th className="px-4 py-3 font-semibold">Fit</th><th className="px-4 py-3 font-semibold">Stage</th><th className="px-4 py-3 text-right font-semibold">Action</th></tr>
              </thead>
              <tbody className="divide-y divide-border">
                {queueRows.map(({ app, candidate, requisition, score }) => (
                  <tr key={app.id} className="transition-colors hover:bg-surface-2/70">
                    <td className="px-4 py-3"><div className="font-semibold">{candidate.full_name}</div><div className="text-xs text-muted-foreground">{candidate.current_employer || candidate.location || "Profile available"}</div></td>
                    <td className="px-4 py-3"><div className="font-medium">{requisition.title}</div><div className="num text-xs text-muted-foreground">{requisition.code}</div></td>
                    <td className="px-4 py-3">{score ? <ScoreChip score={score} size="sm" /> : <span className="text-xs text-muted-foreground">Not scored</span>}</td>
                    <td className="px-4 py-3"><StageBadge stage={app.stage} /></td>
                    <td className="px-4 py-3 text-right"><Button asChild variant="ghost" size="sm"><Link to="/candidates/$id" params={{ id: candidate.id }}>Review <ArrowRight /></Link></Button></td>
                  </tr>
                ))}
                {queueRows.length === 0 ? <tr><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No candidates match this view.</td></tr> : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="p-5 sm:p-7">
          <h2 className="font-semibold">Action queue</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">Only actions available to {roleLabel.toLowerCase()}.</p>
          <div className="mt-5 divide-y divide-border border-y border-border">
            {pending.length > 0 && (isExecutive || roles.includes("department_head")) ? <ActionRow icon={CheckCircle2} label="Requisitions awaiting approval" value={pending.length} to="/requisitions" /> : null}
            <ActionRow icon={Clock} label="Candidates past stage SLA" value={stalled.length} to="/candidates" tone={stalled.length ? "warning" : "default"} />
            <ActionRow icon={CalendarClock} label="Upcoming interviews" value={upcoming.length} to="/interviews" />
            <ActionRow icon={BriefcaseBusiness} label="Open requisitions" value={open.length} to="/requisitions" />
          </div>
          <div className="mt-6">
            <div className="mb-3 flex items-center justify-between"><h3 className="text-sm font-semibold">Pipeline movement</h3><span className="text-xs text-muted-foreground">All active stages</span></div>
            <div className="space-y-3">
              {funnel.slice(0, 6).map((row) => <Bar key={row.stage} label={STAGE_LABEL[row.stage] ?? row.stage} value={row.reached} max={funnelTop} />)}
              {funnel.length === 0 ? <p className="text-sm text-muted-foreground">No applications yet.</p> : null}
            </div>
          </div>
        </aside>
      </div>

      {isExecutive ? (
        <section className="border-t border-border p-5 sm:p-7">
          <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="font-semibold">Organisation health</h2><p className="mt-0.5 text-xs text-muted-foreground">Executive demand, quality and cost signals.</p></div><Button asChild variant="ghost" size="sm"><Link to="/reports">Full reports <ArrowUpRight /></Link></Button></div>
          <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border md:grid-cols-4">
            <Signal label="Offer acceptance" value={offerRows.length ? `${acceptRate}%` : "—"} note={`${accepted} accepted or released`} />
            <Signal label="Pool freshness" value={candidates.length ? `${Math.round((poolHealth.fresh / candidates.length) * 100)}%` : "—"} note={`${poolHealth.stale} stale profiles`} />
            <Signal label="Incomplete profiles" value={poolHealth.noSkills + poolHealth.noEmail} note={`${poolHealth.groups} duplicate sets`} />
            <Signal label="Budget position" value={budgeted ? `${Math.round((committed / budgeted) * 100)}%` : "—"} note="of workforce budget committed" />
          </div>
        </section>
      ) : null}

      {/* Historic matching — the pool works for every new requisition automatically. */}
      <Panel
        className="m-5 sm:m-7"
        title="Suggested from your existing pool"
        subtitle="Deterministic must-have / experience / location overlap against every open requisition — no AI spend until you shortlist."
        action={
          <Button asChild variant="ghost" size="sm">
            <Link to="/matching">Score them</Link>
          </Button>
        }
      >
        {suggestions.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">
            No pool matches yet. Add candidates to the talent pool or approve a requisition, and historic matches appear
            here automatically.
          </p>
        ) : (
          <div className="divide-y divide-border">
            {suggestions.map(({ req, ranked }) => (
              <div key={req.id} className="p-4">
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

      <div className="m-5 grid gap-4 sm:m-7 lg:grid-cols-3">
        <Panel title="Pipeline funnel" subtitle="Cumulative candidates that reached each stage" className="lg:col-span-1">
          <div className="space-y-3 p-4">
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
          <div className="space-y-3 p-4">
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
          <div className="space-y-3 p-4">
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

      <div className="m-5 grid gap-4 sm:m-7 lg:grid-cols-5">
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
                  className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-surface-2"
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
              <p className="p-4 text-sm text-muted-foreground">No requisitions raised yet.</p>
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
              <p className="p-4 text-sm text-muted-foreground">No scored candidates yet.</p>
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

      <div className="m-5 grid gap-4 sm:m-7 lg:grid-cols-3">
        <Panel title="Needs attention" subtitle="Candidates sitting past the stage SLA">
          <div className="divide-y divide-border">
            {stalled.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nothing stalled. Pipeline is moving.</p>
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
          <div className="space-y-3 p-4">
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
          <div className="space-y-4 p-4 text-sm">
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
    </div>
  );
}

function ActionRow({ icon: Icon, label, value, to, tone = "default" }: { icon: React.ComponentType<{ className?: string }>; label: string; value: number; to: "/requisitions" | "/candidates" | "/interviews"; tone?: "default" | "warning" }) {
  return <Link to={to} className="group flex items-center gap-3 py-3.5"><span className={`flex size-8 items-center justify-center rounded-md ${tone === "warning" ? "bg-warning/15 text-warning" : "bg-secondary text-muted-foreground"}`}><Icon className="size-4" /></span><span className="min-w-0 flex-1 text-sm font-medium">{label}</span><span className="num text-sm font-semibold">{value}</span><ArrowRight className="size-4 text-muted-foreground transition-transform group-hover:translate-x-0.5" /></Link>;
}

function Signal({ label, value, note }: { label: string; value: string | number; note: string }) {
  return <div className="bg-card p-4"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="num mt-1 text-xl font-bold">{value}</p><p className="mt-1 text-xs text-muted-foreground">{note}</p></div>;
}

/** Kept for type-narrowing of the pool candidates in suggestions. */
export type PoolCandidate = Candidate;
