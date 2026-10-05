import { createFileRoute } from "@tanstack/react-router";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import {
  Activity,
  BrainCircuit,
  ChevronLeft,
  ChevronRight,
  Globe2,
  RefreshCw,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, LabelList, XAxis, YAxis } from "recharts";

import {
  obsAiTraceDetail,
  obsAiTraces,
  obsEmails,
  obsJobs,
  obsLogs,
  obsOverview,
  type ObsLogRow,
  type ObsOverview,
  type ObsTraceRow,
} from "@/lib/observability.functions";
import { listAllOrganizations } from "@/lib/platform.functions";
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
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

export const Route = createFileRoute("/platform-observability")({
  head: () => ({
    meta: [
      { title: "Platform console — Observability" },
      {
        name: "description",
        content:
          "Super-user view of application logs, AI traces with full prompts and responses, email delivery, background jobs and client-side errors — scoped to all organisations or one.",
      },
    ],
  }),
  component: Observability,
});

const PAGE_SIZE = 50;
const HOUR_FILTERS = [
  { hours: 24, label: "Last 24 hours" },
  { hours: 168, label: "Last 7 days" },
  { hours: 720, label: "Last 30 days" },
] as const;

/* Status palette (fixed, never themed) + the validated categorical slot 1. */
const STATUS_GOOD = "#0ca30c";
const STATUS_CRITICAL = "#d03b3b";
const SERIES_BLUE = { light: "#2a78d6", dark: "#3987e5" };

const errorTrendConfig = {
  count: { label: "Errors & warnings", theme: SERIES_BLUE },
} satisfies ChartConfig;
const aiCallsConfig = {
  ok: { label: "Succeeded", color: STATUS_GOOD },
  errors: { label: "Errors", color: STATUS_CRITICAL },
} satisfies ChartConfig;

function when(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}

function ageOf(iso: string | null | undefined): string {
  if (!iso) return "never";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 60) return `${mins}m ago`;
  if (mins < 24 * 60) return `${Math.round(mins / 60)}h ago`;
  return `${Math.round(mins / (24 * 60))}d ago`;
}

function levelTone(level: string) {
  if (level === "error") return "destructive" as const;
  if (level === "warn") return "default" as const;
  return "secondary" as const;
}

