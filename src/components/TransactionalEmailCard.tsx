import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { MailCheck, RotateCcw } from "lucide-react";

import {
  clearPlatformEmailConfig,
  getPlatformEmailConfig,
  sendPlatformTestEmail,
  setPlatformEmailConfig,
} from "@/lib/platform.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/PasswordInput";

/**
 * Transactional email (registration confirmations, invites, password resets,
 * candidate notifications) — deployment-level config, shown to platform super
 * admins on the Integrations page. The pasted provider key is stored encrypted
 * and takes precedence over the RESEND_API_KEY env var, so activating or
 * rotating email never needs a redeploy.
 */
export function TransactionalEmailCard() {
  const qc = useQueryClient();
  const fetchConfig = useServerFn(getPlatformEmailConfig);
  const saveConfig = useServerFn(setPlatformEmailConfig);
  const clearConfig = useServerFn(clearPlatformEmailConfig);
  const sendTest = useServerFn(sendPlatformTestEmail);

  const [apiKey, setApiKey] = useState("");
  const [fromAddress, setFromAddress] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const config = useQuery({
    queryKey: ["platform_email_config"],
    queryFn: () => fetchConfig({}),
  });

  // Prefill the From field once data arrives (never clobber while typing).
  useEffect(() => {
    const saved = config.data?.fromAddress;
    if (saved) setFromAddress((cur) => cur || saved);
  }, [config.data]);

  async function act(key: string, fn: () => Promise<string>) {
    setBusy(key);
    try {
      toast.success(await fn());
      qc.invalidateQueries({ queryKey: ["platform_email_config"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  const c = config.data;
  const sourceNote =
    c?.source === "saved"
      ? `Active: key saved by a platform super user (••••${c.keyLast4}) — overrides the environment variable.`
      : c?.source === "env"
        ? `Active: RESEND_API_KEY environment variable (••••${c.keyLast4}). Save a key here to override it.`
        : "No email transport is active — registration confirmations, invitations and password resets cannot send.";

  return (
    <section className="panel space-y-3 p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <MailCheck className="size-4 text-muted-foreground" /> Transactional email
      </h2>
      <p className="max-w-2xl text-sm text-muted-foreground">
        Delivers registration confirmations, team invitations, password resets and candidate
        notifications for the whole platform. Paste the API key from your email provider&apos;s
        dashboard (the sending domain must be verified there first — see DEPLOYMENT-GCP.md). The key
        is stored encrypted and never shown again.
      </p>

      <div
        className={`rounded-md border p-3 text-xs ${
          c?.source === "none"
            ? "border-destructive/40 bg-destructive/5 text-destructive"
            : "border-border bg-muted/30 text-muted-foreground"
        }`}
      >
        {config.isLoading ? "Checking email configuration…" : sourceNote}
        {c?.updatedAt ? (
          <span className="ml-1">Last saved {new Date(c.updatedAt).toLocaleString()}.</span>
        ) : null}
      </div>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (!apiKey.trim()) {
            toast.error("Paste the API key first.");
            return;
          }
          void act("email-save", async () => {
            await saveConfig({ data: { apiKey, fromAddress } });
            setApiKey("");
            return "Email credential saved — use “Send test email” to verify delivery";
          });
        }}
      >
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="resend-api-key">
            API key
          </label>
          <PasswordInput
            id="resend-api-key"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="re_…"
            autoComplete="off"
            className="w-72"
          />
        </div>
        <div className="space-y-1">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="email-from">
            From address
          </label>
          <Input
            id="email-from"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            placeholder="ATSIQ <noreply@atsiq.yavar.ai>"
            className="w-80"
          />
        </div>
        <Button type="submit" disabled={busy === "email-save"}>
          Save key
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={busy === "email-test" || c?.source === "none"}
          onClick={() =>
            void act("email-test", async () => {
              const res = await sendTest({});
              return `Test email sent to ${res.to} — check the inbox`;
            })
          }
        >
          Send test email
        </Button>
        {c?.source === "saved" ? (
          <Button
            type="button"
            variant="ghost"
            disabled={busy === "email-clear"}
            onClick={() =>
              void act("email-clear", async () => {
                await clearConfig({});
                setFromAddress("");
                return "Saved key removed — the environment variable (if any) is active again";
              })
            }
          >
            <RotateCcw className="size-4" /> Remove saved key
          </Button>
        ) : null}
      </form>
    </section>
  );
}
