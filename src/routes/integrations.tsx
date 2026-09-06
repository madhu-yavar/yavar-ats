import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, CircleAlert, CircleDashed, KeyRound, Loader2, Plug, Sparkles } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { disconnectIntegration, saveIntegration, testIntegration } from "@/lib/integrations.functions";
import { getAiSettings, removeAiKey, saveAiSettings, testAiModel } from "@/lib/ai-settings.functions";
import { linkedinManagedStatus } from "@/lib/linkedin.functions";
import { usePlatform } from "@/hooks/usePlatform";
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
  refresh_token: "OAuth refresh token",
  tenant_id: "Azure tenant ID",
  organizer_email: "Organizer mailbox (host)",
};

/** Plain-English hint shown under each credential box. */
const FIELD_HINT: Record<string, string> = {
  client_id: "A long public code shown on the app page after you create the app. Safe to copy.",
  client_secret: "The private password for that app. Shown only once — copy it right away.",
  account_id: "Your company's account number, shown on the same app page.",
  api_key: "A single long key your account manager or the developer portal gives you.",
  employer_id: "Your employer/company number on the job board.",
  token: "A read-only token you generate in your own account settings.",
  refresh_token: "A long-lived code from the one-time sign-in step described below.",
  tenant_id: "Your organisation's directory ID in Microsoft Entra (Azure AD).",
  organizer_email: "The mailbox that will host the interviews, e.g. interviews@yourcompany.com.",
};

type SetupGuide = {
  who: string;
  minutes: string;
  links: { label: string; href: string }[];
  steps: string[];
};

