import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, Github, Linkedin, Loader2, PenLine, Target, UserPlus } from "lucide-react";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import {
  applicationsQuery,
  candidatesQuery,
  jdQuery,
  latestScores,
  matchScoresQuery,
  requisitionsQuery,
  socialProfilesQuery,
} from "@/lib/data";
import { matchJdToCv, matchPipeline, type MatchResult } from "@/lib/matching.functions";
import { importCandidates } from "@/lib/integrations.functions";
import { balanceWeights } from "@/lib/cv-extract";
import { rankPool } from "@/lib/shortlist";

import { EmptyState, PageHeader, ScoreBar, ScoreChip, SkillPills } from "@/components/ats";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export const Route = createFileRoute("/matching")({
  validateSearch: z.object({ req: z.string().optional() }),
  head: () => ({
    meta: [
      { title: "JD ↔ CV Matching Engine with Social Profiling — ATS" },
      {
        name: "description",
        content:
          "Weighted JD to CV matching: semantic skill mapping, deterministic experience bands, education fit and live GitHub, LinkedIn and public-writing social scores.",
      },
      { property: "og:title", content: "JD ↔ CV Matching Engine with Social Profiling" },
      {
        property: "og:description",
        content: "Auditable match scores with evidence, risk flags and recruiter override on every candidate.",
      },
    ],
  }),
  component: Matching,
});

type Weights = { skills: number; experience: number; education: number; social: number };

/** Social signals are re-used for this many days instead of being re-fetched. */
const SOCIAL_TTL_DAYS = 14;

