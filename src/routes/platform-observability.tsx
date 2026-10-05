import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Activity, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";

import {
  obsAiTraceDetail,
  obsAiTraces,
  obsEmails,
  obsJobs,
  obsLogs,
  obsOverview,
  type ObsLogRow,
  type ObsTraceRow,
} from "@/lib/observability.functions";
import { usePlatform } from "@/hooks/usePlatform";
import { EmptyState, PageHeader, StatCard } from "@/components/ats";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export const Route = createFileRoute("/platform-observability")({
  head: () => ({
    meta: [
      { title: "Platform console — Observability" },
      {
        name: "description",
        content:
          "Super-user view of application logs, AI traces with full prompts and responses, email delivery, background jobs and client-side errors.",
      },
    ],
  }),
  component: Observability,
});

const PAGE_SIZE = 50;
const HOUR_FILTERS = [
  { hours: 1, label: "Last hour" },
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
  { hours: 720, label: "Last 30 days" },
] as const;

function when(iso: string | null | undefined): string {
  return iso ? new Date(iso).toLocaleString() : "—";
}

function levelTone(level: string) {
  if (level === "error") return "destructive" as const;
  if (level === "warn") return "default" as const;
  return "secondary" as const;
}

function statusTone(status: string) {
  if (status === "sent" || status === "ok" || status === "ready") return "default" as const;
  if (status === "failed" || status === "error") return "destructive" as const;
  if (status === "queued" || status === "running" || status === "pending")
    return "outline" as const;
  return "secondary" as const;
}

function Toolbar({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap items-center gap-2">{children}</div>;
}

function Pager({
  page,
  setPage,
  total,
  limit,
}: {
  page: number;
  setPage: (n: number) => void;
  total: number;
  limit: number;
}) {
  const pages = Math.max(1, Math.ceil(total / limit));
  return (
    <div className="flex items-center justify-between pt-3 text-xs text-muted-foreground">
      <span>
        {total === 0 ? "0" : `${page * limit + 1}–${Math.min((page + 1) * limit, total)}`} of{" "}
        {total}
      </span>
      <span className="flex gap-1.5">
        <Button variant="outline" size="sm" disabled={page === 0} onClick={() => setPage(page - 1)}>
          <ChevronLeft className="size-3.5" /> Prev
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= pages}
          onClick={() => setPage(page + 1)}
        >
          Next <ChevronRight className="size-3.5" />
        </Button>
      </span>
    </div>
  );
}

function SelectFilter<T extends string>({
  value,
  onChange,
  options,
  placeholder,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  placeholder: string;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as T)}>
      <SelectTrigger className="h-8 w-[170px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ overview */