function statusTone(status: string | null | undefined) {
  if (status === "sent" || status === "ok" || status === "ready") return "default" as const;
  if (status === "failed" || status === "error") return "destructive" as const;
  if (status === "queued" || status === "running" || status === "pending")
    return "outline" as const;
  return "secondary" as const;
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

function Panel({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="panel p-4">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
      </div>
      {children}
    </section>
  );
}

/* ------------------------------------------------------------------ overview */

function Overview({
  orgId,
  hours,
  onPickOrg,
}: {
  orgId: string | null;
  hours: number;
  onPickOrg: (id: string | null) => void;
}) {
  const fetchOverview = useServerFn(obsOverview);
  const overview = useQuery({
    queryKey: ["obs_overview", orgId, hours],
    queryFn: () => fetchOverview({ data: { orgId, hours } }),
    refetchInterval: 20_000,
  });

  if (overview.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const d: ObsOverview | undefined = overview.data;
  if (!d)
    return (
      <EmptyState title="Nothing observed yet." hint="Data appears as the app serves traffic." />
    );

  const aiErrorPct = d.ai.calls ? Math.round((d.ai.errors / d.ai.calls) * 100) : 0;
  const orgChart = d.orgBreakdown.map((r) => ({
    name: r.orgName,
    calls: r.aiCalls,
    errors: r.aiErrors,
  }));
  const capChart = d.capabilityBreakdown.map((r) => ({ name: r.capability, calls: r.calls }));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Errors · 24h"
          value={d.logs.errors}
          hint={`${d.logs.warns} warnings`}
          tone={d.logs.errors > 0 ? "destructive" : "success"}
        />
        <StatCard
          label="AI calls · 24h"
          value={d.ai.calls}
          hint={`${d.ai.errors} errors (${aiErrorPct}%) · ${d.ai.totalTokens.toLocaleString()} tokens`}
          tone={d.ai.errors > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Email · 24h"
          value={d.logs.emailOk}
          hint={`${d.logs.emailErrors} failed · ${d.jobs.mail.queued} queued`}
          tone={d.logs.emailErrors + d.jobs.mail.failed > 0 ? "destructive" : "success"}
        />
        <StatCard
          label="Browser errors · 24h"
          value={d.logs.clientErrors}
          hint="uncaught FE errors"
          tone={d.logs.clientErrors > 0 ? "warning" : "success"}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title="Errors & warnings over time" hint={hours <= 48 ? "hourly" : "daily"}>
          {d.errorSeries.length === 0 ? (
            <p className="pt-6 pb-6 text-center text-sm text-muted-foreground">
              No errors in range.
            </p>
          ) : (
            <ChartContainer config={errorTrendConfig} className="h-44 w-full">
              <AreaChart data={d.errorSeries} margin={{ left: -18, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} strokeDasharray="0" stroke="var(--border)" />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  minTickGap={42}
                />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent indicator="line" />} />
                <Area
                  dataKey="count"
                  type="monotone"
                  strokeWidth={2}
                  fill="var(--color-count)"
                  fillOpacity={0.14}
                  stroke="var(--color-count)"
                />
              </AreaChart>
            </ChartContainer>
          )}
        </Panel>

        <Panel title="AI calls — succeeded vs errors" hint={hours <= 48 ? "hourly" : "daily"}>
          {d.aiSeries.length === 0 ? (
            <p className="pt-6 pb-6 text-center text-sm text-muted-foreground">
              No AI calls in range.
            </p>
          ) : (
            <ChartContainer config={aiCallsConfig} className="h-44 w-full">
              <BarChart data={d.aiSeries} margin={{ left: -18, right: 8, top: 4 }}>
                <CartesianGrid vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={6}
                  minTickGap={42}
                />
                <YAxis tickLine={false} axisLine={false} allowDecimals={false} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="ok"
                  stackId="a"
                  fill="var(--color-ok)"
                  stroke="var(--background)"
                  strokeWidth={2}
                  radius={[3, 3, 0, 0]}
                />
                <Bar
                  dataKey="errors"
                  stackId="a"
                  fill="var(--color-errors)"
                  stroke="var(--background)"
                  strokeWidth={2}
                  radius={[3, 3, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          )}
        </Panel>
      </div>

      {d.orgId == null && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title="AI calls by organisation" hint="click to scope the console">
            {orgChart.length === 0 ? (
              <p className="pt-4 text-sm text-muted-foreground">No AI usage in range yet.</p>
            ) : (
              <ChartContainer
                config={{ calls: { label: "AI calls", theme: SERIES_BLUE } }}
                className="h-48 w-full"
              >
                <BarChart data={orgChart} layout="vertical" margin={{ left: 8, right: 34 }}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={132}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="calls"
                    fill="var(--color-calls)"
                    radius={[0, 4, 4, 0]}
                    barSize={14}
                    onClick={(entry: { payload?: { name?: string } }) => {
                      const row = d.orgBreakdown.find((r) => r.orgName === entry?.payload?.name);
                      if (row?.orgId) onPickOrg(row.orgId);
                    }}
                    className="cursor-pointer"
                  >
                    <LabelList
                      dataKey="calls"
                      position="right"
                      className="fill-muted-foreground text-[11px]"
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </Panel>

          <Panel title="AI capability mix" hint="calls per capability, 24h">
            {capChart.length === 0 ? (
              <p className="pt-4 text-sm text-muted-foreground">No AI traces in range yet.</p>
            ) : (
              <ChartContainer
                config={{ calls: { label: "Traces", theme: SERIES_BLUE } }}
                className="h-48 w-full"
              >
                <BarChart data={capChart} layout="vertical" margin={{ left: 8, right: 34 }}>
                  <CartesianGrid horizontal={false} stroke="var(--border)" />
                  <XAxis type="number" hide />
                  <YAxis
                    type="category"
                    dataKey="name"
                    width={132}
                    tickLine={false}
                    axisLine={false}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="calls" fill="var(--color-calls)" radius={[0, 4, 4, 0]} barSize={14}>
                    <LabelList
                      dataKey="calls"
                      position="right"
                      className="fill-muted-foreground text-[11px]"
                    />
                  </Bar>
                </BarChart>
              </ChartContainer>
            )}
          </Panel>
        </div>
      )}

      <JobHealth jobs={d.jobs} compact />
      {d.latestErrors.length > 0 && (
        <Panel title="Latest errors & warnings">
          <table className="num w-full text-sm">
            <tbody>
              {d.latestErrors.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top first:border-t-0">
                  <td className="w-36 py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.createdAt)}
                  </td>
                  <td className="w-16 py-1.5 pr-3">
                    <Badge variant={levelTone(r.level)}>{r.level}</Badge>
                  </td>
                  <td className="w-20 py-1.5 pr-3 text-muted-foreground">{r.source}</td>
                  <td className="py-1.5">
                    <span className="line-clamp-2 break-all">{r.message}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}

type SyncRow = {
  kind: string;
  name: string;
  orgName: string;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  lastError: string | null;
};

function SyncDot({ status }: { status: string | null | undefined }) {
  const color =
    status === "ok"
      ? STATUS_GOOD
      : status === "failed"
        ? STATUS_CRITICAL
        : status === "running"
          ? "var(--muted-foreground)"
          : "var(--border)";
  return (
    <span
      aria-hidden
      className="inline-block size-2 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

function JobHealth({ jobs, compact = false }: { jobs: ObsOverview["jobs"]; compact?: boolean }) {
  return (
    <Panel title="Background jobs & syncs" hint="dot = last run outcome">
      <div className="flex flex-wrap gap-2">
        <HealthTile label="Screening prep" value={jobs.prep} />
        <HealthTile label="Email outbox" value={jobs.mail} />
      </div>
      {jobs.syncs.length === 0 ? (
        <p className="pt-3 text-sm text-muted-foreground">
          No board/HRMS connections configured yet.
        </p>
      ) : (
        <table className="num mt-3 w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-1 pr-3 font-medium">Org</th>
              <th className="py-1 pr-3 font-medium">Connection</th>
              <th className="py-1 pr-3 font-medium">Kind</th>
              {!compact && <th className="py-1 pr-3 font-medium">Last run</th>}
              <th className="py-1 font-medium">Status / error</th>
            </tr>
          </thead>
          <tbody>
            {jobs.syncs.map((s: SyncRow, i) => (
              <tr key={`${s.kind}-${s.name}-${i}`} className="border-t border-border/60 align-top">
                <td className="py-1.5 pr-3">{s.orgName}</td>
                <td className="py-1.5 pr-3">{s.name}</td>
                <td className="py-1.5 pr-3 text-muted-foreground">{s.kind}</td>
                {!compact && (
                  <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(s.lastRunAt)}
                  </td>
                )}
                <td className="py-1.5">
                  <span className="inline-flex items-center gap-2">
                    <SyncDot status={s.lastRunStatus} />
                    <span className="text-muted-foreground">{ageOf(s.lastRunAt)}</span>
                    {s.lastRunStatus ? (
                      <Badge variant={statusTone(s.lastRunStatus)}>{s.lastRunStatus}</Badge>
                    ) : null}
                  </span>
                  {s.lastError ? <div className="text-destructive">{s.lastError}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Panel>
  );
}

function HealthTile({
  label,
  value,
}: {
  label: string;
  value: { failed: number; queued?: number; pending?: number; running?: number };
}) {
  const busy = (value.pending ?? 0) + (value.running ?? 0);
  const tone =
    value.failed > 0 ? STATUS_CRITICAL : busy > 0 ? "var(--muted-foreground)" : STATUS_GOOD;
  return (
    <div className="panel flex items-center gap-3 p-3">
      <span
        aria-hidden
        className="inline-block size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: tone }}
      />
      <div>
        <div className="text-sm font-medium">{label}</div>
        <div className="text-xs text-muted-foreground">
          {Object.entries(value)
            .filter(([, v]) => v > 0)
            .map(([k, v]) => `${v} ${k}`)
            .join(" · ") || "idle"}
        </div>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- logs */

function Logs({ orgId, hours }: { orgId: string | null; hours: number }) {
  const fetchLogs = useServerFn(obsLogs);
  const [level, setLevel] = useState("all");
  const [source, setSource] = useState("all");
  const [q, setQ] = useState("");
  const [live, setLive] = useState(false);
  const [page, setPage] = useState(0);
  const [expanded, setExpanded] = useState<string | null>(null);

  const input = useMemo(
    () => ({
      orgId,
      hours,
      level,
      source,
      q: q.trim() || null,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [orgId, hours, level, source, q, page],
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
      <div className="flex flex-wrap items-center gap-2">
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
      </div>

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
                <th className="py-1 text-right font-medium">Took</th>
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
    <tr
      className="cursor-pointer border-t border-border/60 align-top hover:bg-muted/40"
      onClick={onToggle}
    >
      <td className="py-1.5 pr-3 whitespace-nowrap text-muted-foreground">{when(row.createdAt)}</td>
      <td className="py-1.5 pr-3">
        <span className="inline-flex items-center gap-1.5">
          <SyncDot
            status={row.level === "error" ? "failed" : row.level === "warn" ? "running" : "ok"}
          />
          <span>{row.level}</span>
        </span>
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
  );
}

/* ----------------------------------------------------------------- ai traces */

const CAPABILITY_FILTERS = [
  { value: "all", label: "All capabilities" },
  { value: "matching", label: "Matching" },
  { value: "jd", label: "Job descriptions" },
  { value: "screening", label: "Screening" },
  { value: "research", label: "Research" },
  { value: "comms", label: "Comms" },
  { value: "copilot", label: "Copilot" },
];

function HarnessBadge({ harness, grounded }: { harness: string | null; grounded: boolean | null }) {
  if (harness === "research")
    return (
      <Badge variant="outline" className="gap-1">
        <Globe2 className="size-3" /> research{grounded === false ? " · ungrounded" : ""}
      </Badge>
    );
  if (harness === "json")
    return (
      <Badge variant="outline" className="gap-1">
        <BrainCircuit className="size-3" /> structured
      </Badge>
    );
  return <span className="text-muted-foreground">—</span>;
}

function AiTraces({ orgId, hours }: { orgId: string | null; hours: number }) {
  const fetchTraces = useServerFn(obsAiTraces);
  const fetchDetail = useServerFn(obsAiTraceDetail);
  const [capability, setCapability] = useState("all");
  const [outcome, setOutcome] = useState("all");
  const [openId, setOpenId] = useState<string | null>(null);
  const [page, setPage] = useState(0);

  const input = useMemo(
    () => ({
      orgId,
      hours,
      capability: capability === "all" ? null : capability,
      outcome,
      limit: PAGE_SIZE,
      offset: page * PAGE_SIZE,
    }),
    [orgId, hours, capability, outcome, page],
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
      <div className="flex flex-wrap items-center gap-2">
        <SelectFilter
          value={capability}
          onChange={(v) => {
            setCapability(v);
            setPage(0);
          }}
          options={CAPABILITY_FILTERS}
          placeholder="Capability"
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
      </div>

      {traces.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No AI calls in this range yet."
          hint="Every gateway invocation is captured here with its full prompt, response, harness and tool calls."
        />
      ) : (
        <section className="panel p-4">
          <table className="num w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="py-1 pr-3 font-medium">When</th>
                <th className="py-1 pr-3 font-medium">Capability</th>
                <th className="py-1 pr-3 font-medium">Feature</th>
                <th className="py-1 pr-3 font-medium">Harness</th>
                <th className="py-1 pr-3 font-medium">Outcome</th>
                {!orgId && <th className="py-1 pr-3 font-medium">Org</th>}
                <th className="py-1 text-right font-medium">Tokens</th>
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
                  <td className="py-1.5 pr-3">{r.capability ?? "—"}</td>
                  <td className="py-1.5 pr-3 font-medium">{r.feature}</td>
                  <td className="py-1.5 pr-3">
                    <HarnessBadge harness={r.harness} grounded={r.grounded} />
                  </td>
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
                  {!orgId && (
                    <td className="py-1.5 pr-3 text-muted-foreground">{r.orgName ?? "—"}</td>
                  )}
                  <td className="py-1.5 text-right">{r.totalTokens.toLocaleString()}</td>
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
              Harness, tool calls and the full prompt/response capture — super-user only, purged
              after 14 days.
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

const STEP_ICON = {
  model_call: BrainCircuit,
  tool_call: Wrench,
  guard: ShieldCheck,
} as const;

function TraceBody({
  trace,
}: {
  trace: NonNullable<Awaited<ReturnType<typeof obsAiTraceDetail>>>;
}) {
  return (
    <div className="space-y-3 text-sm">
      {/* Harness panel — what wrapper ran, with which defences */}
      <div className="flex flex-wrap items-center gap-2 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs">
        <HarnessBadge harness={trace.harness} grounded={trace.grounded} />
        <Badge variant="outline" className="gap-1">
          <ShieldCheck className="size-3" /> injection-guarded
        </Badge>
        <Badge variant="outline">capability: {trace.capability ?? "platform"}</Badge>
        <Badge variant="outline">attempts: {trace.attempts}</Badge>
        {trace.durationMs != null ? <Badge variant="outline">{trace.durationMs} ms</Badge> : null}
        <Badge variant={trace.ok ? "default" : "destructive"}>{trace.ok ? "ok" : "error"}</Badge>
      </div>

      {/* Span timeline — model calls, tool calls, guards in order */}
      {(trace.steps.length > 0 || trace.frames.length > 0) && (
        <section className="panel p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Run timeline
          </h3>
          <ol className="mt-2 space-y-0">
            {trace.steps.map((s) => {
              const Icon = STEP_ICON[s.kind as keyof typeof STEP_ICON] ?? Wrench;
              const failed = s.status === "error";
              return (
                <li key={s.seq} className="relative flex gap-3 pb-3 pl-1 last:pb-0">
                  <span
                    className="absolute top-5 bottom-0 left-[13px] w-px bg-border last:hidden"
                    aria-hidden
                  />
                  <span
                    className="z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background"
                    style={{ color: failed ? STATUS_CRITICAL : "var(--foreground)" }}
                  >
                    <Icon className="size-3.5" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{s.name}</span>
                      <span className="text-xs text-muted-foreground">{s.kind}</span>
                      {failed ? <Badge variant="destructive">error</Badge> : null}
                      {s.durationMs != null ? (
                        <span className="text-xs text-muted-foreground">{s.durationMs} ms</span>
                      ) : null}
                    </div>
                    {s.error ? <div className="text-xs text-destructive">{s.error}</div> : null}
                    {s.input ? <Payload label="input" value={s.input} /> : null}
                    {s.output ? <Payload label="output" value={s.output} /> : null}
                  </div>
                </li>
              );
            })}
            {trace.frames.map((f) => (
              <li key={`m${f.attempt}`} className="relative flex gap-3 pb-3 pl-1 last:pb-0">
                <span className="absolute top-5 bottom-0 left-[13px] w-px bg-border" aria-hidden />
                <span className="z-10 mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border bg-background">
                  <BrainCircuit className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">model call #{f.attempt}</span>
                    <span className="text-xs text-muted-foreground">
                      {f.provider} · {f.model}
                    </span>
                    {f.status === "error" ? <Badge variant="destructive">error</Badge> : null}
                    {f.durationMs != null ? (
                      <span className="text-xs text-muted-foreground">{f.durationMs} ms</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {f.promptTokens}/{f.completionTokens} tokens
                    </span>
                  </div>
                  {f.errorMessage ? (
                    <div className="text-xs text-destructive">{f.errorMessage}</div>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        </section>
      )}

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

function Payload({ label, value }: { label: string; value: unknown }) {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return (
    <details className="mt-1">
      <summary className="cursor-pointer text-xs text-muted-foreground">{label}</summary>
      <pre className="mt-1 max-h-40 overflow-auto rounded-md bg-muted/60 p-2 text-xs whitespace-pre-wrap">
        {text}
      </pre>
    </details>
  );
}

/* -------------------------------------------------------------------- emails */

function Emails({ orgId, hours }: { orgId: string | null; hours: number }) {
  const fetchEmails = useServerFn(obsEmails);
  const [status, setStatus] = useState("all");
  const emails = useQuery({
    queryKey: ["obs_emails", orgId, hours, status],
    queryFn: () => fetchEmails({ data: { orgId, hours, status } }),
    placeholderData: keepPreviousData,
    refetchInterval: 30_000,
  });

  if (emails.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const outbox = emails.data?.outbox ?? [];
  const sends = emails.data?.sends ?? [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
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
      </div>
      <Panel title="Candidate email outbox">
        {outbox.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No outbox rows in this view yet.</p>
        ) : (
          <table className="num w-full text-sm">
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
                    <span className="inline-flex items-center gap-2">
                      <SyncDot status={r.status === "sent" ? "ok" : r.status} />
                      <Badge variant={statusTone(r.status)}>{r.status}</Badge>
                    </span>
                  </td>
                  <td className="py-1.5 text-xs text-muted-foreground">
                    {r.sentAt ? `sent ${when(r.sentAt)}` : `${r.attempts} attempts`}
                    {r.lastError ? <div className="text-destructive">{r.lastError}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel
        title="Direct sends (last 7 days)"
        hint="invites, confirmations and password resets — inline, not the outbox"
      >
        {sends.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No direct sends logged yet.</p>
        ) : (
          <table className="num w-full text-sm">
            <tbody>
              {sends.map((r) => (
                <tr key={r.id} className="border-t border-border/60 align-top first:border-t-0">
                  <td className="w-36 py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.createdAt)}
                  </td>
                  <td className="w-20 py-1.5 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <SyncDot status={r.level === "info" ? "ok" : "failed"} />
                      <span>{r.level === "info" ? "sent" : "failed"}</span>
                    </span>
                  </td>
                  <td className="py-1.5 break-all">{r.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/* ---------------------------------------------------------------------- jobs */

function Jobs({ orgId }: { orgId: string | null }) {
  const fetchJobs = useServerFn(obsJobs);
  const jobs = useQuery({
    queryKey: ["obs_jobs", orgId],
    queryFn: () => fetchJobs({ data: { orgId, hours: 24 } }),
    refetchInterval: 30_000,
  });

  if (jobs.isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const d = jobs.data;
  if (!d) return <EmptyState title="Nothing observed yet." hint="Background jobs report here." />;
  return (
    <div className="space-y-4">
      <JobHealth jobs={{ prep: d.prepCounts, mail: { queued: 0, failed: 0 }, syncs: d.syncs }} />
      <Panel title="Recent screening prep jobs">
        {d.prep.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No screening prep yet.</p>
        ) : (
          <table className="num w-full text-sm">
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
                    {ageOf(r.updatedAt)}
                  </td>
                  <td className="py-1.5 pr-3">{r.orgName ?? "—"}</td>
                  <td className="py-1.5 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <SyncDot status={r.status === "ready" ? "ok" : r.status} />
                      <Badge variant={statusTone(r.status)}>{r.status}</Badge>
                    </span>
                  </td>
                  <td className="py-1.5 text-destructive">{r.lastError ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
      <Panel title="AI errors (7 days)">
        {d.aiErrors.length === 0 ? (
          <p className="pt-2 text-sm text-muted-foreground">No AI errors in the last 7 days.</p>
        ) : (
          <table className="num w-full text-sm">
            <tbody>
              {d.aiErrors.map((r, i) => (
                <tr key={i} className="border-t border-border/60 align-top first:border-t-0">
                  <td className="w-36 py-1.5 pr-3 whitespace-nowrap text-muted-foreground">
                    {when(r.createdAt)}
                  </td>
                  <td className="w-32 py-1.5 pr-3">{r.feature}</td>
                  <td className="py-1.5 break-all text-destructive">{r.errorMessage ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------ controls */

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

/* ---------------------------------------------------------------------- page */

function Observability() {
  const { isSuperUser, isLoading } = usePlatform();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState("overview");
  const [orgId, setOrgId] = useState<string | null>(null);
  const [hours, setHours] = useState(24);

  const fetchOrgs = useServerFn(listAllOrganizations);
  const orgs = useQuery({
    queryKey: ["platform_orgs"],
    queryFn: () => fetchOrgs({}),
    enabled: isSuperUser,
  });

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
    <main className="mx-auto w-full max-w-[1400px] space-y-4 p-6">
      <PageHeader
        eyebrow="Platform console"
        title="Observability"
        description="Logs, AI traces with harness and tool calls, email delivery, background jobs and browser errors — across all organisations or scoped to one."
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

      {/* One filter row above every tab — org + range scope everything below */}
      <div className="flex flex-wrap items-center gap-2">
        <Select value={orgId ?? "all"} onValueChange={(v) => setOrgId(v === "all" ? null : v)}>
          <SelectTrigger className="h-8 w-[240px] gap-2">
            <Globe2 className="size-3.5 text-muted-foreground" />
            <SelectValue placeholder="Organisation" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All organisations</SelectItem>
            {(orgs.data ?? []).map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <SelectFilter
          value={String(hours)}
          onChange={(v) => setHours(Number(v))}
          options={HOUR_FILTERS.map((h) => ({ value: String(h.hours), label: h.label }))}
          placeholder="Range"
        />
        {orgId ? (
          <Button variant="ghost" size="sm" className="h-8" onClick={() => setOrgId(null)}>
            Clear org scope
          </Button>
        ) : null}
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="logs">Logs</TabsTrigger>
          <TabsTrigger value="ai">AI traces</TabsTrigger>
          <TabsTrigger value="emails">Emails</TabsTrigger>
          <TabsTrigger value="jobs">Jobs</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <Overview orgId={orgId} hours={hours} onPickOrg={setOrgId} />
        </TabsContent>
        <TabsContent value="logs">
          <Logs orgId={orgId} hours={hours} />
        </TabsContent>
        <TabsContent value="ai">
          <AiTraces orgId={orgId} hours={hours} />
        </TabsContent>
        <TabsContent value="emails">
          <Emails orgId={orgId} hours={hours} />
        </TabsContent>
        <TabsContent value="jobs">
          <Jobs orgId={orgId} />
        </TabsContent>
      </Tabs>
    </main>
  );
}