function Matching() {
  const { req } = Route.useSearch();
  const navigate = Route.useNavigate();
  const qc = useQueryClient();

  const reqs = useQuery(requisitionsQuery);
  const apps = useQuery(applicationsQuery);
  const cands = useQuery(candidatesQuery);
  const scores = useQuery(matchScoresQuery);
  const socials = useQuery(socialProfilesQuery);
  const runMatch = useServerFn(matchJdToCv);
  const runPipeline = useServerFn(matchPipeline);
  const runImport = useServerFn(importCandidates);
  const boards = useQuery({
    queryKey: ["source_integrations", "enabled"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("source_integrations")
        .select("provider, label, enabled")
        .eq("enabled", true)
        .in("provider", ["naukri", "indeed", "linkedin"]);
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  });

  const requisitions = reqs.data ?? [];
  const activeId = req ?? requisitions[0]?.id ?? "";
  const requisition = requisitions.find((r) => r.id === activeId);
  const jds = useQuery({ ...jdQuery(activeId), enabled: Boolean(activeId) });
  const jd = (jds.data ?? [])[0];

  const [weights, setWeights] = useState<Weights | null>(null);
  const [includeSocial, setIncludeSocial] = useState(true);
  const [running, setRunning] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, MatchResult>>({});
  const [overrideReason, setOverrideReason] = useState("");
  const [bulk, setBulk] = useState<{ done: number; total: number } | null>(null);
  const [rescoreAll, setRescoreAll] = useState(false);
  const [board, setBoard] = useState("");
  const [importing, setImporting] = useState(false);
  const [addingFromPool, setAddingFromPool] = useState(false);

  const effWeights: Weights = weights ?? {
    skills: requisition?.weight_skills ?? 50,
    experience: requisition?.weight_experience ?? 25,
    education: requisition?.weight_education ?? 10,
    social: requisition?.weight_social ?? 15,
  };
  const weightTotal = effWeights.skills + effWeights.experience + effWeights.education + effWeights.social;

  /** Set one weight and spread the remaining points across the other three, keeping the total at 100. */
  function setWeight(key: keyof Weights, raw: number) {
    const value = Math.max(0, Math.min(100, Math.round(Number.isFinite(raw) ? raw : 0)));
    const others = (Object.keys(effWeights) as (keyof Weights)[]).filter((k) => k !== key);
    const otherTotal = others.reduce((s, k) => s + effWeights[k], 0);
    const remaining = 100 - value;
    const next = { ...effWeights, [key]: value } as Weights;

    if (otherTotal === 0) {
      others.forEach((k, i) => (next[k] = Math.floor(remaining / 3) + (i < remaining % 3 ? 1 : 0)));
    } else {
      let assigned = 0;
      others.forEach((k, i) => {
        const v = i === others.length - 1 ? remaining - assigned : Math.round((effWeights[k] / otherTotal) * remaining);
        next[k] = Math.max(0, v);
        assigned += next[k];
      });
    }
    setWeights(next);
  }


  const scoreMap = latestScores(scores.data ?? []);
  const pipeline = useMemo(() => {
    const rows = (apps.data ?? [])
      .filter((a) => a.requisition_id === activeId)
      .map((a) => ({
        app: a,
        candidate: (cands.data ?? []).find((c) => c.id === a.candidate_id),
        stored: scoreMap.get(a.id),
        live: results[a.id],
      }));
    return rows.sort((x, y) => {
      const xs = x.live?.overall_score ?? x.stored?.overall_score ?? -1;
      const ys = y.live?.overall_score ?? y.stored?.overall_score ?? -1;
      return ys - xs;
    });
  }, [apps.data, cands.data, scoreMap, results, activeId]);

  const suggestedPool = useMemo(() => {
    if (!requisition) return [];
    const attached = new Set(pipeline.map((row) => row.app.candidate_id));
    return rankPool(
      (cands.data ?? []).filter((candidate) => !attached.has(candidate.id)),
      requisition,
    ).slice(0, 20);
  }, [cands.data, pipeline, requisition]);

  async function addFromTalentPool(candidateIds: string[]) {
    if (!requisition || candidateIds.length === 0) return;
    setAddingFromPool(true);
    try {
      const { error } = await supabase.from("applications").insert(
        candidateIds.map((candidateId) => ({
          requisition_id: requisition.id,
          candidate_id: candidateId,
          source: "talent_pool",
        })),
      );
      if (error) throw new Error(error.message);
      await qc.invalidateQueries({ queryKey: ["applications"] });
      toast.success(`${candidateIds.length} candidate${candidateIds.length === 1 ? "" : "s"} added to the pipeline`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add candidates");
    } finally {
      setAddingFromPool(false);
    }
  }

  async function score(applicationId: string) {
    const row = pipeline.find((p) => p.app.id === applicationId);
    if (!row?.candidate || !requisition) return;
    if (weightTotal !== 100) {
      toast.error("Weights must total 100 before scoring");
      return;
    }
    setRunning(applicationId);
    try {
      const result = await runMatch({
        data: {
          jd: {
            title: requisition.title,
            mustHave: jd?.must_have?.length ? jd.must_have : requisition.must_have_skills,
            goodToHave: jd?.good_to_have?.length ? jd.good_to_have : requisition.good_to_have_skills,
            responsibilities: jd?.responsibilities ?? requisition.responsibilities,
            education: requisition.education_requirement,
            experienceMin: requisition.experience_min,
            experienceMax: requisition.experience_max,
            jdText: jd?.full_text ?? null,
          },
          candidate: {
            name: row.candidate.full_name,
            skills: row.candidate.skills,
            experienceYears: Number(row.candidate.experience_years),
            education: row.candidate.education,
            resumeText: row.candidate.resume_text,
            linkedinUrl: row.candidate.linkedin_url,
            githubUrl: row.candidate.github_url,
            websiteUrl: row.candidate.website_url,
            xUrl: row.candidate.x_url,
          },
          weights: effWeights,
          includeSocial,
        },
      });

      setResults((prev) => ({ ...prev, [applicationId]: result }));
      setExpanded(applicationId);

      const { error } = await supabase.from("match_scores").insert({
        application_id: applicationId,
        skills_score: result.skills_score,
        experience_score: result.experience_score,
        education_score: result.education_score,
        social_score: result.social_score,
        overall_score: result.overall_score,
        weights: result.weights as never,
        matched_skills: result.matched_skills,
        missing_skills: result.missing_skills,
        rationale: result.rationale,
        risk_flags: result.risk_flags,
        recommendation: result.recommendation,
        model: result.model,
      });
      if (error) throw new Error(error.message);

      for (const s of result.social.signals) {
        await supabase.from("social_profiles").upsert(
          {
            candidate_id: row.candidate.id,
            provider: s.provider,
            profile_url: s.profile_url,
            handle: s.handle,
            score: s.score,
            signals: s.signals as never,
            rationale: s.rationale,
            status: s.status,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "candidate_id,provider" },
        );
      }

      if (result.overall_score >= 75 && row.app.stage === "applied") {
        await supabase.from("applications").update({ stage: "shortlisted" }).eq("id", applicationId);
      }

      qc.invalidateQueries({ queryKey: ["match_scores"] });
      qc.invalidateQueries({ queryKey: ["social_profiles"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      toast.success(`${row.candidate.full_name} scored ${result.overall_score}/100`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Matching failed");
    } finally {
      setRunning(null);
    }
  }

  async function importApplicants() {
    if (!board || !requisition) return;
    setImporting(true);
    try {
      const res = await runImport({
        data: { provider: board as "naukri" | "indeed" | "linkedin", requisitionId: requisition.id, limit: 10 },
      });
      toast.success(`${res.imported} of ${res.found} candidates imported from ${board}.`);
      qc.invalidateQueries({ queryKey: ["candidates"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  }

  /** Reuse a social signal we already fetched for this candidate if it is fresh. */
  function cachedSocialFor(candidateId: string) {
    const ttl = SOCIAL_TTL_DAYS * 86_400_000;
    return (socials.data ?? [])
      .filter(
        (s) =>
          s.candidate_id === candidateId &&
          s.status === "ok" &&
          Date.now() - new Date(s.fetched_at).getTime() < ttl,
      )
      .map((s) => ({
        provider: s.provider,
        profile_url: s.profile_url,
        handle: s.handle,
        score: s.score,
        signals: s.signals,
        rationale: s.rationale,
        status: s.status,
      }));
  }

  async function persistResult(applicationId: string, candidateId: string, stage: string, result: MatchResult) {
    const { error } = await supabase.from("match_scores").insert({
      application_id: applicationId,
      skills_score: result.skills_score,
      experience_score: result.experience_score,
      education_score: result.education_score,
      social_score: result.social_score,
      overall_score: result.overall_score,
      weights: result.weights as never,
      matched_skills: result.matched_skills,
      missing_skills: result.missing_skills,
      rationale: result.rationale,
      risk_flags: result.risk_flags,
      recommendation: result.recommendation,
      model: result.model,
    });
    if (error) throw new Error(error.message);

    if (!result.social.cached) {
      for (const s of result.social.signals) {
        await supabase.from("social_profiles").upsert(
          {
            candidate_id: candidateId,
            provider: s.provider,
            profile_url: s.profile_url,
            handle: s.handle,
            score: s.score,
            signals: s.signals as never,
            rationale: s.rationale,
            status: s.status,
            fetched_at: new Date().toISOString(),
          },
          { onConflict: "candidate_id,provider" },
        );
      }
    }

    if (result.overall_score >= 75 && stage === "applied") {
      await supabase.from("applications").update({ stage: "shortlisted" }).eq("id", applicationId);
    }
  }

  /** One JD vs many CVs: bounded concurrency, cached social signals, per-row error isolation. */
  async function scoreAll() {
    if (!requisition) return;
    if (weightTotal !== 100) {
      toast.error("Weights must total 100 before scoring");
      return;
    }
    const targets = pipeline.filter(
      (r) => r.candidate && (rescoreAll || (!r.live && !r.stored)),
    );
    if (!targets.length) {
      toast.info("Every applicant already has a score — switch on re-score to run them again.");
      return;
    }

    setBulk({ done: 0, total: targets.length });
    try {
      const rows = await runPipeline({
        data: {
          jd: {
            title: requisition.title,
            mustHave: jd?.must_have?.length ? jd.must_have : requisition.must_have_skills,
            goodToHave: jd?.good_to_have?.length ? jd.good_to_have : requisition.good_to_have_skills,
            responsibilities: jd?.responsibilities ?? requisition.responsibilities,
            education: requisition.education_requirement,
            experienceMin: requisition.experience_min,
            experienceMax: requisition.experience_max,
            jdText: jd?.full_text ?? null,
          },
          weights: effWeights,
          includeSocial,
          concurrency: 3,
          rows: targets.map((r) => ({
            applicationId: r.app.id,
            candidate: {
              name: r.candidate!.full_name,
              skills: r.candidate!.skills,
              experienceYears: Number(r.candidate!.experience_years),
              education: r.candidate!.education,
              resumeText: r.candidate!.resume_text,
              linkedinUrl: r.candidate!.linkedin_url,
              githubUrl: r.candidate!.github_url,
              websiteUrl: r.candidate!.website_url,
              xUrl: r.candidate!.x_url,
              cachedSocial: includeSocial ? cachedSocialFor(r.candidate!.id) : [],
            },
          })),
        },
      });

      let failures = 0;
      for (const row of rows) {
        const target = targets.find((t) => t.app.id === row.applicationId);
        if (!row.ok || !target?.candidate) {
          failures += 1;
          continue;
        }
        setResults((prev) => ({ ...prev, [row.applicationId]: row.result }));
        try {
          await persistResult(row.applicationId, target.candidate.id, target.app.stage, row.result);
        } catch {
          failures += 1;
        }
        setBulk((b) => (b ? { ...b, done: b.done + 1 } : b));
      }

      qc.invalidateQueries({ queryKey: ["match_scores"] });
      qc.invalidateQueries({ queryKey: ["social_profiles"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
      if (failures) toast.warning(`Scored ${rows.length - failures} of ${rows.length} — ${failures} failed.`);
      else toast.success(`Scored ${rows.length} candidate${rows.length === 1 ? "" : "s"} against this JD.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Pipeline run failed");
    } finally {
      setBulk(null);
    }
  }


  async function saveOverride(applicationId: string, verdict: "select" | "reject" | "hold") {
    const stored = scoreMap.get(applicationId);
    if (!stored) return;
    const { error } = await supabase
      .from("match_scores")
      .update({ recruiter_override: verdict, override_reason: overrideReason || null })
      .eq("id", stored.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    setOverrideReason("");
    toast.success("Recruiter override recorded");
    qc.invalidateQueries({ queryKey: ["match_scores"] });
  }

  return (
    <>
      <PageHeader
        eyebrow="Screening"
        title="JD ↔ CV matching engine"
        description="Every score is a weighted roll-up of semantic skill mapping, a deterministic experience band, education fit and live social profiling — with the evidence behind each number."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Switch checked={rescoreAll} onCheckedChange={setRescoreAll} />
              Re-score already scored
            </label>
            <Button onClick={scoreAll} disabled={Boolean(running) || Boolean(bulk) || pipeline.length === 0}>
              {bulk ? <Loader2 className="size-4 animate-spin" /> : <Target className="size-4" />}
              {bulk ? `Scoring ${bulk.done}/${bulk.total}` : "Score whole pipeline"}
            </Button>
          </div>
        }
      />

      <div className="grid gap-6 lg:grid-cols-4">
        <aside className="space-y-6 lg:col-span-1">
          <section className="panel p-5">
            <Label className="mb-1.5 block text-xs text-muted-foreground">Requisition</Label>
            <Select value={activeId} onValueChange={(v) => navigate({ search: { req: v } })}>
              <SelectTrigger>
                <SelectValue placeholder="Select requisition" />
              </SelectTrigger>
              <SelectContent>
                {requisitions.map((r) => (
                  <SelectItem key={r.id} value={r.id}>
                    {r.code} — {r.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {requisition ? (
              <div className="mt-4 space-y-3 text-sm">
                <div className="num text-xs text-muted-foreground">
                  {requisition.experience_min}–{requisition.experience_max} yrs · {requisition.location}
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Must-have baseline</Label>
                  <div className="mt-1.5">
                    <SkillPills
                      skills={(jd?.must_have?.length ? jd.must_have : requisition.must_have_skills).slice(0, 10)}
                      tone="match"
                    />
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {jd ? `Scoring against JD v${jd.version} (${jd.status})` : "No JD drafted — scoring against requisition inputs"}
                </p>
              </div>
            ) : null}
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Source applicants</h2>
            <p className="text-xs text-muted-foreground">
              Selecting a requisition automatically pre-matches every unattached person in the talent pool. Add the
              best fits to the pipeline, then run the full AI and social score.
            </p>
            {!requisition ? (
              <p className="mt-3 text-xs text-muted-foreground">Select a requisition first.</p>
            ) : suggestedPool.length === 0 ? (
              <p className="mt-3 text-xs text-muted-foreground">Everyone in the talent pool is already attached.</p>
            ) : (
              <div className="mt-3 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium">Talent pool suggestions</span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => addFromTalentPool(suggestedPool.slice(0, 10).map((row) => row.candidate.id))}
                    disabled={addingFromPool}
                  >
                    {addingFromPool ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                    Add top {Math.min(10, suggestedPool.length)}
                  </Button>
                </div>
                <ul className="max-h-64 divide-y divide-border overflow-y-auto rounded-md border border-border">
                  {suggestedPool.map((row) => (
                    <li key={row.candidate.id} className="flex items-center gap-2 p-2.5">
                      <ScoreChip score={row.fit} size="sm" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{row.candidate.full_name}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {row.mustHits.length}/{requisition.must_have_skills.length} skills · {row.candidate.experience_years} yrs
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Add ${row.candidate.full_name} to pipeline`}
                        onClick={() => addFromTalentPool([row.candidate.id])}
                        disabled={addingFromPool}
                      >
                        <UserPlus className="size-4" />
                      </Button>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-muted-foreground">Fit is a live skill and experience pre-rank, not the final AI score.</p>
              </div>
            )}

            <div className="mt-4 border-t border-border pt-4">
              <p className="text-xs font-medium">External job boards</p>
              {(boards.data ?? []).length === 0 ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  Optional: connect a licensed LinkedIn, Naukri or Indeed recruiter API to import external applicants.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                <Select value={board} onValueChange={setBoard}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose board" />
                  </SelectTrigger>
                  <SelectContent>
                    {(boards.data ?? []).map((b) => (
                      <SelectItem key={b.provider} value={b.provider}>
                        {b.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full"
                  onClick={importApplicants}
                  disabled={!board || importing}
                >
                  {importing ? <Loader2 className="size-4 animate-spin" /> : null} Import 10 matching CVs
                </Button>
              </div>
              )}
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Scoring weights</h2>
            <p className="text-xs text-muted-foreground">
              Move a slider or type a number — the other three rebalance so the total always stays 100.
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
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-sm">
                    <span>{label}</span>
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={effWeights[key]}
                      onChange={(e) => setWeight(key, Number(e.target.value))}
                      className="num h-8 w-16 rounded-md border border-border bg-background px-2 text-right text-sm"
                    />
                  </div>
                  <Slider
                    value={[effWeights[key]]}
                    min={0}
                    max={100}
                    step={1}
                    onValueChange={([v]) => setWeight(key, v ?? 0)}
                  />
                </div>
              ))}
              <div className="flex items-center justify-between gap-3">
                <p
                  className={
                    weightTotal === 100 ? "num text-xs text-muted-foreground" : "num text-xs text-destructive"
                  }
                >
                  Total {weightTotal} / 100
                  {weightTotal !== 100 ? " — rebalance to score" : ""}
                </p>
                <div className="flex gap-2">
                  {weightTotal !== 100 && (
                    <Button size="sm" variant="outline" onClick={() => setWeights(balanceWeights(effWeights))}>
                      Balance to 100
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setWeights(null)}>
                    Reset to requisition
                  </Button>
                </div>
              </div>


              <div className="flex items-center justify-between border-t border-border pt-4">
                <div>
                  <div className="text-sm">Live social profiling</div>
                  <p className="text-xs text-muted-foreground">Fetches GitHub, LinkedIn & writing signals</p>
                </div>
                <Switch checked={includeSocial} onCheckedChange={setIncludeSocial} />
              </div>
            </div>
          </section>
        </aside>

        <section className="space-y-4 lg:col-span-3">
          {pipeline.length === 0 ? (
            <EmptyState
              title="No applicants on this requisition"
              hint="Add candidates from the talent pool and attach them to this requisition."
            />
          ) : (
            pipeline.map(({ app, candidate, stored, live }) => {
              const result = live;
              const overall = result?.overall_score ?? stored?.overall_score;
              const isOpen = expanded === app.id;
              const social = (socials.data ?? []).filter((s) => s.candidate_id === app.candidate_id);
              return (
                <article key={app.id} className="panel overflow-hidden">
                  <div className="flex flex-wrap items-center gap-4 p-5">
                    {overall !== undefined ? (
                      <ScoreChip score={overall} size="lg" />
                    ) : (
                      <div className="num flex size-14 items-center justify-center rounded-lg border border-dashed border-border text-xs text-muted-foreground">
                        —
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold">{candidate?.full_name ?? "Unknown candidate"}</h3>
                      <p className="num text-xs text-muted-foreground">
                        {candidate?.experience_years} yrs · {candidate?.education ?? "education not captured"}
                      </p>
                      <div className="mt-2 flex items-center gap-3 text-muted-foreground">
                        {candidate?.linkedin_url ? <Linkedin className="size-4" /> : null}
                        {candidate?.github_url ? <Github className="size-4" /> : null}
                        {candidate?.website_url || candidate?.x_url ? <PenLine className="size-4" /> : null}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button variant="outline" size="sm" onClick={() => score(app.id)} disabled={running === app.id}>
                        {running === app.id ? <Loader2 className="size-4 animate-spin" /> : null}
                        {overall === undefined ? "Run match" : "Re-score"}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExpanded(isOpen ? null : app.id)}
                        disabled={!result && !stored}
                      >
                        Detail <ChevronDown className={isOpen ? "size-4 rotate-180" : "size-4"} />
                      </Button>
                    </div>
                  </div>

                  {(result || stored) && (
                    <div className="grid gap-3 border-t border-border bg-surface-2 p-5 sm:grid-cols-4">
                      <ScoreBar label="Skills" score={result?.skills_score ?? stored!.skills_score} weight={effWeights.skills} />
                      <ScoreBar
                        label="Experience"
                        score={result?.experience_score ?? stored!.experience_score}
                        weight={effWeights.experience}
                      />
                      <ScoreBar
                        label="Education"
                        score={result?.education_score ?? stored!.education_score}
                        weight={effWeights.education}
                      />
                      <ScoreBar
                        label="Social"
                        score={result?.social_score ?? stored!.social_score}
                        weight={effWeights.social}
                      />
                    </div>
                  )}

                  {isOpen && (result || stored) && (
                    <div className="space-y-6 border-t border-border p-5">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div>
                          <Label className="text-xs text-muted-foreground">Evidenced skills</Label>
                          <div className="mt-1.5">
                            <SkillPills
                              skills={result?.matched_skills ?? stored!.matched_skills}
                              tone="match"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-muted-foreground">Gaps</Label>
                          <div className="mt-1.5">
                            <SkillPills skills={result?.missing_skills ?? stored!.missing_skills} tone="miss" />
                          </div>
                        </div>
                        {result?.transferable_skills?.length ? (
                          <div className="sm:col-span-2">
                            <Label className="text-xs text-muted-foreground">Transferable / adjacent</Label>
                            <div className="mt-1.5">
                              <SkillPills skills={result.transferable_skills} />
                            </div>
                          </div>
                        ) : null}
                      </div>

                      {result?.contributions ? (
                        <div>
                          <Label className="text-xs text-muted-foreground">Weighted contribution</Label>
                          <table className="num mt-2 w-full text-sm">
                            <thead className="text-xs text-muted-foreground">
                              <tr>
                                <th className="py-1 text-left font-normal">Dimension</th>
                                <th className="py-1 text-right font-normal">Raw</th>
                                <th className="py-1 text-right font-normal">Weight</th>
                                <th className="py-1 text-right font-normal">Points</th>
                              </tr>
                            </thead>
                            <tbody>
                              {result.contributions.map((c) => (
                                <tr key={c.label} className="border-t border-border">
                                  <td className="py-1.5 text-left">{c.label}</td>
                                  <td className="py-1.5 text-right">{c.raw}</td>
                                  <td className="py-1.5 text-right text-muted-foreground">{c.weight}%</td>
                                  <td className="py-1.5 text-right font-semibold">{c.weighted}</td>
                                </tr>
                              ))}
                              <tr className="border-t border-border">
                                <td className="py-1.5 font-medium">Overall</td>
                                <td />
                                <td />
                                <td className="py-1.5 text-right font-semibold">{result.overall_score}</td>
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      ) : null}

                      <div>
                        <Label className="text-xs text-muted-foreground">Social profiling</Label>
                        <p className="mb-2 text-xs text-muted-foreground">
                          {result?.social.basis ?? "Stored from the last scoring run"}
                        </p>
                        <div className="grid gap-3 sm:grid-cols-3">
                          {(result?.social.signals ?? []).map((s) => (
                            <div key={s.provider} className="rounded-lg border border-border p-3">
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium capitalize">{s.provider}</span>
                                <span className="num text-sm font-semibold">
                                  {s.status === "ok" ? s.score : "n/a"}
                                </span>
                              </div>
                              <p className="mt-1 text-xs text-muted-foreground">{s.rationale}</p>
                              {s.status === "ok" ? (
                                <dl className="num mt-2 space-y-0.5 text-xs text-muted-foreground">
                                  {Object.entries(s.signals)
                                    .slice(0, 5)
                                    .map(([k, v]) => (
                                      <div key={k} className="flex justify-between gap-2">
                                        <dt className="truncate">{k.replace(/_/g, " ")}</dt>
                                        <dd>{typeof v === "object" ? JSON.stringify(v) : String(v)}</dd>
                                      </div>
                                    ))}
                                </dl>
                              ) : null}
                            </div>
                          ))}
                          {!result &&
                            social.map((s) => (
                              <div key={s.id} className="rounded-lg border border-border p-3">
                                <div className="flex items-center justify-between">
                                  <span className="text-sm font-medium capitalize">{s.provider}</span>
                                  <span className="num text-sm font-semibold">{s.score}</span>
                                </div>
                                <p className="mt-1 text-xs text-muted-foreground">{s.rationale}</p>
                              </div>
                            ))}
                          {!result && social.length === 0 ? (
                            <p className="text-xs text-muted-foreground">No social signals captured yet.</p>
                          ) : null}
                        </div>
                      </div>

                      <div>
                        <Label className="text-xs text-muted-foreground">Rationale</Label>
                        <p className="mt-1 text-sm">{result?.rationale ?? stored?.rationale}</p>
                      </div>

                      {(result?.risk_flags ?? stored?.risk_flags ?? []).length > 0 ? (
                        <div>
                          <Label className="text-xs text-muted-foreground">Risk flags</Label>
                          <ul className="mt-1 space-y-1 text-sm text-destructive">
                            {(result?.risk_flags ?? stored!.risk_flags).map((f) => (
                              <li key={f}>· {f}</li>
                            ))}
                          </ul>
                        </div>
                      ) : null}

                      <div className="rounded-lg border border-border p-4">
                        <div className="flex flex-wrap items-center justify-between gap-3">
                          <div>
                            <Label className="text-xs text-muted-foreground">AI recommendation</Label>
                            <p className="text-sm font-semibold capitalize">
                              {result?.recommendation ?? stored?.recommendation ?? "—"}
                            </p>
                            {stored?.recruiter_override ? (
                              <p className="text-xs text-muted-foreground">
                                Recruiter override: {stored.recruiter_override}
                                {stored.override_reason ? ` — ${stored.override_reason}` : ""}
                              </p>
                            ) : null}
                          </div>
                          <div className="flex gap-2">
                            {(["select", "hold", "reject"] as const).map((v) => (
                              <Button key={v} size="sm" variant="outline" onClick={() => saveOverride(app.id, v)}>
                                Override: {v}
                              </Button>
                            ))}
                          </div>
                        </div>
                        <Textarea
                          className="mt-3"
                          rows={2}
                          placeholder="Reason for override (kept on the audit trail)"
                          value={overrideReason}
                          onChange={(e) => setOverrideReason(e.target.value)}
                        />
                      </div>
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>
      </div>
    </>
  );
}
