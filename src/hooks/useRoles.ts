import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { myRoles, type AppRole } from "@/lib/roles.functions";

/** Roles for the signed-in user, plus the approval permission helper. */
export function useRoles() {
  const fetchRoles = useServerFn(myRoles);
  const q = useQuery({ queryKey: ["my_roles"], queryFn: () => fetchRoles({}) });
  const roles = (q.data ?? []) as AppRole[];
  const isAdmin = roles.includes("president_cbo");

  /** Which role owns each approval hop. Admin (CHRO) can action every step. */
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

  return { roles, isAdmin, canApprove, requiredRoleFor, isLoading: q.isLoading };
}
