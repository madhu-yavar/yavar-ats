/**
 * One-press connect for the credential boards (Naukri / Indeed) — the
 * counterpart of LinkedinOneClick for boards whose partner APIs authenticate
 * server-to-server instead of through a browser sign-in. Connect saves the
 * keys typed on the card, verifies them against the board's own token
 * endpoint, and reports what the connection can actually do (honest
 * adapter detail strings — never a fake green tick for an unprovisioned
 * contract). Disconnect is the same privileged, audited credential removal
 * the card has always had.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  CircleAlert,
  CircleDashed,
  Copy,
  Loader2,
  Plug,
  Sparkles,
} from "lucide-react";

import { boardConnectionStatus, type BoardConnectStatus } from "@/lib/boards.functions";
import {
  disconnectIntegration,
  saveIntegration,
  testIntegration,
} from "@/lib/integrations.functions";
import { Button } from "@/components/ui/button";

type Caps = NonNullable<BoardConnectStatus["caps"]>;

/** Copy-ready note HR can send to their Naukri account manager. */
const NAUKRI_REQUEST = `Subject: Request: Resdex / Recruiter API credentials for our ATS

Hello,

We run our hiring on ATSIQ, our applicant tracking system, and would like to
connect it to our Naukri employer account so that:

  - our jobs publish as structured listings on Naukri,
  - applicants Naukri delivers arrive in ATSIQ directly,
  - our team can pull matching Resdex profiles against open roles.

Please share the enterprise API pack for our account:
  1. client ID, client secret and our recruiter account ID,
  2. the API base URL and the token endpoint,
  3. the job-posting and applications endpoints our contract includes,
  4. where to register our application-delivery (webhook) callback URL.

We are ready to complete any partner agreement or security review required.

Thank you,
[Your name] — [Company] — [Contact number]`;

/** Copy-ready note HR can send to Indeed to get the employer API enabled. */
const INDEED_REQUEST = `Subject: Request: Indeed Apply / partner API access for our ATS

Hello,

We run our hiring on ATSIQ, our applicant tracking system, and would like to
connect it to our Indeed employer account so that:

  - applicants from our Indeed jobs apply through Indeed Apply and arrive in
    ATSIQ directly,
  - our jobs sync as structured listings on Indeed.

Please enable for our account:
  1. the OAuth client ID and client secret for server-to-server access,
  2. our employer ID,
  3. where to register ATSIQ's application-delivery (apply endpoint) URL,
  4. the job-posting and applications endpoints our contract includes.

We are ready to complete any partner agreement or security review required.

Thank you,
[Your name] — [Company] — [Contact number]`;

const REQUESTS: Record<"naukri" | "indeed", { note: string; text: string }> = {
  naukri: {
    note: "Only Naukri can provision the enterprise API on your contract, so send this to your Naukri account manager. Everything else in ATSIQ keeps working while you wait.",
    text: NAUKRI_REQUEST,
  },
  indeed: {
    note: "Only Indeed can enable the employer API on your account, so send this to your Indeed partner contact. Everything else in ATSIQ keeps working while you wait.",
    text: INDEED_REQUEST,
  },
};

function CapRow({
  ready,
  label,
  detail,
}: {
  ready: boolean | null;
  label: string;
  detail: string;
}) {
  return (
    <li className="flex gap-2 text-sm">
      {ready === true ? (
        <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
      ) : ready === false ? (
        <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" />
      ) : (
        <CircleDashed className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
      )}
      <span>
        <span className="font-medium">{label}</span>
        <span className="block text-xs text-muted-foreground">{detail}</span>
      </span>
    </li>
  );
}

