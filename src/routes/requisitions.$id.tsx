import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, Sparkles, Upload } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  applicationsQuery,
  candidatesQuery,
  departmentsQuery,
  jdQuery,
  latestScores,
  matchScoresQuery,
  requisitionQuery,
} from "@/lib/data";
import { generateJd, importJd } from "@/lib/matching.functions";
import { balanceWeights, extractResumeText } from "@/lib/cv-extract";

import { useRoles } from "@/hooks/useRoles";

import {
  EmptyState,
  PageHeader,
  ScoreChip,
  SkillPills,
  StageBadge,
  StatusBadge,
  inr,
} from "@/components/ats";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";


export const Route = createFileRoute("/requisitions/$id")({
  head: () => ({
    meta: [
      { title: "Requisition detail & AI job description — ATS" },
      {
        name: "description",
        content:
          "Approve the requisition, draft the job description with AI, tune match weights and review the applicant pipeline.",
      },
      { property: "og:title", content: "Requisition detail & AI job description" },
      {
        property: "og:description",
        content: "Approval trail, AI-generated JD versions, weight configuration and applicant match scores.",
      },
    ],
  }),
  component: RequisitionDetail,
});

type TrailEntry = { from?: string; to?: string; at?: string; comment?: string | null };

const APPROVALS: Record<string, { next: string; label: string }> = {
  draft: { next: "pending_dh", label: "Send to Department Head" },
  pending_dh: { next: "pending_hr", label: "Approve as Department Head" },
  pending_hr: { next: "pending_cbo", label: "Approve as HR Head" },
  pending_cbo: { next: "approved", label: "Approve as President / CBO" },
};

function RequisitionDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const req = useQuery(requisitionQuery(id));
  const jds = useQuery(jdQuery(id));
  const depts = useQuery(departmentsQuery);
  const apps = useQuery(applicationsQuery);
  const cands = useQuery(candidatesQuery);
  const scores = useQuery(matchScoresQuery);
  const draftJd = useServerFn(generateJd);
  const runImportJd = useServerFn(importJd);
  const { roles, canApprove, requiredRoleFor } = useRoles();

  const [busy, setBusy] = useState(false);
  const [jdText, setJdText] = useState<string | null>(null);
  const [jdPaste, setJdPaste] = useState("");
  const [showImport, setShowImport] = useState(false);
  const [comment, setComment] = useState("");


  const r = req.data;
  if (req.isLoading) return <p className="text-sm text-muted-foreground">Loading requisition…</p>;
  if (!r) return <EmptyState title="Requisition not found" />;

  const dept = (depts.data ?? []).find((d) => d.id === r.department_id);
  const latestJd = (jds.data ?? [])[0];
  const scoreMap = latestScores(scores.data ?? []);
  const pipeline = (apps.data ?? []).filter((a) => a.requisition_id === r.id);
  const weights = {
    skills: r.weight_skills,
    experience: r.weight_experience,
    education: r.weight_education,
    social: r.weight_social,
  };
  const weightTotal = Object.values(weights).reduce((a, b) => a + b, 0);
  const step = APPROVALS[r.status];
  const allowed = step ? canApprove(r.status) : false;

  async function advance() {
    if (!step) return;
    if (!allowed) {
      toast.error(`Only the ${requiredRoleFor(r!.status)} can action this step`);
      return;
    }
    setBusy(true);
    const trail = [
      ...(Array.isArray(r!.approval_trail) ? (r!.approval_trail as unknown[]) : []),
      {
        from: r!.status,
        to: step.next,
        comment: comment || null,
        at: new Date().toISOString(),
        by_role: roles[0] ?? null,
      },
    ];
    const { error } = await supabase
      .from("requisitions")
      .update({ status: step.next as never, approval_trail: trail as never })
      .eq("id", r!.id);
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setComment("");
    toast.success(`Requisition moved to ${step.next.replace("_", " ")}`);
    qc.invalidateQueries({ queryKey: ["requisition", id] });
    qc.invalidateQueries({ queryKey: ["requisitions"] });
  }

  async function toggleIjp(enabled: boolean) {
    const { error } = await supabase
      .from("requisitions")
      .update({ ijp_enabled: enabled, ijp_posted_at: enabled ? new Date().toISOString() : null })
      .eq("id", r!.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(enabled ? "Published to the internal job board" : "Removed from the internal job board");
    qc.invalidateQueries({ queryKey: ["requisition", id] });
    qc.invalidateQueries({ queryKey: ["requisitions"] });
  }

  async function saveIjpNotes(notes: string) {
    await supabase.from("requisitions").update({ ijp_notes: notes || null }).eq("id", r!.id);
    qc.invalidateQueries({ queryKey: ["requisition", id] });
  }


  async function draft() {
    setBusy(true);
    try {
      const jd = await draftJd({
        data: {
          title: r!.title,
          department: dept?.name ?? null,
          location: r!.location,
          experienceMin: r!.experience_min,
          experienceMax: r!.experience_max,
          mustHave: r!.must_have_skills,
          goodToHave: r!.good_to_have_skills,
          responsibilities: r!.responsibilities,
          education: r!.education_requirement,
          reportingTo: r!.hiring_manager,
        },
      });
      const { error } = await supabase.from("job_descriptions").insert({
        requisition_id: r!.id,
        version: ((jds.data ?? [])[0]?.version ?? 0) + 1,
        status: "pending_dh",
        purpose: jd.purpose,
        responsibilities: jd.responsibilities,
        must_have: jd.must_have,
        good_to_have: jd.good_to_have,
        qualifications: jd.qualifications,
        success_factors: jd.success_factors,
        reporting_to: jd.reporting_to,
        full_text: jd.full_text,
      });
      if (error) throw new Error(error.message);
      toast.success("JD drafted and sent for Department Head review");
      qc.invalidateQueries({ queryKey: ["jd", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "JD generation failed");
    } finally {
      setBusy(false);
  }

  /** Take a recruiter's own JD (pasted text or PDF/DOCX/TXT file) and file it as a JD version. */
  async function useExistingJd(raw: string) {
    const text = raw.trim();
    if (text.length < 30) {
      toast.error("Paste or upload the full JD text first");
      return;
    }
    setBusy(true);
    try {
      const jd = await runImportJd({ data: { jdText: text, title: r!.title } });
      const { error } = await supabase.from("job_descriptions").insert({
        requisition_id: r!.id,
        version: ((jds.data ?? [])[0]?.version ?? 0) + 1,
        status: "pending_dh",
        purpose: jd.purpose,
        responsibilities: jd.responsibilities,
        must_have: jd.must_have,
        good_to_have: jd.good_to_have,
        qualifications: jd.qualifications,
        success_factors: jd.success_factors,
        reporting_to: jd.reporting_to,
        full_text: jd.full_text,
      });
      if (error) throw new Error(error.message);

      // Keep the requisition's scoring baseline in sync with the uploaded JD.
      const patch: {
        must_have_skills?: string[];
        good_to_have_skills?: string[];
        experience_min?: number;
        experience_max?: number;
      } = {};
      if (jd.must_have?.length && !r!.must_have_skills.length) patch.must_have_skills = jd.must_have;
      if (jd.good_to_have?.length && !r!.good_to_have_skills.length) patch.good_to_have_skills = jd.good_to_have;
      if ((jd.experience_min || jd.experience_max) && !r!.experience_min && !r!.experience_max) {
        patch.experience_min = jd.experience_min;
        patch.experience_max = Math.max(jd.experience_max, jd.experience_min);
      }
      if (Object.keys(patch).length) await supabase.from("requisitions").update(patch).eq("id", r!.id);


      setJdPaste("");
      setShowImport(false);
      toast.success("Your JD was imported, structured and sent for Department Head review");
      qc.invalidateQueries({ queryKey: ["jd", id] });
      qc.invalidateQueries({ queryKey: ["requisition", id] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "JD import failed");
    } finally {
      setBusy(false);
    }
  }

  async function onJdFile(file: File | undefined) {
    if (!file) return;
    setBusy(true);
    try {
      const text = await extractResumeText(file);
      setJdPaste(text);
      await useExistingJd(text);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not read that file");
      setBusy(false);
    }
  }

  }

  async function approveJd() {
    if (!latestJd) return;
    const { error } = await supabase
      .from("job_descriptions")
      .update({ status: "approved", full_text: jdText ?? latestJd.full_text })
      .eq("id", latestJd.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("JD approved — sourcing can begin");
    qc.invalidateQueries({ queryKey: ["jd", id] });
  }

  async function saveWeights(next: typeof weights) {
    const { error } = await supabase
      .from("requisitions")
      .update({
        weight_skills: next.skills,
        weight_experience: next.experience,
        weight_education: next.education,
        weight_social: next.social,
      })
      .eq("id", r!.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    qc.invalidateQueries({ queryKey: ["requisition", id] });
  }

  return (
    <>
      <Link
        to="/requisitions"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> All requisitions
      </Link>

      <PageHeader
        eyebrow={r.code}
        title={r.title}
        description={`${dept?.name ?? "Unassigned"} · ${r.location} · ${r.openings} opening(s) · ${r.experience_min}–${r.experience_max} yrs · ${inr(Number(r.budget_ctc))}`}
        actions={
          <div className="flex items-center gap-2">
            <StatusBadge status={r.status} />
            {step && (
              <div className="text-right">
                <Button onClick={advance} disabled={busy || !allowed}>
                  {step.label}
                </Button>
                {!allowed && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Requires the {requiredRoleFor(r.status)} role
                  </p>
                )}
              </div>
            )}
          </div>
        }
      />


      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="panel p-5">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="font-semibold">Job description</h2>
                <p className="text-xs text-muted-foreground">
                  {latestJd ? `Version ${latestJd.version} · ${latestJd.status}` : "No JD drafted yet"}
                </p>
              </div>
              <Button variant="outline" onClick={draft} disabled={busy}>
                <Sparkles className="size-4" /> {latestJd ? "Redraft with AI" : "Draft with AI"}
              </Button>
            </div>

            {latestJd ? (
              <div className="mt-4 space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs text-muted-foreground">Must have</Label>
                    <div className="mt-1.5">
                      <SkillPills skills={latestJd.must_have} tone="match" />
                    </div>
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">Good to have</Label>
                    <div className="mt-1.5">
                      <SkillPills skills={latestJd.good_to_have} />
                    </div>
                  </div>
                </div>
                <Textarea
                  rows={16}
                  className="num text-xs leading-relaxed"
                  value={jdText ?? latestJd.full_text ?? ""}
                  onChange={(e) => setJdText(e.target.value)}
                />
                <div className="flex gap-2">
                  <Button onClick={approveJd} disabled={latestJd.status === "approved"}>
                    {latestJd.status === "approved" ? "JD approved" : "Approve JD"}
                  </Button>
                  <Button asChild variant="outline">
                    <Link to="/matching" search={{ req: r.id }}>
                      Score candidates against this JD
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                Generate a JD from the requisition inputs — must-have skills, experience band and responsibilities
                become the scoring baseline for JD↔CV matching.
              </p>
            )}
          </section>

          <section className="panel">
            <div className="border-b border-border p-5">
              <h2 className="font-semibold">Applicant pipeline</h2>
              <p className="text-xs text-muted-foreground">{pipeline.length} applicant(s)</p>
            </div>
            {pipeline.length === 0 ? (
              <p className="p-5 text-sm text-muted-foreground">No applications against this requisition yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {pipeline.map((a) => {
                  const c = (cands.data ?? []).find((x) => x.id === a.candidate_id);
                  const s = scoreMap.get(a.id);
                  return (
                    <li key={a.id} className="flex items-center gap-4 p-4">
                      {s ? (
                        <ScoreChip score={s.overall_score} />
                      ) : (
                        <span className="num w-12 text-center text-xs text-muted-foreground">—</span>
                      )}
                      <Link
                        to="/candidates/$id"
                        params={{ id: a.candidate_id }}
                        className="min-w-0 flex-1 hover:underline"
                      >
                        <div className="truncate font-medium">{c?.full_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {c?.experience_years} yrs · {c?.location} · via {a.source}
                        </div>
                      </Link>
                      <StageBadge stage={a.stage} />
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="panel p-5">
            <h2 className="font-semibold">Match weight configuration</h2>
            <p className="text-xs text-muted-foreground">
              Applied to every JD↔CV score for this requisition. Total must be 100.
            </p>
            <div className="mt-4 space-y-4">
              {(
                [
                  ["skills", "Skills fit"],
                  ["experience", "Experience"],
                  ["education", "Education"],
                  ["social", "Social profiling"],
                ] as const
              ).map(([key, label]) => (
                <div key={key}>
                  <div className="mb-1.5 flex items-center justify-between text-sm">
                    <span>{label}</span>
                    <span className="num font-semibold">{weights[key]}</span>
                  </div>
                  <Slider
                    value={[weights[key]]}
                    min={0}
                    max={70}
                    step={5}
                    onValueChange={([v]) => saveWeights({ ...weights, [key]: v })}
                  />
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                <p className={weightTotal === 100 ? "num text-xs text-muted-foreground" : "num text-xs text-destructive"}>
                  Total {weightTotal} / 100
                  {weightTotal !== 100 ? " — rebalance before scoring" : ""}
                </p>
                {weightTotal !== 100 && (
                  <Button size="sm" variant="outline" onClick={() => saveWeights(balanceWeights(weights))}>
                    Balance to 100
                  </Button>
                )}
              </div>
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Internal job posting (IJP)</h2>
            <p className="text-xs text-muted-foreground">
              Publish an approved requisition to employees first. Internal applicants are scored against the same JD.
            </p>
            <div className="mt-4 flex items-center justify-between gap-3">
              <div className="text-sm">
                {r.status === "approved"
                  ? r.ijp_enabled
                    ? "Live on the internal job board"
                    : "Not published internally"
                  : "Available once the requisition is approved"}
              </div>
              <Switch
                checked={r.ijp_enabled}
                disabled={r.status !== "approved"}
                onCheckedChange={toggleIjp}
              />
            </div>
            {r.ijp_enabled && (
              <div className="mt-4">
                <Label className="mb-1.5 block text-xs text-muted-foreground">Note for employees</Label>
                <Textarea
                  rows={3}
                  defaultValue={r.ijp_notes ?? ""}
                  onBlur={(e) => saveIjpNotes(e.target.value)}
                  placeholder="Eligibility, minimum tenure, manager endorsement…"
                />
                <Button asChild size="sm" variant="outline" className="mt-3">
                  <Link to="/ijp">Open internal job board</Link>
                </Button>
              </div>
            )}
          </section>


          <section className="panel p-5">
            <h2 className="font-semibold">Approval trail</h2>
            <ol className="mt-3 space-y-3 text-sm">
              {(Array.isArray(r.approval_trail)
                ? (r.approval_trail as unknown as TrailEntry[])
                : []
              ).map((t, i) => (
                <li key={i} className="border-l-2 border-border pl-3">
                  <div className="font-medium">
                    {String(t.from ?? "").replace("_", " ")} → {String(t.to ?? "").replace("_", " ")}
                  </div>
                  <div className="num text-xs text-muted-foreground">
                    {t.at ? new Date(t.at).toLocaleString() : ""}
                  </div>
                  {t.comment ? <p className="mt-1 text-xs">{t.comment}</p> : null}
                </li>
              ))}
              {(!Array.isArray(r.approval_trail) || r.approval_trail.length === 0) && (
                <li className="text-xs text-muted-foreground">No approval actions recorded yet.</li>
              )}
            </ol>
            {step && (
              <div className="mt-4">
                <Label className="mb-1.5 block text-xs text-muted-foreground">Approver comment</Label>
                <Input value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Optional note" />
              </div>
            )}
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Requisition inputs</h2>
            <div className="mt-3 space-y-3 text-sm">
              <div>
                <Label className="text-xs text-muted-foreground">Must have</Label>
                <div className="mt-1.5">
                  <SkillPills skills={r.must_have_skills} tone="match" />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Good to have</Label>
                <div className="mt-1.5">
                  <SkillPills skills={r.good_to_have_skills} />
                </div>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Education</Label>
                <p>{r.education_requirement ?? "—"}</p>
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Hiring manager</Label>
                <p>{r.hiring_manager ?? "—"}</p>
              </div>
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
