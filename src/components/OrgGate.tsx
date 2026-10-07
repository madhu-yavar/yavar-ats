import { useLocation } from "@tanstack/react-router";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { signOutApp } from "@/lib/auth-client";
import { claimInvite } from "@/lib/org.functions";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/hooks/useOrg";
import { usePlatform } from "@/hooks/usePlatform";
import { OnboardingWizard } from "@/components/OnboardingWizard";
import { isPublicPath } from "@/lib/public-paths";

/**
 * Nothing in the ATS exists outside an organisation, so a signed-in user with no
 * membership is sent through onboarding before the workspace renders.
 */
export function OrgGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const qc = useQueryClient();
  const { org, membership, pendingInvite, isLoading, isError, error, refetch } = useOrg();
  const claim = useServerFn(claimInvite);
  const [claimError, setClaimError] = useState<string | null>(null);
  const [claiming, setClaiming] = useState(false);
  const platform = usePlatform();

  if (isPublicPath(location.pathname)) return <>{children}</>;

  if (isLoading || platform.isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your organisation…
      </div>
    );
  }

  // A failed lookup must never be mistaken for "this user has no organisation" —
  // that is what used to drop a signed-in super user into the registration wizard.
  if (isError) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
        <div className="panel max-w-md space-y-2 p-6">
          <h1 className="text-lg font-semibold">Couldn't load your workspace</h1>
          <p className="text-sm text-muted-foreground">{error?.message ?? "Please try again."}</p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={() => refetch()}>
            Retry
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
              await signOutApp();
              window.location.assign("/");
            }}
          >
            Sign out
          </Button>
        </div>
      </div>
    );
  }

  // Platform super users administer tenants; they do not belong to one.
  if ((!org || !membership) && (platform.isSuperUser || platform.claimable)) return <>{children}</>;

  if (!org || !membership) {
    // An invited member who registered on their own must join their org — the
    // creation wizard is for founders, not for invitees.
    if (pendingInvite) {
      const join = async () => {
        setClaiming(true);
        setClaimError(null);
        try {
          await claim({});
          await refetch();
          await qc.invalidateQueries({ queryKey: ["my_org"] });
        } catch (e) {
          setClaimError(e instanceof Error ? e.message : "Joining did not work.");
        } finally {
          setClaiming(false);
        }
      };
      return (
        <div className="flex min-h-screen items-center justify-center px-4">
          <div className="panel max-w-md space-y-4 p-8 text-center">
            <h1 className="text-lg font-semibold">You're invited to {pendingInvite.orgName}</h1>
            <p className="text-sm text-muted-foreground">
              Your account is on the roster. Claim the invitation to enter the workspace with
              the role your organisation assigned you.
            </p>
            {claimError ? (
              <p className="text-sm text-red-600">{claimError}</p>
            ) : null}
            <Button className="w-full" disabled={claiming} onClick={() => void join()}>
              {claiming ? "Joining…" : `Join ${pendingInvite.orgName}`}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={async () => {
                await signOutApp();
                window.location.assign("/");
              }}
            >
              Sign out
            </Button>
          </div>
        </div>
      );
    }
    return <OnboardingWizard onDone={() => refetch()} />;
  }

  // A super user who owns a pending tenant must still reach the platform
  // console — otherwise the first tenant can never be approved.
  if (org.status === "pending" && !platform.isSuperUser) {
    return (
      <Waiting
        title="Awaiting platform approval"
        body={`${org.name} has been registered and is queued for review. A platform super admin approves or rejects it, and you receive an email either way. This screen updates itself the moment the decision is made — no need to sign out.`}
        onRefresh={() => refetch()}
      />
    );
  }

  if (org.status === "rejected") {
    return (
      <Waiting
        title="Registration not approved"
        body={
          org.rejection_reason ||
          "This organisation registration was not approved by the platform team."
        }
        onRefresh={() => refetch()}
      />
    );
  }

  if (org.status === "archived") {
    return (
      <Waiting
        title={`${org.name} is archived`}
        body="This organisation has been archived. Every record is preserved — a platform super user can restore access."
      />
    );
  }

  if (membership.status === "disabled") {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <div className="panel max-w-md space-y-2 p-8 text-center">
          <h1 className="text-lg font-semibold">Access paused</h1>
          <p className="text-sm text-muted-foreground">
            Your access to {org.name} has been paused. Ask an organisation owner to re-enable it.
          </p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

/** Full-screen status card for tenants that cannot enter the workspace yet. */
function Waiting({
  title,
  body,
  onRefresh,
}: {
  title: string;
  body: string;
  onRefresh?: () => void;
}) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4">
      <div className="panel max-w-md space-y-2 p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <div className="flex gap-2">
        {onRefresh && (
          <Button size="sm" variant="outline" onClick={onRefresh}>
            Check status
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await signOutApp();
            window.location.assign("/");
          }}
        >
          Sign out
        </Button>
      </div>
    </div>
  );
}