export function BoardConnectPanel({
  provider,
  label,
  integrationId,
  hasCredentials,
  lastTestStatus,
  lastTestMessage,
  config,
  baseUrl,
  secrets,
  onSecretsSaved,
}: {
  provider: "naukri" | "indeed";
  label: string;
  integrationId: string;
  hasCredentials: boolean;
  lastTestStatus: string;
  lastTestMessage: string | null;
  /** The card's current config object — re-persisted so extra keys survive. */
  config: Record<string, unknown>;
  baseUrl: string;
  /** Values typed into the card's credential boxes but not saved yet. */
  secrets: Record<string, string>;
  onSecretsSaved: () => void;
}) {
  const qc = useQueryClient();
  const save = useServerFn(saveIntegration);
  const test = useServerFn(testIntegration);
  const drop = useServerFn(disconnectIntegration);
  const [busy, setBusy] = useState<"connect" | "disconnect" | null>(null);

  const connected = hasCredentials && lastTestStatus === "ok";

  const status = useQuery({
    queryKey: ["board_connect", provider],
    queryFn: () => boardConnectionStatus({ data: { provider } }),
    enabled: hasCredentials,
  });

  const caps: Caps | null = status.data?.caps ?? null;

  async function onConnect() {
    setBusy("connect");
    try {
      // Typed-but-unsaved values are the #1 cause of a "not fully configured"
      // failure, so persist them first and then verify what is actually stored.
      // Connecting also switches the connection on — that is what the press means.
      const pending = Object.values(secrets).some((v) => v.trim().length > 0);
      if (pending || !hasCredentials || lastTestStatus !== "ok") {
        await save({
          data: {
            integrationId,
            provider,
            enabled: true,
            config: { ...config, base_url: baseUrl } as Record<string, string>,
            secrets,
          },
        });
        onSecretsSaved();
      }
      const outcome = await test({ data: { integrationId, provider } });
      if (outcome.status === "ok") toast.success(`${label} connected — ${outcome.message}`);
      else if (outcome.status === "pending") toast.warning(outcome.message);
      else toast.error(outcome.message);
      await qc.invalidateQueries({ queryKey: ["source_integrations"] });
      await qc.invalidateQueries({ queryKey: ["board_connect", provider] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not connect this board");
    } finally {
      setBusy(null);
    }
  }

  async function onDisconnect() {
    setBusy("disconnect");
    try {
      await drop({ data: { integrationId } });
      toast.success(`${label} disconnected`);
      await qc.invalidateQueries({ queryKey: ["source_integrations"] });
      await qc.invalidateQueries({ queryKey: ["board_connect", provider] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Disconnect failed");
    } finally {
      setBusy(null);
    }
  }

  const request = REQUESTS[provider];
  const body = connected
    ? `${label} is connected for your organisation. Job posts can go out on this board and the applications it delivers arrive in your pipeline on their own.`
    : hasCredentials
      ? "Credentials are stored but the board has not accepted them yet. Press Connect to verify, or check the message below."
      : `Paste the ${provider === "naukri" ? "client ID, client secret and account ID" : "client ID, client secret and employer ID"} from your partner onboarding pack below, then press Connect ${provider === "naukri" ? "Naukri" : "Indeed"} — one press saves the keys and verifies them against the board.`;

  return (
    <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Sparkles className="size-4 text-primary" />
          Your organisation&apos;s {provider === "naukri" ? "Naukri" : "Indeed"} connection
        </div>
        {connected ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
            <CheckCircle2 className="size-3.5" /> Connected
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <CircleDashed className="size-3.5" /> Not connected
          </span>
        )}
      </div>

      <p className="mt-2 text-sm text-muted-foreground">{body}</p>
      {!connected && lastTestMessage ? (
        <p className="mt-2 rounded-md bg-surface-2 p-3 text-xs text-muted-foreground">
          {lastTestMessage}
        </p>
      ) : null}

      {/* hasCredentials (fresh row prop) gates this too: after Disconnect the
          query disables itself and its cached caps would otherwise linger. */}
      {(connected || caps || status.data?.capsError) && status.data?.enabled && hasCredentials ? (
        <div className="mt-3 rounded-lg border border-border bg-background p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium">What this connection can do</p>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => status.refetch()}
              disabled={status.isFetching}
            >
              {status.isFetching ? <Loader2 className="size-4 animate-spin" /> : null} Re-check
            </Button>
          </div>
          {status.data?.capsError ? (
            <p className="mt-2 text-sm text-destructive">{status.data.capsError}</p>
          ) : caps ? (
            <ul className="mt-2 space-y-2">
              <CapRow
                ready={caps.posting}
                label="Structured job postings"
                detail={
                  caps.posting === true
                    ? "Approved requisitions can be filed on this board's Jobs surface."
                    : caps.detail
                }
              />
              <CapRow
                ready={caps.applications}
                label={
                  caps.applicationsMode === "webhook"
                    ? "Applications by webhook delivery"
                    : caps.applicationsMode === "polling"
                      ? "Applications by scheduled pull"
                      : "Applications"
                }
                detail={caps.detail}
              />
            </ul>
          ) : null}
        </div>
      ) : null}

      <details className="mt-3 rounded-lg border border-border bg-background p-3">
        <summary className="cursor-pointer text-sm font-medium">
          Ask {provider === "naukri" ? "Naukri" : "Indeed"} for the connection — ready-to-send note
        </summary>
        <p className="mt-2 text-xs text-muted-foreground">{request.note}</p>
        <pre className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-surface-2 p-3 text-xs">
          {request.text}
        </pre>
        <Button
          size="sm"
          variant="outline"
          className="mt-2"
          onClick={() => {
            navigator.clipboard.writeText(request.text);
            toast.success(
              `Request copied — send it to your ${provider === "naukri" ? "Naukri" : "Indeed"} account manager`,
            );
          }}
        >
          <Copy className="size-3.5" /> Copy request
        </Button>
      </details>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onConnect} disabled={busy !== null}>
          {busy === "connect" ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <Plug className="size-4" />
          )}
          {connected
            ? `Reconnect ${provider === "naukri" ? "Naukri" : "Indeed"}`
            : `Connect ${provider === "naukri" ? "Naukri" : "Indeed"}`}
        </Button>
        {hasCredentials ? (
          <Button size="sm" variant="ghost" onClick={onDisconnect} disabled={busy !== null}>
            {busy === "disconnect" ? <Loader2 className="size-4 animate-spin" /> : null}
            Disconnect
          </Button>
        ) : null}
      </div>
    </div>
  );
}
