import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { authApplyReset } from "@/lib/auth-client";
import { BrandFooter, BrandLogo } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/reset")({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? search["token"] : "",
  }),
  component: ResetPage,
  head: () => ({
    meta: [
      { title: "Choose a new password | ATSIQ" },
      {
        name: "description",
        content: "Set a new password for your ATSIQ recruiting workspace account.",
      },
      { property: "og:title", content: "Choose a new password | ATSIQ" },
      {
        property: "og:description",
        content: "Set a new password for your ATSIQ recruiting workspace account.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
});

function ResetPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      await authApplyReset(token, password);
      setDone(true);
      toast.success("Password updated. Sign in with your new password.");
      setTimeout(() => void navigate({ to: "/" }), 1200);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 px-6 py-16">
      <BrandLogo />
      <form onSubmit={submit} className="panel w-full max-w-md space-y-5 p-7 shadow-lg">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            {token
              ? "Your reset link is single-use and expires an hour after it was sent."
              : "This link is missing its reset code. Request a new one from the sign-in screen."}
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            required
            minLength={10}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Repeat password</Label>
          <Input
            id="confirm"
            type="password"
            required
            minLength={10}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy || !token || done}>
          {done ? "Password updated" : busy ? "Updating…" : "Update password"}
        </Button>
        <p className="text-center text-xs text-muted-foreground">
          Updating your password signs out every other device.
        </p>
      </form>
      <BrandFooter />
    </div>
  );
}
