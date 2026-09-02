import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ArrowLeft, ExternalLink, Sparkles } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  aiInterviewsQuery,
  applicationsQuery,
  candidateQuery,
  evaluationsQuery,
  jdQuery,
  latestScores,
  matchScoresQuery,
  requisitionsQuery,
  socialProfilesQuery,
} from "@/lib/data";
import { runAiScreening } from "@/lib/matching.functions";
import { normalizeExternalUrl } from "@/lib/external-links";
import { EmptyState, PageHeader, ScoreBar, ScoreChip, SkillPills, StageBadge } from "@/components/ats";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/candidates/$id")({
  head: () => ({
    meta: [
      { title: "Candidate profile — match, social score & interviews" },
      {
        name: "description",
        content:
          "Full candidate view: parsed resume, skills, social profiling breakdown, JD match scores per requisition and interview evaluations.",
      },
      { property: "og:title", content: "Candidate profile — match, social score & interviews" },
      {
        property: "og:description",
        content: "Evidence-backed match detail, AI screening results and L1–L3 evaluation history for one candidate.",
      },
    ],
  }),
  component: CandidateDetail,
});

function CandidateDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const cand = useQuery(candidateQuery(id));
  const apps = useQuery(applicationsQuery);
  const reqs = useQuery(requisitionsQuery);
  const scores = useQuery(matchScoresQuery);
  const socials = useQuery(socialProfilesQuery);
  const evals = useQuery(evaluationsQuery);
  const aiRuns = useQuery(aiInterviewsQuery);
  const screen = useServerFn(runAiScreening);
  const [busy, setBusy] = useState<string | null>(null);

  const c = cand.data;
  const myApps = (apps.data ?? []).filter((a) => a.candidate_id === id);
  const firstReqId = myApps[0]?.requisition_id ?? "";
  const jds = useQuery({ ...jdQuery(firstReqId), enabled: Boolean(firstReqId) });
  const scoreMap = latestScores(scores.data ?? []);
  const social = (socials.data ?? []).filter((s) => s.candidate_id === id);

  if (cand.isLoading) return <p className="text-sm text-muted-foreground">Loading candidate…</p>;
  if (!c) return <EmptyState title="Candidate not found" />;

  async function aiScreen(applicationId: string, requisitionId: string) {
    const req = (reqs.data ?? []).find((r) => r.id === requisitionId);
    if (!req) return;
    setBusy(applicationId);
    try {
      const jdText =
        (jds.data ?? [])[0]?.full_text ??
        `${req.title}. Must have: ${req.must_have_skills.join(", ")}. Responsibilities: ${req.responsibilities ?? "—"}`;
      const out = await screen({
        data: {
          jobTitle: req.title,
          jdText,
          candidateName: c!.full_name,
          resumeText: c!.resume_text,
          matchRationale: scoreMap.get(applicationId)?.rationale ?? null,
        },
      });
      const { error } = await supabase.from("ai_interviews").insert({
        application_id: applicationId,
        jd_match_score: out.jd_match_score,
        skillset_score: out.skillset_score,
        culture_role_score: out.culture_role_score,
        culture_org_score: out.culture_org_score,
        transcript: out.transcript as never,
        summary: out.summary,
      });
      if (error) throw new Error(error.message);
      await supabase.from("applications").update({ stage: "ai_screened" }).eq("id", applicationId);
      toast.success("AI screening interview completed");
      qc.invalidateQueries({ queryKey: ["ai_interviews"] });
      qc.invalidateQueries({ queryKey: ["applications"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI screening failed");
    } finally {
      setBusy(null);
    }
  }

  const links = [
    ["LinkedIn", normalizeExternalUrl(c.linkedin_url)],
    ["GitHub", normalizeExternalUrl(c.github_url)],
    ["Portfolio", normalizeExternalUrl(c.website_url)],
    ["X", normalizeExternalUrl(c.x_url)],
  ] as const;

  return (
    <>
      <Link
        to="/candidates"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Talent pool
      </Link>

      <PageHeader
        eyebrow={`${c.source} · ${c.experience_years} yrs experience`}
        title={c.full_name}
        description={`${c.email}${c.location ? ` · ${c.location}` : ""}${c.education ? ` · ${c.education}` : ""}`}
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <section className="panel p-5">
            <h2 className="font-semibold">Applications & match scores</h2>
            {myApps.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">Not attached to any requisition yet.</p>
            ) : (
              <ul className="mt-4 space-y-4">
                {myApps.map((a) => {
                  const req = (reqs.data ?? []).find((r) => r.id === a.requisition_id);
                  const s = scoreMap.get(a.id);
                  const ai = (aiRuns.data ?? []).find((x) => x.application_id === a.id);
                  return (
                    <li key={a.id} className="rounded-lg border border-border p-4">
                      <div className="flex flex-wrap items-center gap-3">
                        {s ? <ScoreChip score={s.overall_score} /> : null}
                        <div className="min-w-0 flex-1">
                          <Link
                            to="/requisitions/$id"
                            params={{ id: a.requisition_id }}
                            className="font-medium hover:underline"
                          >
                            {req?.title}
                          </Link>
                          <div className="num text-xs text-muted-foreground">{req?.code}</div>
                        </div>
                        <StageBadge stage={a.stage} />
                      </div>

                      {s ? (
                        <>
                          <div className="mt-4 grid gap-3 sm:grid-cols-4">
                            <ScoreBar label="Skills" score={s.skills_score} />
                            <ScoreBar label="Experience" score={s.experience_score} />
                            <ScoreBar label="Education" score={s.education_score} />
                            <ScoreBar label="Social" score={s.social_score} />
                          </div>
                          <p className="mt-3 text-sm">{s.rationale}</p>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            <div>
                              <Label className="text-xs text-muted-foreground">Evidenced</Label>
                              <div className="mt-1.5">
                                <SkillPills skills={s.matched_skills} tone="match" />
                              </div>
                            </div>
                            <div>
                              <Label className="text-xs text-muted-foreground">Gaps</Label>
                              <div className="mt-1.5">
                                <SkillPills skills={s.missing_skills} tone="miss" />
                              </div>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="mt-3 text-sm text-muted-foreground">
                          Not scored yet —{" "}
                          <Link to="/matching" search={{ req: a.requisition_id }} className="underline">
                            run the matching engine
                          </Link>
                          .
                        </p>
                      )}

                      <div className="mt-4 flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => aiScreen(a.id, a.requisition_id)}
                          disabled={busy === a.id}
                        >
                          <Sparkles className="size-4" /> {ai ? "Re-run AI screening" : "Run AI screening"}
                        </Button>
                      </div>

                      {ai ? (
                        <div className="mt-4 rounded-lg bg-surface-2 p-4">
                          <div className="num grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                            <Metric label="JD match" value={ai.jd_match_score} />
                            <Metric label="Skillset" value={ai.skillset_score} />
                            <Metric label="Culture — role" value={ai.culture_role_score} />
                            <Metric label="Culture — org" value={ai.culture_org_score} />
                          </div>
                          <p className="mt-3 text-sm">{ai.summary}</p>
                          <ol className="mt-3 space-y-2 text-xs text-muted-foreground">
                            {(Array.isArray(ai.transcript)
                              ? (ai.transcript as unknown as { question: string; expected_signal: string }[])
                              : []
                            ).map((t, i) => (
                              <li key={i}>
                                <span className="text-foreground">{t.question}</span> — {t.expected_signal}
                              </li>
                            ))}
                          </ol>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Interview evaluations</h2>
            {(evals.data ?? []).filter((e) => myApps.some((a) => a.id === e.application_id)).length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">No L1–L3 evaluations recorded yet.</p>
            ) : (
              <ul className="mt-3 space-y-3 text-sm">
                {(evals.data ?? [])
                  .filter((e) => myApps.some((a) => a.id === e.application_id))
                  .map((e) => (
                    <li key={e.id} className="rounded-lg border border-border p-3">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          L{e.level} · {e.focus_area ?? "General"}
                        </span>
                        <span className="num">{e.rating ?? "—"}/5</span>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {e.evaluator ?? "Unnamed"} · {e.recommendation}
                      </p>
                      {e.comments ? <p className="mt-1 text-xs">{e.comments}</p> : null}
                    </li>
                  ))}
              </ul>
            )}
          </section>
        </div>

        <div className="space-y-6">
          <section className="panel p-5">
            <h2 className="font-semibold">Social profiling</h2>
            <p className="text-xs text-muted-foreground">Fetched live during scoring; 15% of the default weight.</p>
            <div className="mt-4 space-y-3">
              {social.length === 0 ? (
                <p className="text-sm text-muted-foreground">No signals captured yet.</p>
              ) : (
                social.map((s) => (
                  <div key={s.id} className="rounded-lg border border-border p-3">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium capitalize">{s.provider}</span>
                      <span className="num text-sm font-semibold">{s.status === "ok" ? s.score : "n/a"}</span>
                    </div>
                    {s.handle ? <p className="num text-xs text-muted-foreground">@{s.handle}</p> : null}
                    <p className="mt-1 text-xs text-muted-foreground">{s.rationale}</p>
                  </div>
                ))
              )}
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Profile links</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {links.map(([label, url]) =>
                url ? (
                  <li key={label}>
                    <a
                      href={url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="inline-flex items-center gap-1.5 hover:underline"
                    >
                      {label} <ExternalLink className="size-3.5" />
                    </a>
                  </li>
                ) : null,
              )}
              {links.every(([, u]) => !u) ? (
                <li className="text-muted-foreground">No public profiles on file.</li>
              ) : null}
            </ul>
          </section>

          <section className="panel p-5">
            <h2 className="font-semibold">Skills</h2>
            <div className="mt-3">
              <SkillPills skills={c.skills} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-lg font-semibold">{value}</div>
    </div>
  );
}