/** Step-by-step, non-technical setup instructions per provider. */
const SETUP_GUIDE: Record<string, SetupGuide> = {
  linkedin: {
    who: "Nothing for HR to set up. The LinkedIn account is authorised once, centrally, for the whole company.",
    minutes: "0 min",
    links: [{ label: "LinkedIn Recruiter", href: "https://business.linkedin.com/talent-solutions/recruiter" }],
    steps: [
      "Check the panel above says an authorised LinkedIn account is connected.",
      "Turn Enabled on — job adverts can then be published to LinkedIn from that account.",
      "If it says no account is connected, ask whoever administers ATSIQ to authorise it once; recruiters never sign in or paste anything here.",
    ],
  },

  naukri: {
    who: "Needs a Naukri Resdex / RMS employer subscription. Ask your Naukri account manager for API access.",
    minutes: "5 min once Naukri sends your pack",
    links: [
      { label: "Naukri employer portal", href: "https://recruit.naukri.com/" },
      { label: "Naukri employer support", href: "https://www.naukri.com/recruiter-services" },
    ],
    steps: [
      "Email your Naukri account manager and ask for “Resdex API credentials for our ATS”.",
      "They send an onboarding pack with a client ID, client secret and an API base URL.",
      "Paste all three below (base URL goes in the last box) and press Test connection.",
    ],
  },
  indeed: {
    who: "Needs an Indeed employer account; API keys are issued by Indeed partner support.",
    minutes: "5 min once Indeed issues the key",
    links: [
      { label: "Indeed employer sign-in", href: "https://employers.indeed.com/" },
      { label: "Indeed partner / API portal", href: "https://developer.indeed.com/" },
    ],
    steps: [
      "Sign in to the Indeed employer account and request API/partner access for your ATS.",
      "Copy the API key they issue into the box below.",
      "Add the API base URL from their email, then press Test connection.",
    ],
  },
  github: {
    who: "Anyone with a free GitHub account. Optional — it only raises the hourly limit.",
    minutes: "2 min",
    links: [
      {
        label: "Create a read-only token",
        href: "https://github.com/settings/tokens/new?description=ATS%20candidate%20verification&scopes=public_repo",
      },
    ],
    steps: [
      "Open the link, sign in, set expiry to “No expiration” (or 1 year), leave all tick boxes unchecked.",
      "Press Generate token and copy the value that appears once.",
      "Paste it below and press Test connection. Without a token the app still works, just slower.",
    ],
  },
  careers: {
    who: "Nothing to configure — this is the built-in careers page source.",
    minutes: "0 min",
    links: [],
    steps: ["Leave this on. Applicants from your own careers page land straight in the talent pool."],
  },
  zoom: {
    who: "Needs a paid Zoom plan and someone with the Zoom admin role.",
    minutes: "10 min",
    links: [
      { label: "Zoom App Marketplace (Build app)", href: "https://marketplace.zoom.us/develop/create" },
      { label: "Zoom setup guide (with screenshots)", href: "https://developers.zoom.us/docs/internal-apps/create/" },
    ],
    steps: [
      "Open the Marketplace link, choose Build App → “Server-to-Server OAuth”, and give it the name “ATS interviews”.",
      "On the App Credentials page copy Account ID, Client ID and Client Secret into the boxes below.",
      "Open the Scopes page, press Add Scopes and tick meeting:write:admin and meeting:read:admin.",
      "Press Activate your app in Zoom, then Test connection here.",
    ],
  },
  google_meet: {
    who: "Needs a Google Workspace account for the recruiting calendar and its admin.",
    minutes: "15 min",
    links: [
      { label: "Google Cloud credentials page", href: "https://console.cloud.google.com/apis/credentials" },
      { label: "Turn on Calendar API", href: "https://console.cloud.google.com/apis/library/calendar-json.googleapis.com" },
      { label: "OAuth Playground (get refresh token)", href: "https://developers.google.com/oauthplayground/" },
    ],
    steps: [
      "In Google Cloud, create a project, then press “Turn on Calendar API”.",
      "On the credentials page choose Create credentials → OAuth client ID → Web application, and add https://developers.google.com/oauthplayground as an authorised redirect URI.",
      "Copy the Client ID and Client secret into the boxes below.",
      "Open the OAuth Playground, press the gear icon, tick “Use your own OAuth credentials” and paste the same ID and secret.",
      "In step 1 enter the scope https://www.googleapis.com/auth/calendar, authorise with the recruiting calendar account, then exchange the code and copy the refresh token into the box below.",
      "Press Test connection.",
    ],
  },
  teams: {
    who: "Needs Microsoft 365 and a Global/Application admin in Microsoft Entra (Azure AD).",
    minutes: "15 min",
    links: [
      { label: "Register an Entra app", href: "https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" },
      {
        label: "Microsoft setup guide",
        href: "https://learn.microsoft.com/en-us/graph/cloud-communications-online-meeting-application-access-policy",
      },
    ],
    steps: [
      "Open the Entra link and press New registration; name it “ATS interviews”.",
      "From the Overview page copy the Application (client) ID and Directory (tenant) ID below.",
      "Go to Certificates & secrets → New client secret, copy the value immediately into the box below.",
      "Go to API permissions → Add a permission → Microsoft Graph → Application permissions → OnlineMeetings.ReadWrite.All, then press Grant admin consent.",
      "Ask IT to run the Teams application access policy (see the Microsoft guide) for the organiser mailbox you enter below.",
      "Enter that mailbox and press Test connection.",
    ],
  },
};

function SetupHelp({ provider, label }: { provider: string; label: string }) {
  const guide = SETUP_GUIDE[provider];
  if (!guide) return null;
  return (
    <details className="mt-3 rounded-lg border border-border bg-surface-2 p-3 open:pb-4">
      <summary className="cursor-pointer text-sm font-medium">
        How do I get these? — step-by-step for {label}
      </summary>
      <p className="mt-3 text-xs text-muted-foreground">
        {guide.who} · Roughly {guide.minutes}.
      </p>
      {guide.links.length ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {guide.links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target="_blank"
              rel="noreferrer noopener"
              className="rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-primary hover:bg-surface-1"
            >
              {l.label} ↗
            </a>
          ))}
        </div>
      ) : null}
      <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground">
        {guide.steps.map((s) => (
          <li key={s}>{s}</li>
        ))}
      </ol>
      <p className="mt-3 text-xs text-muted-foreground">
        Stuck on a step? Forward this list to whoever administers the account — everything above happens on the
        provider’s own website, not here.
      </p>
    </details>
  );
}


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