function Overview() {
  const fetchOverview = useServerFn(obsOverview);
  const overview = useQuery({
    queryKey: ["obs_overview"],
    queryFn: () => fetchOverview({ data: { hours: 24 } }),
    refetchInterval: 15_000,
  });
  if (overview.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (!overview.data)
    return (
      <EmptyState title="Nothing observed yet." hint="Data appears as the app serves traffic." />
    );
  const d = overview.data;
  const aiErrorPct = d.ai.calls ? Math.round((d.ai.errors / d.ai.calls) * 100) : 0;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Errors (24h)"
          value={d.logs.errors}
          hint={`${d.logs.warns} warnings · ${d.logs.total} log rows`}
          tone={d.logs.errors > 0 ? "destructive" : "success"}
        />
        <StatCard
          label="AI calls (24h)"
          value={d.ai.calls}
          hint={`${d.ai.errors} errors (${aiErrorPct}%) · ${d.ai.totalTokens.toLocaleString()} tokens`}
          tone={d.ai.errors > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Email (24h)"
          value={d.logs.emailErrors}
          hint={`${d.logs.emailOk} sent OK · ${d.jobs.mail.queued} queued · ${d.jobs.mail.failed} failed in outbox`}
          tone={d.logs.emailErrors + d.jobs.mail.failed > 0 ? "destructive" : "success"}
        />
        <StatCard
          label="Client errors (24h)"
          value={d.logs.clientErrors}
          hint="Browser-side uncaught errors"
          tone={d.logs.clientErrors > 0 ? "warning" : "success"}
        />
      </div>

      <section className="panel p-4">
        <h2 className="text-sm font-semibold">Latest errors &amp; warnings</h2>
        {d.latestErrors.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No errors logged recently.</p>
        ) : (
          <table className="num mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Level</th>
                <th className="py-1 pr-3 font-medium">Source</th>
                <th className="py-1 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {d.latestErrors.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.createdAt)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={levelTone(r.level)}>{r.level}</Badge>
                  </td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{r.source}</td>
                  <td className="py-1.5 break-all">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <JobHealth jobs={d.jobs} />
    </div>
  );
}

type JobHealthProps = {
  jobs: {
    prep: { pending: number; running: number; failed: number };
    mail: { queued: number; failed: number };
    syncs: {
      kind: string;
      name: string;
      orgName: string;
      lastRunAt: string | null;
      lastRunStatus: string | null;
      lastError: string | null;
    }[];
  };
};

function JobHealth({ jobs }: JobHealthProps) {
  return (
    <section className="panel p-4">
      <h2 className="text-sm font-semibold">Background jobs &amp; syncs</h2>
      <p className="mt-0.5 text-xs text-muted-foreground">
        Screening prep: {jobs.prep.pending} pending · {jobs.prep.running} running ·{" "}
        {jobs.prep.failed} failed
      </p>
      {jobs.syncs.length === 0 ? (
        <p className="pt-2 text-sm text-muted-foreground">
          No board/HRMS connections configured yet.
        </p>
      ) : (
        <table className="num mt-2 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Org</th>
              <th className="py-1 pr-3 font-medium">Kind</th>
              <th className="py-1 pr-3 font-medium">Connection</th>
              <th className="py-1 pr-3 font-medium">Last run</th>
              <th className="py-1 font-medium">Status / error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.syncs.map((s, i) => (
              <tr key={`${s.kind}-${s.name}-${i}`} className="border-t border-border/60 align-top">
                <td className="py-1.5 pr-3">{s.orgName}</td>
                <td className="py-1.5 pr-3 text-muted-foreground">{s.kind}</td>
                <td className="py-1.5 pr-3">{s.name}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                  {when(s.lastRunAt)}
                </td>
                <td className="py-1.5">
                  {s.lastRunStatus ? (
                    <Badge variant={statusTone(s.lastRunStatus)}>{s.lastRunStatus}</Badge>
                  ) : (
                    "—"
                  )}
                  {s.lastError ? (
                    <span className="ml-2 text-destructive">{s.lastError}</span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

/* ---------------------------------------------------------------------- logs */

function Logs() {
  const fetchLogs = useServerFn(obsLogs);
  const [hours, setHours] = useState<string>("24");
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState("all");
  const [q, setQ] = useState("");
  const [live, setLive] = useState(false);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const input = useMemo(
    () => ({
      hours: Number(hours),
      level,
      source,
      q: q.trim() || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [hours, level, source, q, page],
  );
  const logs = useQuery({
    queryKey: ["obs_logs", input],
    queryFn: () => fetchLogs({ data: input }),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 5_000 : false,
  });

  const rows = logs.data?.rows ?? [];
  return (
    <div className="space-y-3">
      <Toolbar>
        <SelectFilter
          value={hours}
          onChange={(v) => {
            setHours(v);
            setPage(0);
          }}
          options={HOUR_FILTERS.map((h) => ({ value: String(h.hours), label: h.label }))}
          placeholder="Range"
        />
        <SelectFilter
          value={level}
          onChange={(v) => {
            setLevel(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All levels" },
            { value: "error", label: "Error" },
            { value: "warn", label: "Warning" },
            { value: "info", label: "Info" },
          ]}
          placeholder="Level"
        />
        <SelectFilter
          value={source}
          onChange={(v) => {
            setSource(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All sources" },
            { value: "server-fn", label: "Server fns" },
            { value: "http", label: "API routes" },
            { value: "email", label: "Email" },
            { value: "ai", label: "AI" },
            { value: "client", label: "Browser" },
            { value: "app", label: "App" },
          ]}
          placeholder="Source"
        />
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPage(0);
          }}
          placeholder="Search message…"
          className="h-8 w-56 rounded-md border border-border bg-background px-2.5 text-sm"
        />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={live} onCheckedChange={setLive} /> Live
        </label>
      </Toolbar>

      {logs.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState title="No log rows match." hint="Widen the range or clear the filters." />
      ) : (
        <section className="panel p-4">
          <table className="num w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Level</th>
                <th className="py-1 pr-3 font-medium">Source</th>
                <th className="py-1 pr-3 font-medium">Message</th>
                <th className="py-1 font-medium">Took</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <LogRow
                  key={r.id}
                  row={r}
                  expanded={expanded === r.id}
                  onToggle={() => setExpanded(expanded === r.id ? null : r.id)}
                />
              ))}
            </tbody>
          </table>
          <Pager page={page} setPage={setPage} total={logs.data?.total ?? 0} limit={PAGE_SIZE} />
        </section>
      )}
    </div>
  );
}

function LogRow({
  row,
  expanded,
  onToggle,
}: {
  row: ObsLogRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr
        className="cursor-pointer border-t border-border/60 align-top hover:bg-muted/40"
        onClick={onToggle}
      >
        <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
          {when(row.createdAt)}
        </td>
        <td className="py-1.5 pr-3">
          <Badge variant={levelTone(row.level)}>{row.level}</Badge>
        </td>
        <td className="py-1.5 pr-3 text-muted-foreground">{row.source}</td>
        <td className="py-1.5 break-all">
          {row.message}
          {row.route ? <span className="ml-2 text-muted-foreground">{row.route}</span> : null}
          {expanded && row.detail ? (
            <pre className="mt-2 max-h-72 overflow-auto rounded-md bg-muted/60 p-2.5 text-xs whitespace-pre-wrap">
              {row.detail}
            </pre>
          ) : null}
        </td>
        <td className="py-1.5 text-right text-muted-foreground">
          {row.durationMs != null ? `${row.durationMs} ms` : ""}
          {row.statusCode != null ? ` · ${row.statusCode}` : ""}
        </td>
      </tr>
    </>
  );
}

/* ----------------------------------------------------------------- ai traces */

function AiTraces() {
  const fetchTraces = useServerFn(obsAiTraces);
  const fetchDetail = useServerFn(obsAiTraceDetail);
  const [hours, setHours] = useState("168");
  const [outcome, setOutcome] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const input = useMemo(
    () => ({ hours: Number(hours), outcome, limit: PAGE_SIZE, offset: page * PAGE_SIZE }),
    [hours, outcome, page],
  );
  const traces = useQuery({
    queryKey: ["obs_traces", input],
    queryFn: () => fetchTraces({ data: input }),
    placeholderData: keepPreviousData,
  });
  const detail = useQuery({
    queryKey: ["obs_trace", openId],
    queryFn: () => fetchDetail({ data: { id: openId! } }),
    enabled: !!openId,
  });

  const rows: ObsTraceRow[] = traces.data?.rows ?? [];
  return (
    <div className="space-y-3">
      <Toolbar>
        <SelectFilter
          value={hours}
          onChange={(v) => {
            setHours(v);
            setPage(0);
          }}
          options={HOUR_FILTERS.map((h) => ({ value: String(h.hours), label: h.label }))}
          placeholder="Range"
        />
        <SelectFilter
          value={outcome}
          onChange={(v) => {
            setOutcome(v);
            setPage(0);
          }}
          options={[
            { value: "all", label: "All outcomes" },
            { value: "ok", label: "OK" },
            { value: "error", label: "Errors" },
          ]}
          placeholder="Outcome"
        />
      </Toolbar>

      {traces.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No AI calls in this range yet."
          hint="Every gateway invocation (aiJson / aiResearchJson) is captured here with its full prompt and response."
        />
      ) : (
        <section className="panel p-4">
          <table className="num w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Feature</th>
                <th className="py-1 pr-3 font-medium">Org</th>
                <th className="py-1 pr-3 font-medium">Outcome</th>
                <th className="py-1 pr-3 font-medium">Tries</th>
                <th className="py-1 pr-3 font-medium">Took</th>
                <th className="py-1 font-medium">Tokens</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.id}
                  className="cursor-pointer border-t border-border/60 align-top hover:bg-muted/40"
                  onClick={() => setOpenId(r.id)}
                >
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.createdAt)}
                  </td>
                  <td className="py-1.5 pr-3 font-medium">{r.feature}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">{r.orgName ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={r.ok ? "default" : "destructive"}>
                      {r.ok ? (r.schemaValid === false ? "schema fail" : "ok") : "error"}
                    </Badge>
                    {r.errorMessage ? (
                      <span className="ml-2 line-clamp-1 max-w-72 text-destructive">
                        {r.errorMessage}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-1.5 pr-3">{r.attempts}</td>
                  <td className="py-1.5 pr-3 text-muted-foreground">
                    {r.durationMs != null ? `${r.durationMs} ms` : "—"}
                  </td>
                  <td className="py-1.5">{r.totalTokens.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pager page={page} setPage={setPage} total={traces.data?.total ?? 0} limit={PAGE_SIZE} />
        </section>
      )}

      <Dialog open={!!openId} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-h-[85vh] max-w-3xl overflow-auto">
          <DialogHeader>
            <DialogTitle>AI trace</DialogTitle>
            <DialogDescription>
              Full prompt and response capture — super-user only, purged after 14 days.
            </DialogDescription>
          </DialogHeader>
          {detail.isLoading || !detail.data ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <TraceBody trace={detail.data} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function TraceBody({
  trace,
}: {
  trace: NonNullable<Awaited<ReturnType<typeof obsAiTraceDetail>>>;
}) {
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
        <Badge variant={trace.ok ? "default" : "destructive"}>{trace.ok ? "ok" : "error"}</Badge>
        <span>feature: {trace.feature}</span>
        <span>· attempts: {trace.attempts}</span>
        {trace.durationMs != null ? <span>· {trace.durationMs} ms</span> : null}
        {trace.grounded != null ? <span>· grounded: {String(trace.grounded)}</span> : null}
        {trace.schemaValid != null ? <span>· schema: {String(trace.schemaValid)}</span> : null}
      </div>
      {trace.frames.length > 0 ? (
        <section className="panel p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Provider attempts
          </h3>
          <table className="num mt-1 w-full text-xs">
            <thead>
              <tr className="text-left text-muted-foreground">
                <th className="py-0.5 pr-2 font-medium">#</th>
                <th className="py-0.5 pr-2 font-medium">Provider · model</th>
                <th className="py-0.5 pr-2 font-medium">Status</th>
                <th className="py-0.5 pr-2 font-medium">Took</th>
                <th className="py-0.5 pr-2 font-medium">Tokens (p/c)</th>
                <th className="py-0.5 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {trace.frames.map((f) => (
                <tr key={f.attempt} className="border-t border-border/60">
                  <td className="py-1 pr-2">{f.attempt}</td>
                  <td className="py-1 pr-2">
                    {f.provider} · {f.model}
                  </td>
                  <td className="py-1 pr-2">{f.status}</td>
                  <td className="py-1 pr-2">{f.durationMs != null ? `${f.durationMs} ms` : "—"}</td>
                  <td className="py-1 pr-2">
                    {f.promptTokens}/{f.completionTokens}
                  </td>
                  <td className="py-1 break-all text-destructive">{f.errorMessage ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ) : null}
      {trace.errorMessage ? <p className="text-destructive">{trace.errorMessage}</p> : null}
      {trace.prompt ? (
        <section className="panel p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Prompt
          </h3>
          <pre className="mt-1 max-h-96 overflow-auto text-xs whitespace-pre-wrap">
            {trace.prompt}
          </pre>
        </section>
      ) : null}
      {trace.response ? (
        <section className="panel p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Response
          </h3>
          <pre className="mt-1 max-h-96 overflow-auto text-xs whitespace-pre-wrap">
            {trace.response}
          </pre>
        </section>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------------- emails */

function Emails() {
  const fetchEmails = useServerFn(obsEmails);
  const [status, setStatus] = useState("all");
  const emails = useQuery({
    queryKey: ["obs_emails", status],
    queryFn: () => fetchEmails({ data: { status } }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  if (emails.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const outbox = emails.data?.outbox ?? [];
  const sends = emails.data?.sends ?? [];
  return (
    <div className="space-y-4">
      <Toolbar>
        <SelectFilter
          value={status}
          onChange={setStatus}
          options={[
            { value: "all", label: "All outbox statuses" },
            { value: "queued", label: "Queued" },
            { value: "sent", label: "Sent" },
            { value: "failed", label: "Failed" },
            { value: "suppressed", label: "Suppressed" },
          ]}
          placeholder="Status"
        />
      </Toolbar>
      <section className="panel p-4">
        <h2 className="text-sm font-semibold">Candidate email outbox</h2>
        {outbox.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No outbox rows in this view yet.</p>
        ) : (
          <table className="num mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Created</th>
                <th className="py-1 pr-3 font-medium">Org</th>
                <th className="py-1 pr-3 font-medium">Kind</th>
                <th className="py-1 pr-3 font-medium">To</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {outbox.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.createdAt)}
                  </td>
                  <td className="py-1.5 pr-3">{r.orgName ?? "—"}</td>
                  <td className="py-1.5 pr-3">{r.kind}</td>
                  <td className="py-1.5 pr-3 break-all">{r.toEmail}</td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={statusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td className="py-1.5 text-xs text-muted-foreground">
                    {r.sentAt ? `sent ${when(r.sentAt)}` : `${r.attempts} attempts`}
                    {r.lastError ? (
                      <span className="ml-1 text-destructive">{r.lastError}</span>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel p-4">
        <h2 className="text-sm font-semibold">Direct sends (last 7 days)</h2>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Invites, confirmations and password resets — sent inline, not via the outbox.
        </p>
        {sends.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No direct sends logged yet.</p>
        ) : (
          <table className="num mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Outcome</th>
                <th className="py-1 font-medium">Message</th>
              </tr>
            </thead>
            <tbody>
              {sends.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.createdAt)}
                  </td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={r.level === "info" ? "default" : "destructive"}>
                      {r.level === "info" ? "sent" : r.level}
                    </Badge>
                  </td>
                  <td className="py-1.5 break-all">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- jobs */

function Jobs() {
  const fetchJobs = useServerFn(obsJobs);
  const jobs = useQuery({
    queryKey: ["obs_jobs"],
    queryFn: () => fetchJobs({}),
    refetchInterval: 30_000,
  });

  if (jobs.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const d = jobs.data;
  if (!d) return <EmptyState title="Nothing observed yet." hint="Background jobs report here." />;
  return (
    <div className="space-y-4">
      <JobHealth jobs={{ prep: d.prepCounts, mail: { queued: 0, failed: 0 }, syncs: d.syncs }} />

      <section className="panel p-4">
        <h2 className="text-sm font-semibold">Recent screening prep jobs</h2>
        {d.prep.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No screening prep yet.</p>
        ) : (
          <table className="num mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">Updated</th>
                <th className="py-1 pr-3 font-medium">Org</th>
                <th className="py-1 pr-3 font-medium">Status</th>
                <th className="py-1 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {d.prep.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.updatedAt)}
                  </td>
                  <td className="py-1.5 pr-3">{r.orgName ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    <Badge variant={statusTone(r.status)}>{r.status}</Badge>
                    <span className="ml-2 text-muted-foreground">{r.attempts} tries</span>
                  </td>
                  <td className="py-1.5 text-destructive">{r.lastError ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
      <section className="panel p-4">
        <h2 className="text-sm font-semibold">AI errors (7 days)</h2>
        {d.aiErrors.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No AI errors in the last 7 days.</p>
        ) : (
          <table className="num mt-2 w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Feature</th>
                <th className="py-1 font-medium">Error</th>
              </tr>
            </thead>
            <tbody>
              {d.aiErrors.map((r, i) => (
                <tr key={i} className="border-t border-border/60 align-top">
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.createdAt)}
                  </td>
                  <td className="py-1.5 pr-3">{r.feature}</td>
                  <td className="py-1.5 break-all text-destructive">{r.errorMessage ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

/* ---------------------------------------------------------------------- page */

function Observability() {
  const { isSuperUser, isLoading } = usePlatform();
  const [tab, setTab] = useState("overview");
  const queryClient = useQueryClient();

  if (isLoading) {
    return <p className="p-6 text-sm text-muted-foreground">Checking platform access…</p>;
  }
  if (!isSuperUser) {
    return (
      <div className="panel mx-auto mt-10 max-w-md p-6 text-center">
        <Activity className="mx-auto size-6 text-muted-foreground" />
        <h1 className="mt-2 font-semibold">Super-user access only</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The observability console is restricted to platform administrators.
        </p>
      </div>
    );
  }

  return (
    <main className="mx-auto w-full max-w-[1400px] space-y-5 p-6">
      <PageHeader
        eyebrow="Platform console"
        title="Observability"
        description="Application logs, AI traces with full prompts and responses, email delivery, background jobs and browser errors — one console, 14-day retention."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => void queryClient.invalidateQueries({ queryKey: ["obs_"] })}
            title="Refresh"
          >
            <RefreshCw className="size-3.5" /> Refresh
          </Button>
        }
      />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="ai">AI traces</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview />
        </TabsContent>
        <TabsContent value="logs">
          <Logs />
        </TabsContent>
        <TabsContent value="ai">
          <AiTraces />
        </TabsContent>
        <TabsContent value="emails">
          <Emails />
        </TabsContent>
        <TabsContent value="jobs">
          <Jobs />
        </TabsContent>
      </Tabs>
    </main>
  );
}
