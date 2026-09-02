import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Github, Linkedin, Sparkles, Upload } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { applicationsQuery, candidatesQuery, latestScores, matchScoresQuery, requisitionsQuery } from "@/lib/data";
import { parseResume } from "@/lib/matching.functions";
import { intakeCvs, type IntakeStatus } from "@/lib/cv-intake";

import { EmptyState, PageHeader, ScoreChip, SkillPills } from "@/components/ats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export const Route = createFileRoute("/candidates/")({
  head: () => ({
    meta: [
      { title: "Talent Pool — AI Resume Parsing & Social Signals" },
      {
        name: "description",
        content:
          "Central candidate database with AI resume parsing, LinkedIn and GitHub links, skills tags and live match scores.",
      },
      { property: "og:title", content: "Talent Pool — AI Resume Parsing & Social Signals" },
      {
        property: "og:description",
        content: "Search the candidate database by skill, source and match score across every open requisition.",
      },
    ],
  }),
  component: Candidates,
});

function Candidates() {
  const qc = useQueryClient();
  const cands = useQuery(candidatesQuery);
  const apps = useQuery(applicationsQuery);
  const reqs = useQuery(requisitionsQuery);
  const scores = useQuery(matchScoresQuery);
  const parse = useServerFn(parseResume);

  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resume, setResume] = useState("");
  const [reqId, setReqId] = useState("");
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkReqId, setBulkReqId] = useState("");
  const [bulkSource, setBulkSource] = useState("direct");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkLog, setBulkLog] = useState<IntakeStatus[]>([]);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    location: "",
    experience_years: "0",
    education: "",
    skills: "",
    linkedin_url: "",
    github_url: "",
    website_url: "",
    x_url: "",
    source: "direct",
  });

  /** Bulk CV intake: read each file locally, AI-parse it, then upsert the candidate. */
  async function bulkUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    const list = Array.from(files);
    setBulkBusy(true);
    setBulkLog(list.map((f) => ({ file: f.name, state: "pending" as const, message: "Queued" })));
    try {
      const summary = await intakeCvs({
        files: list,
        parse,
        source: bulkSource,
        requisitionId: bulkReqId || null,
        onUpdate: (i, patch) =>
          setBulkLog((l) => l.map((row, idx) => (idx === i ? { ...row, ...patch } : row))),
      });
      await qc.invalidateQueries({ queryKey: ["candidates"] });
      await qc.invalidateQueries({ queryKey: ["applications"] });
      if (summary.failed === 0) toast.success(`${summary.ok} CV${summary.ok === 1 ? "" : "s"} added to the talent pool`);
      else toast.warning(`${summary.ok} parsed · ${summary.failed} failed — see the list`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Bulk upload failed");
    } finally {
      setBulkBusy(false);
    }
  }



  const scoreMap = latestScores(scores.data ?? []);
  const bestScore = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of apps.data ?? []) {
      const s = scoreMap.get(a.id);
      if (s) m.set(a.candidate_id, Math.max(m.get(a.candidate_id) ?? 0, s.overall_score));
    }
    return m;
  }, [apps.data, scoreMap]);

  const filtered = (cands.data ?? []).filter((c) => {
    const t = q.toLowerCase().trim();
    if (!t) return true;
    return (
      c.full_name.toLowerCase().includes(t) ||
      (c.location ?? "").toLowerCase().includes(t) ||
      c.skills.some((s) => s.toLowerCase().includes(t))
    );
  });

  async function autofill() {
    if (resume.trim().length < 20) {
      toast.error("Paste the resume text first");
      return;
    }
    setBusy(true);
    try {
      const p = await parse({ data: { resumeText: resume } });
      setForm({
        full_name: p.full_name ?? "",
        email: p.email ?? "",
        location: p.location ?? "",
        experience_years: String(p.experience_years ?? 0),
        education: p.education ?? "",
        skills: (p.skills ?? []).join(", "),
        linkedin_url: p.linkedin_url ?? "",
        github_url: p.github_url ?? "",
        website_url: p.website_url ?? "",
        x_url: "",
        source: "direct",
      });
      toast.success("Resume parsed — review the extracted fields");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Parsing failed");
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!form.full_name.trim() || !form.email.trim()) {
      toast.error("Name and email are required");
      return;
    }
    setBusy(true);
    const { data, error } = await supabase
      .from("candidates")
      .insert({
        full_name: form.full_name,
        email: form.email,
        location: form.location || null,
        experience_years: Number(form.experience_years) || 0,
        education: form.education || null,
        skills: form.skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        linkedin_url: form.linkedin_url || null,
        github_url: form.github_url || null,
        website_url: form.website_url || null,
        x_url: form.x_url || null,
        source: form.source,
        resume_text: resume || null,
      })
      .select("id")
      .single();

    if (error || !data) {
      setBusy(false);
      toast.error(error?.message ?? "Could not save candidate");
      return;
    }
    if (reqId) {
      await supabase
        .from("applications")
        .insert({ requisition_id: reqId, candidate_id: data.id, source: form.source });
    }
    setBusy(false);
    setOpen(false);
    setResume("");
    toast.success("Candidate added to the talent pool");
    qc.invalidateQueries({ queryKey: ["candidates"] });
    qc.invalidateQueries({ queryKey: ["applications"] });
  }

  return (
    <>
      <PageHeader
        eyebrow="Candidate database"
        title="Talent pool"
        description="One searchable pool across job boards, referrals and direct applications — with the social handles that feed the social profiling score."
        actions={
          <div className="flex items-center gap-2">
          <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <Upload className="size-4" /> Bulk upload CVs
              </Button>
            </DialogTrigger>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Bulk upload CVs</DialogTitle>
                <DialogDescription>
                  Drop in up to a few dozen PDF, DOCX or TXT resumes — each one is read, AI-parsed and added to the
                  talent pool automatically. No typing.
                </DialogDescription>
              </DialogHeader>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Source</Label>
                  <Select value={bulkSource} onValueChange={setBulkSource}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["direct", "naukri", "linkedin", "referral", "consultant", "campus", "ijp"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Apply all to requisition</Label>
                  <Select value={bulkReqId} onValueChange={setBulkReqId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      {(reqs.data ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.code} — {r.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div>
                <Label className="mb-1.5 block text-xs text-muted-foreground">Resume files</Label>
                <Input
                  type="file"
                  multiple
                  disabled={bulkBusy}
                  accept=".pdf,.docx,.txt,.md"
                  onChange={(e) => {
                    bulkUpload(e.target.files);
                    e.target.value = "";
                  }}
                />
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Text-based PDF, DOCX, TXT or MD. Scanned/image-only PDFs cannot be read — export a text PDF.
                </p>
              </div>

              {bulkLog.length > 0 && (
                <>
                  <p className="num text-xs text-muted-foreground">
                    {bulkLog.filter((l) => l.state === "ok").length} parsed ·{" "}
                    {bulkLog.filter((l) => l.state === "error").length} failed · {bulkLog.length} total
                  </p>
                  <ul className="max-h-56 space-y-1 overflow-y-auto text-xs">
                    {bulkLog.map((l, i) => (
                      <li
                        key={i}
                        className={
                          l.state === "error"
                            ? "text-destructive"
                            : l.state === "ok"
                              ? "text-muted-foreground"
                              : "text-foreground"
                        }
                      >
                        <span className="font-medium">{l.file}</span> — {l.message}
                      </li>
                    ))}
                  </ul>
                </>
              )}


              <DialogFooter>
                <Button variant="outline" onClick={() => setBulkOpen(false)}>
                  Done
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button>Add candidate</Button>
            </DialogTrigger>

            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
              <DialogHeader>
                <DialogTitle>Add candidate</DialogTitle>
                <DialogDescription>
                  Paste a resume and let AI extract the structured fields, then attach the candidate to a requisition.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-2">
                <Label className="text-xs text-muted-foreground">Resume text</Label>
                <Textarea rows={6} value={resume} onChange={(e) => setResume(e.target.value)} />
                <Button variant="outline" size="sm" onClick={autofill} disabled={busy}>
                  <Sparkles className="size-4" /> Parse with AI
                </Button>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {(
                  [
                    ["full_name", "Full name"],
                    ["email", "Email"],
                    ["location", "Location"],
                    ["experience_years", "Experience (yrs)"],
                    ["education", "Education"],
                    ["skills", "Skills (comma separated)"],
                    ["linkedin_url", "LinkedIn URL"],
                    ["github_url", "GitHub URL"],
                    ["website_url", "Portfolio / blog URL"],
                    ["x_url", "X profile URL"],
                  ] as const
                ).map(([key, label]) => (
                  <div key={key} className={key === "skills" ? "sm:col-span-2" : undefined}>
                    <Label className="mb-1.5 block text-xs text-muted-foreground">{label}</Label>
                    <Input
                      value={form[key]}
                      onChange={(e) => setForm({ ...form, [key]: e.target.value })}
                    />
                  </div>
                ))}
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Source</Label>
                  <Select value={form.source} onValueChange={(v) => setForm({ ...form, source: v })}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {["direct", "naukri", "linkedin", "referral", "consultant", "campus"].map((s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs text-muted-foreground">Apply to requisition</Label>
                  <Select value={reqId} onValueChange={setReqId}>
                    <SelectTrigger>
                      <SelectValue placeholder="Optional" />
                    </SelectTrigger>
                    <SelectContent>
                      {(reqs.data ?? []).map((r) => (
                        <SelectItem key={r.id} value={r.id}>
                          {r.code} — {r.title}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={save} disabled={busy}>
                  {busy ? "Saving…" : "Save candidate"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          </div>

        }
      />

      <Input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search by name, skill or location…"
        className="max-w-md"
      />

      {filtered.length === 0 ? (
        <EmptyState title="No candidates found" hint="Add a candidate or clear the search." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((c) => (
            <Link
              key={c.id}
              to="/candidates/$id"
              params={{ id: c.id }}
              className="panel block p-5 transition-colors hover:border-ring"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{c.full_name}</h3>
                  <p className="num text-xs text-muted-foreground">
                    {c.experience_years} yrs · {c.location ?? "—"} · {c.source}
                  </p>
                </div>
                {bestScore.has(c.id) ? <ScoreChip score={bestScore.get(c.id)!} size="sm" /> : null}
              </div>
              <p className="mt-2 truncate text-xs text-muted-foreground">{c.education ?? "Education not captured"}</p>
              <div className="mt-3">
                <SkillPills skills={c.skills.slice(0, 5)} />
              </div>
              <div className="mt-3 flex gap-3 text-muted-foreground">
                {c.linkedin_url ? <Linkedin className="size-4" /> : null}
                {c.github_url ? <Github className="size-4" /> : null}
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  );
}
