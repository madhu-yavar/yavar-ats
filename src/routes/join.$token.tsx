/**
 * /join/<token> — the invitation accept page. The token arrives by email
 * (signed, 7 days) and proves mailbox ownership: setting the first password
 * here confirms the address, claims the membership with the invited role and
 * signs the user straight into their organisation.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { createServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";

import { verifyJoinToken, type JoinInviteView } from "@/lib/join.server";
import { PasswordInput } from "@/components/PasswordInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BrandFooter, BrandLogo } from "@/components/Brand";
import { PASSWORD_POLICY_HINT, passwordProblem } from "@/lib/password-policy";

export const Route = createFileRoute("/join/$token")({
  component: JoinPage,
});

const verifyTokenFn = createServerFn({ method: "GET" })
  .inputValidator((data: unknown) => z.object({ token: z.string().min(10) }).parse(data))
  .handler(async ({ data }) => {
    const { verifyJoinToken } = await import("@/lib/join.server");
    return verifyJoinToken(data.token);
  });

function JoinPage() {
  const { token } = Route.useParams();
  const fetchInvite = useServerFn(verifyTokenFn);

  const invite = useQuery({
    queryKey: ["join_invite", token],
    queryFn: () => fetchInvite({ data: { token } }),
    retry: false,
  });

  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const problem = passwordProblem(password);
    if (problem) {
      toast.error(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/auth/join", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password, fullName }),
      });
      const out = (await res.json()) as {
        ok?: boolean;
        existing?: boolean;
        message?: string;
        error?: string;
        orgName?: string;
      };
      if (!res.ok || !out.ok) throw new Error(out.error ?? "Joining did not work.");
      if (out.existing) {
        toast.success(out.message ?? "Invitation applied — sign in to continue.");
        window.location.assign("/?joined=1");
        return;
      }
      toast.success(`Welcome to ${out.orgName ?? "your organisation"}!`);
      setDone(true);
      window.location.assign("/");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setBusy(false);
    }
  }

  const shell = (inner: React.ReactNode) => (
    <div className="flex min-h-screen flex-col">
      <div className="flex flex-1 items-center justify-center px-4 py-12">{inner}</div>
      <BrandFooter />
    </div>
  );

  if (invite.isLoading) {
    return shell(
      <p className="text-sm text-muted-foreground">Loading invitation…</p>,
    );
  }

  if (invite.error || !invite.data) {
    return shell(
      <div className="panel max-w-md space-y-3 p-8 text-center">
        <BrandLogo className="mx-auto h-6" />
        <h1 className="text-lg font-semibold">This invitation link has expired</h1>
        <p className="text-sm text-muted-foreground">
          Ask your organisation administrator to send a fresh invitation, or sign in if you
          already have an account.
        </p>
        <Button asChild variant="outline">
          <a href="/">Back to ATSIQ</a>
        </Button>
      </div>,
    );
  }

  const view = invite.data as JoinInviteView;

  if (done) {
    return shell(
      <div className="panel max-w-md space-y-3 p-8 text-center">
        <BrandLogo className="mx-auto h-6" />
        <h1 className="text-lg font-semibold">You're in!</h1>
        <p className="text-sm text-muted-foreground">Taking you to {view.orgName}…</p>
      </div>,
    );
  }

  return shell(
    <div className="w-full max-w-md space-y-6">
      <div className="flex justify-center">
        <BrandLogo className="h-6" />
      </div>
      <div className="panel space-y-5 p-7">
        <div className="space-y-1">
          <p className="text-xs uppercase tracking-wide text-primary">Invitation</p>
          <h1 className="text-xl font-semibold">
            Join {view.orgName} as {view.roleLabel}
          </h1>
          <p className="text-sm text-muted-foreground">
            {view.inviterName ? `${view.inviterName} invited ` : "You were invited — "}
            <span className="font-medium text-foreground">{view.email}</span> to the
            talent-acquisition workspace. Set your password to activate your account.
          </p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="fullName">Full name</Label>
            <Input
              id="fullName"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Your name"
              autoComplete="name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Create password</Label>
            <PasswordInput
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="new-password"
              required
            />
            <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HINT}</p>
          </div>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Setting up your account…" : "Set password and join"}
          </Button>
        </form>
        <p className="text-xs text-muted-foreground">
          Already have an ATSIQ account for this address?{" "}
          <a href="/#signin" className="text-primary underline">
            Sign in
          </a>{" "}
          — the invitation applies automatically.
        </p>
      </div>
    </div>,
  );
}
