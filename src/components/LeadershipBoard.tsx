import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Crown } from "lucide-react";

import {
  applicationsQuery,
  candidatesQuery,
  departmentsQuery,
  interviewsQuery,
  offersQuery,
  requisitionsQuery,
} from "@/lib/data";
import { canonical } from "@/lib/lifecycle";
import { StatCard, inr } from "@/components/ats";

const OPEN_REQ = new Set(["approved", "pending_dh", "pending_hr", "pending_cbo", "draft"]);

function days(from: string | null, to: string | null) {
  if (!from || !to) return null;
  return Math.max(0, Math.round((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000));
}

/**
 * Executive view for the CHRO / HR head: demand, cost, velocity and risk at
 * organisation level rather than the recruiter's per-candidate work queue.
 */
export function LeadershipBoard({ scope }: { scope: "CHRO" | "HR head" }) {
  const reqs = useQuery(requisitionsQuery);
  const apps = useQuery(applicationsQuery);
  const offers = useQuery(offersQuery);
  const cands = useQuery(candidatesQuery);
  const depts = useQuery(departmentsQuery);
  const ivs = useQuery(interviewsQuery);

  const m = useMemo(() => {
    const requisitions = reqs.data ?? [];
    const applications = apps.data ?? [];
    const offerRows = offers.data ?? [];
    const departments = depts.data ?? [];
    const interviews = ivs.data ?? [];

    const open = requisitions.filter((r) => OPEN_REQ.has(r.status));
    const openings = open.reduce((s, r) => s + (r.openings ?? 0), 0);
    const awaitingApproval = requisitions.filter((r) => r.status.startsWith("pending")).length;
    const committedCtc = open.reduce((s, r) => s + Number(r.budget_ctc ?? 0) * (r.openings ?? 0), 0);
    const budgetedCost = departments.reduce((s, d) => s + Number(d.budgeted_cost ?? 0), 0);

    const stages = applications.map((a) => canonical(a.stage));
    const joined = stages.filter((s) => s === "joined").length;
    const inPlay = stages.filter((s) => !["joined", "rejected", "withdrawn"].includes(s)).length;

    const released = offerRows.filter((o) => ["released", "accepted", "declined"].includes(o.status));
    const accepted = offerRows.filter((o) => o.status === "accepted").length;
    const acceptRate = released.length ? Math.round((accepted / released.length) * 100) : null;

    const cycle = applications
      .map((a) => (canonical(a.stage) === "joined" ? days(a.applied_at, a.last_activity_at) : null))
      .filter((d): d is number => d !== null);
    const timeToHire = cycle.length ? Math.round(cycle.reduce((s, d) => s + d, 0) / cycle.length) : null;

    const coverage = openings ? Math.round((inPlay / openings) * 10) / 10 : null;

    const byDept = departments
      .map((d) => {
        const dReqs = open.filter((r) => r.department_id === d.id);
        const ids = new Set(dReqs.map((r) => r.id));
        return {
          name: d.name,
          openings: dReqs.reduce((s, r) => s + (r.openings ?? 0), 0),
          budgeted: d.budgeted_headcount ?? 0,
          pipeline: applications.filter((a) => ids.has(a.requisition_id)).length,
        };
      })
      .filter((d) => d.openings || d.budgeted)
      .sort((a, b) => b.openings - a.openings)
      .slice(0, 6);

    const pendingIvs = interviews.filter((i) => i.status !== "completed" && i.status !== "cancelled").length;

    return {
      openReqs: open.length,
      openings,
      awaitingApproval,
      committedCtc,
      budgetedCost,
      joined,
      inPlay,
      acceptRate,
      timeToHire,
      coverage,
      byDept,
      pendingIvs,
      poolSize: (cands.data ?? []).length,
    };
  }, [reqs.data, apps.data, offers.data, depts.data, ivs.data, cands.data]);

  return (
    <section className="space-y-4">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-primary">
        <Crown className="size-4" /> {scope} view · organisation level
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Open demand"
          value={`${m.openings} seats`}
          hint={`${m.openReqs} live requisitions · ${m.awaitingApproval} awaiting approval`}
          tone={m.awaitingApproval ? "warning" : "default"}
        />
        <StatCard
          label="Salary commitment"
          value={inr(m.committedCtc)}
          hint={m.budgetedCost ? `Departmental budget ${inr(m.budgetedCost)}` : "No departmental budget set"}
          tone={m.budgetedCost && m.committedCtc > m.budgetedCost ? "destructive" : "default"}
        />
        <StatCard
          label="Pipeline coverage"
          value={m.coverage === null ? "—" : `${m.coverage}× / seat`}
          hint={`${m.inPlay} candidates in play · pool ${m.poolSize}`}
          tone={m.coverage !== null && m.coverage < 3 ? "warning" : "success"}
        />
        <StatCard
          label="Offer accept rate"
          value={m.acceptRate === null ? "—" : `${m.acceptRate}%`}
          hint={`${m.joined} joined · ${m.pendingIvs} interviews outstanding`}
          tone={m.acceptRate !== null && m.acceptRate < 70 ? "warning" : "success"}
        />
      </div>

      <div className="panel p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold">Demand & supply by department</h2>
          <span className="num text-xs text-muted-foreground">
            {m.timeToHire === null ? "Time to hire: no hires yet" : `Avg time to hire ${m.timeToHire} days`}
          </span>
        </div>
        {m.byDept.length ? (
          <table className="mt-3 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-2">Department</th>
                <th className="py-2 text-right">Open seats</th>
                <th className="py-2 text-right">Budgeted headcount</th>
                <th className="py-2 text-right">Candidates in pipeline</th>
              </tr>
            </thead>
            <tbody>
              {m.byDept.map((d) => (
                <tr key={d.name} className="border-t border-border">
                  <td className="py-2">{d.name}</td>
                  <td className="num py-2 text-right">{d.openings}</td>
                  <td className="num py-2 text-right">{d.budgeted}</td>
                  <td className="num py-2 text-right">{d.pipeline}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            No departmental demand yet — raise requisitions to populate this view.
          </p>
        )}
      </div>
    </section>
  );
}
