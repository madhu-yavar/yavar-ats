import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, CircleDashed, KeyRound, Loader2, Plug } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { disconnectIntegration, saveIntegration, testIntegration } from "@/lib/integrations.functions";
import { PageHeader } from "@/components/ats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

type Integration = Tables<"source_integrations">;

const integrationsQuery = queryOptions({
  queryKey: ["source_integrations"],
  queryFn: async () => {
    const { data, error } = await supabase.from("source_integrations").select("*").order("label");
    if (error) throw new Error(error.message);
    return (data ?? []) as Integration[];
  },
});

const FIELD_LABEL: Record<string, string> = {
  client_id: "Client ID",
  client_secret: "Client secret",
  account_id: "Recruiter account ID",
  api_key: "API key",
  employer_id: "Employer ID",
  token: "Personal access token",
};

export const Route = createFileRoute("/integrations")({
  head: () => ({
    meta: [
      { title: "Sourcing Integrations — LinkedIn, Naukri & Indeed APIs" },
      {
        name: "description",
        content:
          "Configure LinkedIn Talent Solutions, Naukri Resdex, Indeed and GitHub API credentials, test each connection and enable them as sourcing channels.",
      },
      { property: "og:title", content: "Sourcing Integrations" },
      {
        property: "og:description",
        content: "HR-configurable job board and profile API credentials with live connection tests.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Integrations,
});

function StatusPill({ status }: { status: string }) {
  const map: Record<string, { icon: typeof CheckCircle2; cls: string; label: string }> = {
    ok: { icon: CheckCircle2, cls: "text-emerald-600", label: "Connected" },
    pending: { icon: CircleDashed, cls: "text-amber-600", label: "Needs setup" },
    failed: { icon: CircleAlert, cls: "text-destructive", label: "Failed" },
    untested: { icon: CircleDashed, cls: "text-muted-foreground", label: "Not configured" },
  };
  const { icon: Icon, cls, label } = map[status] ?? map["untested"]!;
  return (
    <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${cls}`}>
      <Icon className="size-3.5" /> {label}
    </span>
  );
}

function IntegrationCard({ row }: { row: Integration }) {
  const qc = useQueryClient();
  const save = useServerFn(saveIntegration);
  const test = useServerFn(testIntegration);
  const disconnect = useServerFn(disconnectIntegration);

  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const [enabled, setEnabled] = useState(row.enabled);
  const [baseUrl, setBaseUrl] = useState(typeof cfg["base_url"] === "string" ? (cfg["base_url"] as string) : "");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);

  const provider = row.provider as "linkedin" | "naukri" | "indeed" | "github" | "careers";
  const notes = typeof cfg["notes"] === "string" ? (cfg["notes"] as string) : null;
  const docs = typeof cfg["docs"] === "string" ? (cfg["docs"] as string) : null;

  async function onSave() {
    setBusy("save");
    try {
      await save({
        data: {
          integrationId: row.id,
          provider,
          enabled,
          config: { ...cfg, base_url: baseUrl } as Record<string, string>,
          secrets,
        },
      });
      setSecrets({});
      toast.success(`${row.label} settings saved`);
      qc.invalidateQueries({ queryKey: ["source_integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    try {
      const outcome = await test({ data: { integrationId: row.id, provider } });
      if (outcome.status === "ok") toast.success(outcome.message);
      else if (outcome.status === "pending") toast.warning(outcome.message);
      else toast.error(outcome.message);
      qc.invalidateQueries({ queryKey: ["source_integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  async function onClear() {
    setBusy("clear");
    try {
      await disconnect({ data: { integrationId: row.id } });
      setEnabled(false);
      toast.success("Credentials removed");
      qc.invalidateQueries({ queryKey: ["source_integrations"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="panel p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Plug className="size-4 text-primary" />
            <h2 className="font-semibold">{row.label}</h2>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-3">
            <StatusPill status={row.last_test_status} />
            {row.has_credentials ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <KeyRound className="size-3.5" /> credentials stored
              </span>
            ) : null}
            {row.last_tested_at ? (
              <span className="num text-xs text-muted-foreground">
                tested {new Date(row.last_tested_at).toLocaleString()}
              </span>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Enabled</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      {notes ? <p className="mt-3 text-sm text-muted-foreground">{notes}</p> : null}
      {row.last_test_message ? (
        <p className="mt-2 rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">{row.last_test_message}</p>
      ) : null}

      {row.credential_fields.length ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {row.credential_fields.map((field) => (
            <div key={field}>
              <Label className="text-xs text-muted-foreground">{FIELD_LABEL[field] ?? field}</Label>
              <Input
                type="password"
                autoComplete="off"
                placeholder={row.has_credentials ? "•••••• stored — leave blank to keep" : "Paste value"}
                value={secrets[field] ?? ""}
                onChange={(e) => setSecrets((p) => ({ ...p, [field]: e.target.value }))}
              />
            </div>
          ))}
          {provider !== "github" && provider !== "careers" ? (
            <div className="sm:col-span-2">
              <Label className="text-xs text-muted-foreground">Partner API base URL</Label>
              <Input
                placeholder="https://api.partner.example.com"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
              <p className="mt-1 text-xs text-muted-foreground">
                Supplied in your partner onboarding pack. Required before search and applicant pulls can run.
              </p>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Button size="sm" onClick={onSave} disabled={busy !== null}>
          {busy === "save" ? <Loader2 className="size-4 animate-spin" /> : null} Save
        </Button>
        <Button size="sm" variant="outline" onClick={onTest} disabled={busy !== null}>
          {busy === "test" ? <Loader2 className="size-4 animate-spin" /> : null} Test connection
        </Button>
        {row.has_credentials ? (
          <Button size="sm" variant="ghost" onClick={onClear} disabled={busy !== null}>
            Remove credentials
          </Button>
        ) : null}
        {docs ? (
          <a
            href={docs}
            target="_blank"
            rel="noreferrer noopener"
            className="ml-auto text-xs text-primary underline-offset-4 hover:underline"
          >
            Provider API docs
          </a>
        ) : null}
      </div>
    </article>
  );
}

function Integrations() {
  const rows = useQuery(integrationsQuery);

  return (
    <>
      <PageHeader
        eyebrow="Settings"
        title="Sourcing integrations"
        description="Store each job board's API credentials, verify the connection live, and switch it on as a sourcing channel. Credentials are held server-side and are never sent to the browser."
      />

      <section className="panel p-5">
        <h2 className="font-semibold">What each channel can actually do</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
          <li>
            <strong className="text-foreground">LinkedIn</strong> — job postings and Recruiter System Connect via a
            paid Talent Solutions partnership. Arbitrary candidate profiles are not readable through the API, so
            LinkedIn scoring stays narrative-based on the resume plus recruiter-pasted profile text.
          </li>
          <li>
            <strong className="text-foreground">Naukri</strong> — Resdex resume search and applicant pulls for
            enterprise recruiter subscriptions (client id, secret, account id, partner base URL).
          </li>
          <li>
            <strong className="text-foreground">Indeed</strong> — job feed plus Indeed Apply for inbound applicants.
          </li>
          <li>
            <strong className="text-foreground">GitHub</strong> — fully public API, already live in social scoring. A
            token only raises the rate limit.
          </li>
        </ul>
      </section>

      {rows.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading integrations…</p>
      ) : (
        <div className="grid gap-4">
          {(rows.data ?? []).map((row) => (
            <IntegrationCard key={row.id} row={row} />
          ))}
        </div>
      )}
    </>
  );
}