/** Shared credential inputs (used directly, or tucked away for LinkedIn). */
function CredentialFields({
  fields,
  hasCredentials,
  secrets,
  setSecrets,
  baseUrl,
  setBaseUrl,
  showBaseUrl,
}: {
  fields: string[];
  hasCredentials: boolean;
  secrets: Record<string, string>;
  setSecrets: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  baseUrl: string;
  setBaseUrl: (v: string) => void;
  showBaseUrl: boolean;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {fields.map((field) => (
        <div key={field}>
          <Label className="text-xs text-muted-foreground">{FIELD_LABEL[field] ?? field}</Label>
          <Input
            type={field === "organizer_email" ? "email" : "password"}
            autoComplete="off"
            placeholder={hasCredentials ? "•••••• stored — leave blank to keep" : "Paste value"}
            value={secrets[field] ?? ""}
            onChange={(e) => setSecrets((p) => ({ ...p, [field]: e.target.value }))}
          />
          {FIELD_HINT[field] ? <p className="mt-1 text-xs text-muted-foreground">{FIELD_HINT[field]}</p> : null}
        </div>
      ))}
      {showBaseUrl ? (
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
  );
}

/**
 * Company-wide LinkedIn account panel. This is NOT a per-recruiter sign-in:
 * one LinkedIn account is authorised once for the whole platform by whoever
 * administers ATSIQ, and every recruiter posts through that account.
 */
function LinkedinOneClick() {
  const status = useQuery({
    queryKey: ["linkedin_managed"],
    queryFn: () => linkedinManagedStatus({ data: undefined }),
    refetchOnWindowFocus: false,
  });
  const s = status.data;

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Company LinkedIn account
        </div>
        <Button size="sm" variant="outline" onClick={() => status.refetch()} disabled={status.isFetching}>
          {status.isFetching ? <Loader2 className="size-4 animate-spin" /> : null} Check LinkedIn
        </Button>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        {status.isLoading
          ? "Checking the LinkedIn account…"
          : s?.connected
            ? `Connected — job adverts go out through ${s.member ?? "the authorised LinkedIn account"}. Nothing to configure here: no app details, no keys, no per-recruiter sign-in.`
            : (s?.message ?? "No LinkedIn account is connected yet.")}
      </p>

      {s?.connected ? (
        <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
          <CheckCircle2 className="size-3.5" /> Connected account{s.member ? ` — ${s.member}` : ""}
        </p>
      ) : null}

      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Recruiters just use the app — publishing to LinkedIn happens through this one company account.</li>
        <li>
          To connect or swap the account, whoever administers ATSIQ signs in once with the company LinkedIn login on
          this page. It cannot be done from a recruiter&apos;s screen.
        </li>
        <li>
          Searching LinkedIn profiles and pulling CVs (Recruiter / Talent Solutions data) needs LinkedIn to switch
          your paid Recruiter contract over to data access for ATSIQ and approve it — a LinkedIn Recruiter login on
          its own does not open that up. Once LinkedIn confirms it for your company, sourcing turns on here with no
          extra work from HR.
        </li>
      </ul>

    </div>
  );
}


function IntegrationCard({ row }: { row: Integration }) {

  const qc = useQueryClient();
  const { isSuperUser } = usePlatform();
  const save = useServerFn(saveIntegration);

  const test = useServerFn(testIntegration);
  const disconnect = useServerFn(disconnectIntegration);

  const cfg = (row.config ?? {}) as Record<string, unknown>;
  const [enabled, setEnabled] = useState(row.enabled);
  const [baseUrl, setBaseUrl] = useState(typeof cfg["base_url"] === "string" ? (cfg["base_url"] as string) : "");
  const [secrets, setSecrets] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);

  const provider = row.provider as
    | "linkedin"
    | "naukri"
    | "indeed"
    | "github"
    | "careers"
    | "zoom"
    | "google_meet"
    | "teams";
  const isMeeting = row.category === "meeting";
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
      // Typed-but-unsaved values are the #1 cause of a "not fully configured"
      // failure, so persist them first and then test what is actually stored.
      const pending = Object.values(secrets).some((v) => v.trim().length > 0);
      if (pending) {
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
      }
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

      {provider === "linkedin" ? <LinkedinOneClick /> : null}

      <SetupHelp provider={provider} label={row.label} />

      {row.credential_fields.length ? (
        provider === "linkedin" ? (
          isSuperUser ? (
            <details className="mt-4 rounded-lg border border-border bg-surface-2 p-3">
              <summary className="cursor-pointer text-sm font-medium">
                Platform administrator only — use a custom LinkedIn app
              </summary>
              <div className="mt-3">
                <CredentialFields
                  fields={row.credential_fields}
                  hasCredentials={row.has_credentials}
                  secrets={secrets}
                  setSecrets={setSecrets}
                  baseUrl={baseUrl}
                  setBaseUrl={setBaseUrl}
                  showBaseUrl
                />
              </div>
            </details>
          ) : null
        ) : (

          <div className="mt-4">
            <CredentialFields
              fields={row.credential_fields}
              hasCredentials={row.has_credentials}
              secrets={secrets}
              setSecrets={setSecrets}
              baseUrl={baseUrl}
              setBaseUrl={setBaseUrl}
              showBaseUrl={!isMeeting && provider !== "github" && provider !== "careers"}
            />
          </div>
        )
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

const PROVIDER_MODELS: Record<string, { id: string; label: string }[]> = {
  lovable: [
    { id: "google/gemini-3.7-flash", label: "Gemini 3.7 Flash — fast, default" },
    { id: "google/gemini-3.1-pro-preview", label: "Gemini 3.1 Pro — deeper reasoning" },
    { id: "openai/gpt-5.5", label: "GPT-5.5 — strongest reasoning" },
    { id: "openai/gpt-5.4-mini", label: "GPT-5.4 mini — cheap, high volume" },
  ],
  openai: [
    { id: "gpt-5.5", label: "GPT-5.5" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4o", label: "GPT-4o" },
  ],
  anthropic: [
    { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5" },
    { id: "claude-opus-4-1", label: "Claude Opus 4.1" },
    { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku" },
  ],
};

function AiModelCard() {
  const settings = useQuery({ queryKey: ["ai_settings"], queryFn: () => getAiSettings({ data: undefined }) });
  const qc = useQueryClient();
  const save = useServerFn(saveAiSettings);
  const test = useServerFn(testAiModel);
  const removeKey = useServerFn(removeAiKey);

  const [provider, setProvider] = useState<string | null>(null);
  const [model, setModel] = useState<string | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState<"save" | "test" | "clear" | null>(null);

  const s = settings.data;
  const activeProvider = provider ?? s?.provider ?? "lovable";
  const models = PROVIDER_MODELS[activeProvider] ?? [];
  const activeModel = model ?? (provider && provider !== s?.provider ? models[0]?.id : s?.model) ?? "";
  const keyStored = activeProvider !== "lovable" && s?.keys?.[activeProvider as "openai" | "anthropic"];

  async function onSave() {
    setBusy("save");
    try {
      await save({ data: { provider: activeProvider as "lovable", model: activeModel, apiKey } });
      setApiKey("");
      toast.success("Scoring model updated");
      qc.invalidateQueries({ queryKey: ["ai_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(null);
    }
  }

  async function onTest() {
    setBusy("test");
    try {
      const out = await test({ data: undefined });
      if (out.status === "ok") toast.success(out.message);
      else toast.error(out.message);
      qc.invalidateQueries({ queryKey: ["ai_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Test failed");
    } finally {
      setBusy(null);
    }
  }

  async function onClearKey() {
    setBusy("clear");
    try {
      await removeKey({ data: { provider: activeProvider as "openai" } });
      toast.success("API key removed");
      qc.invalidateQueries({ queryKey: ["ai_settings"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article className="panel p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Sparkles className="size-4 text-primary" />
        <h3 className="font-semibold">AI model for matching & scoring</h3>
        {s ? <StatusPill status={s.last_test_status} /> : null}
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Drives every AI step: JD drafting, resume parsing, JD↔CV skill mapping, LinkedIn narrative scoring and AI
        screening. Deterministic scoring (experience band, GitHub signals, weighted roll-up) never uses a model.
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label>Provider</Label>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={activeProvider}
            onChange={(e) => {
              setProvider(e.target.value);
              setModel(PROVIDER_MODELS[e.target.value]?.[0]?.id ?? "");
            }}
          >
            <option value="lovable">Built-in Lovable AI (Gemini + OpenAI, no key)</option>
            <option value="openai">OpenAI — your own API key</option>
            <option value="anthropic">Anthropic Claude — your own API key</option>
          </select>
        </div>

        <div className="space-y-1.5">
          <Label>Model</Label>
          <select
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={models.some((m) => m.id === activeModel) ? activeModel : "__custom"}
            onChange={(e) => setModel(e.target.value === "__custom" ? "" : e.target.value)}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="__custom">Other (type an exact model id)</option>
          </select>
        </div>

        {!models.some((m) => m.id === activeModel) && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Model id</Label>
            <Input value={activeModel} onChange={(e) => setModel(e.target.value)} placeholder="exact model id" />
          </div>
        )}

        {activeProvider !== "lovable" && (
          <div className="space-y-1.5 sm:col-span-2">
            <Label className="flex items-center gap-1.5">
              <KeyRound className="size-3.5" />
              {activeProvider === "openai" ? "OpenAI API key" : "Anthropic API key"}
            </Label>
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={keyStored ? "•••••••• stored — leave blank to keep" : "sk-…"}
            />
            <p className="text-xs text-muted-foreground">
              Stored server-side only; it is never returned to the browser.
            </p>
          </div>
        )}
      </div>

      {s?.last_test_message ? <p className="mt-3 text-xs text-muted-foreground">{s.last_test_message}</p> : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSave} disabled={busy !== null || !activeModel}>
          {busy === "save" ? <Loader2 className="size-3.5 animate-spin" /> : null} Save
        </Button>
        <Button size="sm" variant="outline" onClick={onTest} disabled={busy !== null}>
          {busy === "test" ? <Loader2 className="size-3.5 animate-spin" /> : null} Test model
        </Button>
        {keyStored ? (
          <Button size="sm" variant="ghost" onClick={onClearKey} disabled={busy !== null}>
            Remove key
          </Button>
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
        title="Integrations"
        description="Store each job board's API credentials, verify the connection live, and switch it on as a sourcing channel. Credentials are held server-side and are never sent to the browser."
      />

      <AiModelCard />

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
        <>
          <div className="grid gap-4">
            {(rows.data ?? []).filter((r) => r.category !== "meeting").map((row) => (
              <IntegrationCard key={row.id} row={row} />
            ))}
          </div>

          <section className="panel p-5">
            <h2 className="font-semibold">Interview meeting links</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect your own conferencing account and the scheduler will mint a real join link for every interview
              round — no copy-pasting. Credentials stay server-side.
            </p>
            <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
              <li>
                <strong className="text-foreground">Zoom</strong> — create a Server-to-Server OAuth app with the
                <span className="num"> meeting:write:admin</span> scope and paste the account ID, client ID and secret.
              </li>
              <li>
                <strong className="text-foreground">Google Calendar / Meet</strong> — an OAuth client plus a refresh
                token for the recruiting calendar; events are created with a Meet link and invites are emailed to the
                panel and candidate.
              </li>
              <li>
                <strong className="text-foreground">Microsoft Teams</strong> — an Entra app with
                <span className="num"> OnlineMeetings.ReadWrite.All</span> application permission and the organizer
                mailbox that hosts the calls.
              </li>
            </ul>
          </section>

          <div className="grid gap-4">
            {(rows.data ?? []).filter((r) => r.category === "meeting").map((row) => (
              <IntegrationCard key={row.id} row={row} />
            ))}
          </div>
        </>
      )}
    </>
  );
}
