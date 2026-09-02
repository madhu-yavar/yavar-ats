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
