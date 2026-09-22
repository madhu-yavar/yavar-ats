import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { applyResetRequest } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/auth/reset")({
  head: () => ({
    meta: [
      { title: "Choose a new password — ATSIQ" },
      {
        name: "description",
        content: "Set a new ATSIQ password using the secure reset link sent to your work email.",
      },
      { property: "og:title", content: "Choose a new password — ATSIQ" },
      {
        property: "og:description",
        content: "Set a new ATSIQ password using the secure reset link sent to your work email.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search["token"] === "string" ? (search["token"] as string) : "",
  }),
  component: ResetPage,
});

function ResetPage() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password !== confirm) {
      toast.error("The two passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const message = await applyResetRequest(token, password);
      toast.success(message);
      setTimeout(() => void navigate({ to: "/" }), 1200);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center px-6">
      <form onSubmit={submit} className="panel w-full space-y-5 p-7 shadow-lg">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Choose a new password</h1>
          <p className="text-sm text-muted-foreground">
            Updating your password signs out every other device.
          </p>
        </div>

        {!token ? (
          <p className="text-sm text-destructive">
            This link is incomplete. Request a new reset email from the sign-in screen.
          </p>
        ) : null}

        <div className="space-y-2">
          <Label htmlFor="new-password">New password</Label>
          <Input
            id="new-password"
            type="password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm-password">Repeat password</Label>
          <Input
            id="confirm-password"
            type="password"
            required
            minLength={8}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <Button type="submit" className="w-full" disabled={busy || !token}>
          {busy ? "Updating…" : "Update password"}
        </Button>
      </form>
    </main>
  );
}
