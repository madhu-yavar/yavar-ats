import { useOrg } from "@/hooks/useOrg";
import type { AppRole } from "@/lib/org.functions";

/** Roles for the signed-in user inside their organisation, plus approval helpers. */
export function useRoles() {
  const { roles, isOwner, isLoading } = useOrg();
  const isAdmin = isOwner || roles.includes("president_cbo");

  /** Which role owns each approval hop. The CHRO admin can action every step. */
  function canApprove(status: string) {
    if (isAdmin) return true;
    const owner: Record<string, AppRole> = {
      draft: "recruiter",
      pending_dh: "department_head",
      pending_hr: "hr_head",
      pending_cbo: "president_cbo",
    };
    const required = owner[status];
    return Boolean(required && roles.includes(required));
  }

  function requiredRoleFor(status: string) {
    return (
      {
        draft: "Recruiter",
        pending_dh: "Department Head",
        pending_hr: "HR Head",
        pending_cbo: "President / CBO",
      } as Record<string, string>
    )[status];
  }

  return { roles, isAdmin, canApprove, requiredRoleFor, isLoading };
}
