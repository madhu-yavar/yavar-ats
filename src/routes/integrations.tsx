import { createFileRoute } from "@tanstack/react-router";
import { queryOptions, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  CircleDashed,
  Inbox,
  KeyRound,
  Loader2,
  Plug,
  Sparkles,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import type { Tables } from "@/integrations/supabase/types";
import { disconnectIntegration, saveIntegration, testIntegration } from "@/lib/integrations.functions";
import { getAiSettings, removeAiKey, saveAiSettings, testAiModel } from "@/lib/ai-settings.functions";
import {
  disconnectLinkedIn,
  linkedinCapabilities,
  linkedinStatus,
  startLinkedInConnect,
} from "@/lib/linkedin.functions";
import { careersInboxStatus, importCareersInbox } from "@/lib/inbox.functions";
import { orgInbox } from "@/lib/local-inbox.functions";

import { collectApplicants, type CollectSummary } from "@/lib/collect.functions";
import { captureSetup, rotateCaptureToken } from "@/lib/capture.functions";
import { PageHeader } from "@/components/ats";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
    who: "Nothing technical for HR. One person connects the company's LinkedIn account; everyone publishes job posts through it.",
    minutes: "Under a minute",
    links: [],
    steps: [
      "Check that the panel above shows a green “Connected” tick — that is the one-time sign-in, already done for your company.",
      "Open any approved requisition, press “Design post”, then “Publish to LinkedIn”. That is the whole job.",
      "Each post carries your ATSIQ apply link, so CVs sent from LinkedIn arrive in the talent pool and the role's pipeline on their own — read, scored and ready, with nothing to download.",
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
 * Your organisation's own LinkedIn account. An admin presses Connect once,
 * signs in on LinkedIn's own screen, and every job post from this workspace
 * goes out from that account. Nothing to paste, and no other company's account
 * is ever involved.
 */
/** Copy-ready note HR can send to their LinkedIn account manager. */
const LINKEDIN_REQUEST = `Subject: Request to enable Job Posting and Applicant data access on our LinkedIn contract

Hello,

We use an applicant tracking system (ATSIQ) alongside our LinkedIn Recruiter seats. Our LinkedIn account is already
authorised in the system and we can publish posts from it.

Two products are not on our contract, and LinkedIn currently returns "not found" for both:

1. Job Posting — to publish our roles as structured job listings on the LinkedIn Jobs board.
2. Applicant / candidate data access (Talent Solutions) — to receive applicants and their CVs directly into our ATS.

Please confirm what is required to add these to our contract: the products, the commercial terms, and any partner
programme application or security review we need to complete. We are ready to provide company details, use case and
technical contacts.

Thank you,
[Your name] — [Company] — [Contact number]`;

function LinkedinOneClick() {

  const qc = useQueryClient();
  const start = useServerFn(startLinkedInConnect);
  const drop = useServerFn(disconnectLinkedIn);
  const [busy, setBusy] = useState(false);
  const [awaiting, setAwaiting] = useState(false);
  const collect = useServerFn(collectApplicants);
  const [collecting, setCollecting] = useState(false);
  const [summary, setSummary] = useState<CollectSummary | null>(null);

  async function onCollect() {
    setCollecting(true);
    setSummary(null);
    try {
      const result = await collect({ data: {} });
      setSummary(result);
      toast.success(
        `${result.imported + result.updated} CV(s) filed · ${result.scored} scored and ready`,
      );
      qc.invalidateQueries({ queryKey: ["applications"] });
      qc.invalidateQueries({ queryKey: ["match_scores"] });
      qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not collect applicants");
    } finally {
      setCollecting(false);
    }
  }

  const status = useQuery({
    queryKey: ["linkedin_connect"],
    queryFn: () => linkedinStatus({ data: undefined }),
    refetchOnWindowFocus: true,
    refetchInterval: awaiting ? 4000 : false,
  });
  const s = status.data;

  const caps = useQuery({
    queryKey: ["linkedin_caps"],
    queryFn: () => linkedinCapabilities({ data: undefined }),
    enabled: Boolean(s?.connected),
  });

  useEffect(() => {
    if (awaiting && s?.connected) {
      setAwaiting(false);
      toast.success("LinkedIn connected for your organisation");
    }
  }, [awaiting, s?.connected]);

  // The sign-in returns to /integrations?linkedin=connected|error
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("linkedin");
    if (!outcome) return;
    if (outcome === "connected") toast.success("LinkedIn connected for your organisation");
    else toast.error(params.get("detail") ?? "LinkedIn sign-in did not complete");
    window.history.replaceState({}, "", "/integrations");
    qc.invalidateQueries({ queryKey: ["linkedin_connect"] });
  }, [qc]);

  async function onConnect() {
    setBusy(true);
    // LinkedIn refuses to load inside an embedded frame, so the sign-in must
    // always happen in a real browser tab of its own. Do not pass `noopener`
    // here: browsers then intentionally return `null`, which leaves the newly
    // opened tab stranded on about:blank before the async URL is available.
    const tab = window.open("", "atsiq-linkedin-connect");
    if (tab) {
      tab.document.title = "Opening LinkedIn…";
      tab.document.body.textContent = "Opening LinkedIn sign-in…";
    }
    try {
      const { url } = await start({ data: { origin: window.location.origin } });
      if (tab) {
        tab.location.replace(url);
        setAwaiting(true);
      } else if (window.top) {
        window.top.location.href = url;
      } else {
        window.location.href = url;
      }
    } catch (e) {
      tab?.close();
      toast.error(e instanceof Error ? e.message : "Could not start LinkedIn sign-in");
    } finally {
      setBusy(false);
    }
  }


  async function onDisconnect() {
    setBusy(true);
    try {
      await drop({ data: undefined });
      toast.success("LinkedIn disconnected");
      qc.invalidateQueries({ queryKey: ["linkedin_connect"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not disconnect");
    } finally {
      setBusy(false);
    }
  }

  const body = status.isLoading
    ? "Checking your LinkedIn connection…"
    : !s?.configured
      ? "LinkedIn sign-in is not switched on for this platform yet — ask your ATSIQ administrator."
      : s.connected
        ? `Connected as ${s.member ?? "your company's LinkedIn account"}${s.memberEmail ? ` (${s.memberEmail})` : ""}. Job posts from this workspace go out from this account.`
        : "Press Connect LinkedIn, sign in with your company's LinkedIn Recruiter account, and you're done — one time, for your whole team.";

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Your organisation's LinkedIn account
        </div>
        {s?.connected ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="size-3.5" /> Connected{s.member ? ` — ${s.member}` : ""}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CircleDashed className="size-3.5" /> Not connected
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {awaiting ? (
        <p className="mt-2 inline-flex items-center gap-2 text-sm text-primary">
          <Loader2 className="size-4 animate-spin" /> Waiting for you to finish signing in on the LinkedIn tab that
          just opened — you can close it once LinkedIn says you're done.
        </p>
      ) : null}


      {s?.connected ? (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">What this account can do</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => caps.refetch()}
              disabled={caps.isFetching}
            >
              {caps.isFetching ? <Loader2 className="size-4 animate-spin" /> : null} Re-check
            </Button>
          </div>
          {caps.isLoading ? (
            <p className="mt-2 text-sm text-muted-foreground">Asking LinkedIn what your seat allows…</p>
          ) : caps.error ? (
            <p className="mt-2 text-sm text-destructive">
              {caps.error instanceof Error ? caps.error.message : "Could not check this account."}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {(caps.data ?? []).map((c) => (
                <li key={c.id} className="flex gap-2 text-sm">
                  {c.ready === true ? (
                    <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
                  ) : c.ready === false ? (
                    <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  ) : (
                    <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span>
                    <span className="font-medium">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {s?.connected && (caps.data ?? []).some((c) => c.ready === false) ? (
        <details className="mt-3 rounded-lg border border-border bg-background p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Ask LinkedIn to switch on the missing pieces — ready-to-send note
          </summary>
          <p className="mt-2 text-xs text-muted-foreground">
            A Recruiter seat on its own does not include the job-posting or applicant products. Only LinkedIn can add
            them to your contract, so send this to your LinkedIn account manager. Everything else in ATSIQ keeps
            working while you wait.
          </p>
          <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-xs">
{LINKEDIN_REQUEST}
          </pre>
          <Button
            size="sm"
            variant="outline"
            className="mt-2"
            onClick={() => {
              navigator.clipboard.writeText(LINKEDIN_REQUEST);
              toast.success("Request copied — paste it into your email to LinkedIn");
            }}
          >
            Copy request
          </Button>
        </details>
      ) : null}


      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onConnect} disabled={busy || !s?.configured}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {s?.connected ? "Reconnect LinkedIn" : "Connect LinkedIn"}
        </Button>
        {s?.connected ? (
          <Button size="sm" variant="outline" onClick={onCollect} disabled={collecting}>
            {collecting ? <Loader2 className="size-4 animate-spin" /> : <Inbox className="size-4" />}
            {collecting ? "Collecting CVs and scoring…" : "Collect CVs from live posts"}
          </Button>
        ) : null}
        {s?.connected ? (
          <Button size="sm" variant="ghost" onClick={onDisconnect} disabled={busy}>
            Disconnect
          </Button>
        ) : null}
      </div>

      {summary ? (
        <div className="mt-3 rounded-lg border border-border bg-background p-3 text-sm">
          <p className="font-medium">
            {summary.imported} new · {summary.updated} updated · {summary.scored} scored and ready
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Read {summary.scanned} incoming message(s); {summary.skipped} had no readable CV.
            {summary.importErrors || summary.scoreErrors
              ? ` ${summary.importErrors + summary.scoreErrors} needed attention.`
              : ""}
          </p>
          {summary.top.length ? (
            <ul className="mt-2 space-y-1 text-xs">
              {summary.top.map((t) => (
                <li key={`${t.candidate}-${t.requisition}`}>
                  <span className="font-medium">{t.candidate}</span> — {t.requisition} ·{" "}
                  <span className="text-primary">{t.score}/100</span>
                </li>
              ))}
            </ul>
          ) : null}
          {summary.mailboxNote ? (
            <p className="mt-2 text-xs text-amber-600">{summary.mailboxNote}</p>
          ) : null}
          {summary.linkedinNote ? (
            <p className="mt-1 text-xs text-muted-foreground">{summary.linkedinNote}</p>
          ) : null}
        </div>
      ) : null}

      <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-muted-foreground">
        <li>
          Each organisation connects its own account. Your posts, and the applications they bring in, stay inside
          your workspace.
        </li>
        <li>
          CVs come back automatically: through the apply link inside each post, and through the careers mailbox
          import below, which reads LinkedIn application emails and files the attached CVs on its own.
        </li>
        <li>
          Reading other people's LinkedIn profiles directly needs a paid LinkedIn Talent Solutions data agreement —
          a Recruiter seat alone does not include it. Use the request below to start that with LinkedIn.
        </li>
      </ul>

      <details className="mt-3 rounded-lg border border-border bg-background p-3">
        <summary className="cursor-pointer text-xs font-medium">
          Ask LinkedIn to switch on data access for ATSIQ — ready-to-send request
        </summary>
        <pre className="mt-3 whitespace-pre-wrap rounded-md bg-surface-2 p-3 text-[11px] leading-relaxed text-muted-foreground">
{LINKEDIN_ACCESS_REQUEST}
        </pre>
        <Button
          size="sm"
          variant="outline"
          className="mt-3"
          onClick={() => {
            void navigator.clipboard.writeText(LINKEDIN_ACCESS_REQUEST);
            toast.success("Request copied — send it to your LinkedIn account manager");
          }}
        >
          Copy request
        </Button>
      </details>
    </div>
  );
}


const LINKEDIN_ACCESS_REQUEST = `Subject: Recruiter System Connect / Talent Solutions data access for our ATS

Hello,

We run a paid LinkedIn Recruiter contract for our organisation and we have now
moved our hiring onto ATSIQ, our applicant tracking system.

We would like to enable data access on our contract so that ATSIQ can:
  - read applications and attached CVs from job posts we publish,
  - sync candidate stage and status back into Recruiter (Recruiter System Connect),
  - keep InMail and pipeline activity visible alongside our own records.

Please confirm:
  1. what is included in our current contract and what needs to be added,
  2. the approval steps and expected timeline for our ATS to be enabled,
  3. any partner registration LinkedIn requires on the ATS vendor side.

Our recruiting team is ready to complete whatever LinkedIn needs from our end.

Thank you,
[Your name] — [Title], [Company]`;

/**
 * Careers mailbox auto-import. The mailbox is authorised once, centrally; from
 * then on every application email — LinkedIn, job boards, direct applicants —
 * has its CV read, parsed and filed against the matching open role by itself.
 */
function CareersInboxPanel() {
  const mine = useQuery({
    queryKey: ["org_inbox"],
    queryFn: () => orgInbox({ data: undefined }),
    refetchOnWindowFocus: false,
  });
  const status = useQuery({
    queryKey: ["careers_inbox"],
    queryFn: () => careersInboxStatus({ data: undefined }),
    refetchOnWindowFocus: false,
  });
  const runImport = useServerFn(importCareersInbox);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Awaited<ReturnType<typeof importCareersInbox>> | null>(null);
  const s = status.data;
  const address = mine.data?.address ?? null;

  async function onImport() {
    setBusy(true);
    try {
      const r = await runImport({ data: {} });
      setResult(r);
      toast.success(`${r.imported} new, ${r.updated} updated from ${r.scanned} emails`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Import failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Inbox className="size-4 text-primary" />
          Your careers mailbox
        </div>
        {mine.isLoading ? (
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Loader2 className="size-3.5 animate-spin" /> Checking
          </span>
        ) : address ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="size-3.5" /> Live
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CircleDashed className="size-3.5" /> Not ready
          </span>
        )}
      </div>

      {address ? (
        <>
          <p className="mt-2 text-sm text-muted-foreground">
            Your organisation has its own address. Put it on your LinkedIn posts and job-board alerts, or forward
            application mail to it, and every attached CV is read, filed against the right role and scored on its own.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <code className="rounded-md border border-border bg-background px-2.5 py-1.5 text-sm">{address}</code>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                navigator.clipboard.writeText(address);
                toast.success("Address copied");
              }}
            >
              Copy address
            </Button>
          </div>
          <p className="num mt-3 text-xs text-muted-foreground">
            {mine.data?.counts.total ?? 0} mails received · {mine.data?.counts.imported ?? 0} new candidates ·{" "}
            {mine.data?.counts.updated ?? 0} refreshed · {mine.data?.counts.errors ?? 0} need a look
          </p>
        </>
      ) : (
        <p className="mt-2 text-sm text-muted-foreground">
          Your careers address is created with your organisation. If it is missing, ask your ATSIQ administrator to
          finish onboarding for this workspace.
        </p>
      )}

      {s?.error ? <p className="mt-2 text-xs text-amber-600">{s.error}</p> : null}

      {s?.connected ? (
        <Button size="sm" variant="outline" className="mt-3" onClick={onImport} disabled={busy}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null} Also import from {s.email}
        </Button>
      ) : null}


      {result ? (
        <div className="mt-3 rounded-md border border-border bg-background p-3">
          <p className="num text-xs text-muted-foreground">
            {result.scanned} emails scanned · {result.imported} new candidates · {result.updated} refreshed ·{" "}
            {result.skipped} skipped · {result.errors} failed
          </p>
          {result.outcomes.length ? (
            <ul className="mt-2 space-y-1 text-xs">
              {result.outcomes.slice(0, 20).map((o, i) => (
                <li key={i} className="flex flex-wrap gap-x-2 text-muted-foreground">
                  <span className="font-medium text-foreground">{o.status}</span>
                  <span className="truncate">{o.detail}</span>
                  {o.requisition ? <span>→ {o.requisition}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Browser companion. The recruiter stays signed in on the job board in their
 * own browser; one press sends the page they are reading — a CV or a job
 * description — into ATSIQ, where it is parsed, filed and scored.
 */
function CapturePanel() {
  const qc = useQueryClient();
  const setup = useQuery({
    queryKey: ["capture_setup"],
    queryFn: () => captureSetup({ data: undefined }),
    refetchOnWindowFocus: false,
  });
  const rotate = useServerFn(rotateCaptureToken);
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = setup.data;

  async function onRotate() {
    setBusy(true);
    try {
      const next = await rotate({ data: undefined });
      qc.setQueryData(["capture_setup"], next);
      toast.success("New capture key issued — update it in the companion.");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not issue a new key");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    fetch("/atsiq-capture.zip")
      .then((res) => {
        if (!res.ok) throw new Error(`Download failed: ${res.status}`);
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "atsiq-capture.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err) => toast.error(err.message));
  }

  return (
    <div className="mt-4 rounded-lg border bg-surface-2/40 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Plug className="size-4 text-primary" />
          Grab a page from your own browser
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={download}>
            Download the companion
          </Button>
          <Button size="sm" variant="ghost" onClick={onRotate} disabled={busy}>
            {busy ? <Loader2 className="mr-1.5 size-3.5 animate-spin" /> : null}
            New key
          </Button>
        </div>
      </div>

      <p className="mt-2 text-sm text-muted-foreground">
        Stay signed in to LinkedIn Recruiter or any job board as you normally do. Looking at a single CV or
        job description, press the companion once and it comes across. On a Recruiter applicant list, press
        <span className="font-medium text-foreground"> Start sweep</span> instead: the job becomes a role
        here, then each applicant is opened in turn in your own browser, read, de-duplicated, matched and
        scored — up to 25 per run, at a deliberately slow human pace, with a live count and a Stop button.
        Your sign-in never leaves your machine and nothing runs unattended.
      </p>


      <div className="mt-3 grid gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-muted-foreground">Capture key</span>
          <code className="rounded bg-surface-2 px-2 py-1 font-mono">
            {data?.token ? (reveal ? data.token : "•".repeat(24)) : "—"}
          </code>
          <Button size="sm" variant="ghost" onClick={() => setReveal((v) => !v)}>
            {reveal ? "Hide" : "Show"}
          </Button>
          {data?.token ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void navigator.clipboard.writeText(data.token ?? "");
                toast.success("Capture key copied");
              }}
            >
              Copy
            </Button>
          ) : null}
        </div>
        <p className="text-muted-foreground">
          Paste it into the companion together with your ATSIQ address. Treat it like a password — anyone
          holding it can add candidates to your workspace.
        </p>
      </div>

      <ol className="mt-3 list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        <li>Download and unzip the companion (re-download it if you installed an older copy).</li>
        <li>Open chrome://extensions and turn on Developer mode.</li>
        <li>Choose “Load unpacked” and pick the unzipped folder.</li>
        <li>Open it once, paste your ATSIQ address and the key above, and save.</li>
        <li>
          In LinkedIn Recruiter open a job, choose the applicants view, then press Start sweep in the
          companion.
        </li>
      </ol>


      {data?.events.length ? (
        <div className="mt-3 rounded-md border bg-background p-3">
          <p className="text-xs font-medium">Recently captured</p>
          <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
            {data.events.slice(0, 8).map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-surface-2 px-1.5 py-0.5 uppercase tracking-wide">
                  {e.kind === "cv" ? "CV" : "Role"}
                </span>
                <span className="font-medium text-foreground">{e.title ?? "Untitled"}</span>
                <span>{e.detail}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
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
  // Collapsed by default so the page reads as a short, calm list.
  const [expanded, setExpanded] = useState(false);

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
    <article className="panel p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={() => setExpanded((v) => !v)} className="flex min-w-0 items-center gap-2 text-left">
          <ChevronDown className={`size-4 shrink-0 text-muted-foreground transition-transform ${expanded ? "" : "-rotate-90"}`} />
          <Plug className="size-4 shrink-0 text-primary" />
          <span className="truncate font-medium">{row.label}</span>
          <StatusPill status={row.last_test_status} />
        </button>
        <div className="flex items-center gap-2">
          {row.has_credentials ? (
            <span title="Credentials stored" className="text-muted-foreground">
              <KeyRound className="size-3.5" />
            </span>
          ) : null}
          <Label className="text-xs text-muted-foreground">On</Label>
          <Switch checked={enabled} onCheckedChange={setEnabled} />
        </div>
      </div>

      {expanded ? (
        <div className="mt-4 border-t border-border pt-4">
          {notes ? <p className="text-sm text-muted-foreground">{notes}</p> : null}
          {row.last_test_message ? (
            <p className="mt-2 rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">{row.last_test_message}</p>
          ) : null}
          {row.last_tested_at ? (
            <p className="num mt-2 text-xs text-muted-foreground">
              last tested {new Date(row.last_tested_at).toLocaleString()}
            </p>
          ) : null}

          {provider === "linkedin" ? <LinkedinOneClick /> : null}
          {provider === "linkedin" || provider === "careers" ? <CareersInboxPanel /> : null}
          {provider === "linkedin" || provider === "careers" ? <CapturePanel /> : null}

          <SetupHelp provider={provider} label={row.label} />

          {row.credential_fields.length && provider !== "linkedin" ? (
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
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {provider !== "linkedin" ? (
              <>
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
              </>
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
        </div>
      ) : null}
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
        description="Connect the places your CVs and interviews come from. Open a row only when you need to change it — everything you type is stored securely on the server."
      />

      <Tabs defaultValue="sourcing">
        <TabsList>
          <TabsTrigger value="sourcing">Candidate sources</TabsTrigger>
          <TabsTrigger value="meetings">Interview meetings</TabsTrigger>
          <TabsTrigger value="ai">AI model</TabsTrigger>
        </TabsList>

        <TabsContent value="sourcing" className="space-y-3">
          {rows.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            (rows.data ?? [])
              .filter((r) => r.category !== "meeting")
              .map((row) => <IntegrationCard key={row.id} row={row} />)
          )}
          <details className="panel p-4 text-sm text-muted-foreground">
            <summary className="cursor-pointer font-medium text-foreground">What each source can do</summary>
            <ul className="mt-3 space-y-1.5">
              <li>
                <strong className="text-foreground">LinkedIn</strong> — sign in once as a company; job posts publish
                from a requisition and applicants arrive through your apply link.
              </li>
              <li>
                <strong className="text-foreground">Careers inbox</strong> — CVs emailed to your careers address are
                filed, read and scored automatically.
              </li>
              <li>
                <strong className="text-foreground">Naukri / Indeed</strong> — need an employer subscription; paste the
                keys your account manager sends.
              </li>
              <li>
                <strong className="text-foreground">GitHub</strong> — works without setup; a token only makes it
                faster.
              </li>
            </ul>
          </details>
        </TabsContent>

        <TabsContent value="meetings" className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Connect one conferencing account and every interview gets a real join link and calendar invite.
          </p>
          {rows.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            (rows.data ?? [])
              .filter((r) => r.category === "meeting")
              .map((row) => <IntegrationCard key={row.id} row={row} />)
          )}
        </TabsContent>

        <TabsContent value="ai">
          <AiModelCard />
        </TabsContent>
      </Tabs>
    </>
  );
}

