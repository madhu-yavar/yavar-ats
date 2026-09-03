import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";


import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { workEmailProblem } from "@/lib/work-email";

export function AuthGate({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      setReady(true);
      // The bearer token is attached per server-function call, so anything fetched
      // during the sign-in transition must be refetched with the new identity.
      if (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED") {
        qc.clear();
        if (s) void qc.invalidateQueries();
      }
    });
    // Never leave the app stuck on the splash if session restore stalls.
    const bail = setTimeout(() => setReady(true), 4000);
    supabase.auth
      .getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => undefined)
      .finally(() => {
        clearTimeout(bail);
        setReady(true);
      });
    return () => {
      clearTimeout(bail);
      sub.subscription.unsubscribe();
    };
  }, [qc]);


  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  if (!session) return <SignIn />;
  return <>{children}</>;
}

function SignIn() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (mode === "signin") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const problem = workEmailProblem(email);
        if (problem) throw new Error(problem);
        const { error } = await supabase.auth.signUp({
          email,
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) throw error;
        toast.success("Check your inbox to confirm your work email, then continue the setup.");
      }
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function google() {
    const result = await lovable.auth.signInWithOAuth("google", {
      redirect_uri: window.location.origin,
    });
    if (result.error) toast.error("Google sign-in failed. Try email instead.");
  }

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <div className="text-sm font-semibold tracking-[0.2em] uppercase text-sidebar-primary">
          People Excellence
        </div>
        <div className="max-w-md space-y-5">
          <h1 className="text-4xl font-semibold leading-tight">
            Requisition to offer, with the JD&nbsp;↔&nbsp;CV map you can defend.
          </h1>
          <p className="text-sm leading-relaxed text-sidebar-foreground/70">
            Weighted matching (skills 50 / experience 25 / education 10 / social 15), live public-profile
            signals, and an evidence trail on every score.
          </p>
        </div>
        <div className="num text-xs text-sidebar-foreground/50">ATS v1.0 · Internal</div>
      </div>

      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="panel w-full max-w-sm space-y-5 p-8">
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">
              {mode === "signin" ? "Sign in" : "Register your organisation"}
            </h2>
            <p className="text-sm text-muted-foreground">
              {mode === "signin"
                ? "Talent acquisition workspace — sign in with your invited work email."
                : "Accounts exist only inside an organisation. Register your company here; a platform super admin approves it, then you invite your internal users."}
            </p>

          </div>

          <div className="space-y-2">
            <Label htmlFor="email">Work email</Label>
            <Input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              required
              minLength={6}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Please wait…" : mode === "signin" ? "Sign in" : "Sign up"}
          </Button>
          <Button type="button" variant="outline" className="w-full" onClick={google}>
            Continue with Google
          </Button>

          <button
            type="button"
            className="w-full text-center text-sm text-muted-foreground underline-offset-4 hover:underline"
            onClick={async () => {
              // Registering a new company always starts from a clean session, so the
              // wizard can never be masked by a previously signed-in workspace.
              if (mode === "signin") await supabase.auth.signOut().catch(() => undefined);
              setMode(mode === "signin" ? "signup" : "signin");
            }}
          >
            {mode === "signin"
              ? "New company? Register your organisation"
              : "Already have an account? Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
