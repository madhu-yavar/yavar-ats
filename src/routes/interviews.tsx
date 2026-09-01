import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import {
  applicationsQuery,
  candidatesQuery,
  evaluationsQuery,
  interviewsQuery,
  latestScores,
  matchScoresQuery,
  requisitionsQuery,
} from "@/lib/data";
import { EmptyState, PageHeader, ScoreChip, StageBadge } from "@/components/ats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/interviews")({
  head: () => ({
    meta: [
      { title: "Interviews & 3-Level Evaluations — ATS" },
      {
        name: "description",
        content:
          "Schedule L1 technical, L2 functional and L3 leadership interviews, and capture structured evaluations that move candidates to offer.",
      },
      { property: "og:title", content: "Interviews & 3-Level Evaluations" },
      {
        property: "og:description",
        content: "Level-wise interview scheduling with structured ratings, comments and select/hold/reject verdicts.",
      },
    ],
  }),
  component: Interviews,
});

const LEVELS = [
  { level: 1, label: "L1 — Technical / functional screen" },
  { level: 2, label: "L2 — Domain & role fit" },
  { level: 3, label: "L3 — Leadership & culture" },
];

function Interviews() {
  const qc = useQueryClient();
  const apps = useQuery(applicationsQuery);
  const cands = useQuery(candidatesQuery);
  const reqs = useQuery(requisitionsQuery);
  const scores = useQuery(matchScoresQuery);
  const ivs = useQuery(interviewsQuery);
  const evals = useQuery(evaluationsQuery);

  const [form, setForm] = useState({
    application_id: "",
    level: "1",
    evaluator: "",
    focus_area: "",
    rating: "3",
    recommendation: "hold",
    comments: "",
  });

  const scoreMap = latestScores(scores.data ?? []);
  const eligible = (apps.data ?? []).filter((a) =>
    ["shortlisted", "ai_screened", "l1", "l2", "l3", "offer"].includes(a.stage),
  );

  async function schedule(applicationId: string, level: number) {
    const { error } = await supabase.from("interviews").insert({
      application_id: applicationId,
      level,
      status: "scheduled",
      scheduled_at: new Date(Date.now() + 86400000).toISOString(),
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    await supabase
      .from("applications")
      .update({ stage: (`l${level}` as "l1" | "l2" | "l3") })
      .eq("id", applicationId);
    toast.success(`L${level} interview scheduled for tomorrow`);
    qc.invalidateQueries({ queryKey: ["interviews"] });
    qc.invalidateQueries({ queryKey: ["applications"] });
  }

  async function submitEvaluation() {
    if (!form.application_id) {
      toast.error("Pick a candidate first");
      return;
    }
    const { error } = await supabase.from("evaluations").insert({
      application_id: form.application_id,
      level: Number(form.level),
      evaluator: form.evaluator || null,
      focus_area: form.focus_area || null,
      rating: Number(form.rating),
      recommendation: form.recommendation as "select" | "reject" | "hold",
      comments: form.comments || null,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    if (form.recommendation === "select" && form.level === "3") {
      await supabase.from("applications").update({ stage: "offer" }).eq("id", form.application_id);
    }
    if (form.recommendation === "reject") {
      await supabase.from("applications").update({ stage: "rejected" }).eq("id", form.application_id);
    }
    toast.success("Evaluation recorded");
    setForm({ ...form, comments: "", focus_area: "" });
    qc.invalidateQueries({ queryKey: ["evaluations"] });
    qc.invalidateQueries({ queryKey: ["applications"] });
  }

  return (
    <>
      <PageHeader
        eyebrow="Selection"
        title="Interviews & evaluations"
        description="Three evaluation levels, each with its own focus area and verdict. An L3 select moves the candidate straight to offer."
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <section className="panel lg:col-span-2">
          <div className="border-b border-border p-5">
            <h2 className="font-semibold">Shortlisted candidates</h2>
            <p className="text-xs text-muted-foreground">{eligible.length} in the interview funnel</p>
          </div>
          {eligible.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title="Nobody shortlisted yet"
                hint="Run the matching engine — candidates scoring 75+ are auto-shortlisted."
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {eligible.map((a) => {
                const c = (cands.data ?? []).find((x) => x.id === a.candidate_id);
                const r = (reqs.data ?? []).find((x) => x.id === a.requisition_id);
                const s = scoreMap.get(a.id);
                const rounds = (ivs.data ?? []).filter((i) => i.application_id === a.id);
                const done = (evals.data ?? []).filter((e) => e.application_id === a.id);
                return (
                  <li key={a.id} className="p-5">
                    <div className="flex flex-wrap items-center gap-3">
                      {s ? <ScoreChip score={s.overall_score} /> : null}
                      <div className="min-w-0 flex-1">
                        <Link
                          to="/candidates/$id"
                          params={{ id: a.candidate_id }}
                          className="font-medium hover:underline"
                        >
                          {c?.full_name}
                        </Link>
                        <div className="text-xs text-muted-foreground">{r?.title}</div>
                      </div>
                      <StageBadge stage={a.stage} />
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {LEVELS.map(({ level }) => {
                        const has = rounds.some((i) => i.level === level);
                        const evaluated = done.some((e) => e.level === level);
                        return (
                          <Button
                            key={level}
                            size="sm"
                            variant={evaluated ? "secondary" : has ? "default" : "outline"}
                            onClick={() => schedule(a.id, level)}
                          >
                            L{level} {evaluated ? "evaluated" : has ? "scheduled" : "schedule"}
                          </Button>
                        );
                      })}
                      <Button size="sm" variant="ghost" onClick={() => setForm({ ...form, application_id: a.id })}>
                        Add evaluation
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="panel p-5">
          <h2 className="font-semibold">Record an evaluation</h2>
          <div className="mt-4 space-y-4">
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Candidate</Label>
              <Select
                value={form.application_id}
                onValueChange={(v) => setForm({ ...form, application_id: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select candidate" />
                </SelectTrigger>
                <SelectContent>
                  {eligible.map((a) => {
                    const c = (cands.data ?? []).find((x) => x.id === a.candidate_id);
                    return (
                      <SelectItem key={a.id} value={a.id}>
                        {c?.full_name}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Level</Label>
              <Select value={form.level} onValueChange={(v) => setForm({ ...form, level: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LEVELS.map((l) => (
                    <SelectItem key={l.level} value={String(l.level)}>
                      {l.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Evaluator</Label>
              <Input value={form.evaluator} onChange={(e) => setForm({ ...form, evaluator: e.target.value })} />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Focus area</Label>
              <Input
                value={form.focus_area}
                onChange={(e) => setForm({ ...form, focus_area: e.target.value })}
                placeholder="System design, ownership, communication…"
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Rating (1–5)</Label>
              <Input
                type="number"
                min={1}
                max={5}
                value={form.rating}
                onChange={(e) => setForm({ ...form, rating: e.target.value })}
              />
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Verdict</Label>
              <Select value={form.recommendation} onValueChange={(v) => setForm({ ...form, recommendation: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {["select", "hold", "reject"].map((v) => (
                    <SelectItem key={v} value={v}>
                      {v}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="mb-1.5 block text-xs text-muted-foreground">Comments</Label>
              <Textarea
                rows={4}
                value={form.comments}
                onChange={(e) => setForm({ ...form, comments: e.target.value })}
              />
            </div>
            <Button className="w-full" onClick={submitEvaluation}>
              Submit evaluation
            </Button>
          </div>
        </section>
      </div>
    </>
  );
}
