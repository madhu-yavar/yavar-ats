import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useOrg } from "@/hooks/useOrg";
import { OnboardingWizard } from "@/components/OnboardingWizard";

/**
 * Nothing in the ATS exists outside an organisation, so a signed-in user with no
 * membership is sent through onboarding before the workspace renders.
 */
export function OrgGate({ children }: { children: React.ReactNode }) {
  const { org, membership, isLoading, refetch } = useOrg();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading your organisation…
      </div>
    );
  }

  if (!org || !membership) return <OnboardingWizard onDone={() => refetch()} />;

  if (org.status === "pending") {
    return (
      <Waiting
        title="Awaiting platform approval"
        body={`${org.name} has been registered and is queued for review. Once a platform super admin approves it, you can sign in as the owner and start creating internal users for your organisation.`}
      />
    );
  }

  if (org.status === "rejected") {
    return (
      <Waiting
        title="Registration not approved"
        body={org.rejection_reason || "This organisation registration was not approved by the platform team."}
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
function Waiting({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 px-4">
      <div className="panel max-w-md space-y-2 p-6 text-center">
        <h1 className="text-lg font-semibold">{title}</h1>
        <p className="text-sm text-muted-foreground">{body}</p>
      </div>
      <Button variant="ghost" size="sm" onClick={() => supabase.auth.signOut()}>
        Sign out
      </Button>
    </div>
  );
}
