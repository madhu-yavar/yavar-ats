import { useOrg } from "./useOrg";
import { usePlatform } from "./usePlatform";

/**
 * The journey context every role-scoped surface (sidebar, dashboards, cross-links)
 * computes from. Single source so the sidebar and feature pages can never disagree
 * about what a role may see. Mirrors — never replaces — server-side enforcement.
 */
export type NavCtx = {
  inOrg: boolean;
  isOwner: boolean;
  recruiterView: boolean;
  approver: boolean;
  governance: boolean;
  leadership: boolean;
  isSuperUser: boolean;
  claimable: boolean;
};

const BASELINE: NavCtx = {
  inOrg: true,
  isOwner: false,
  recruiterView: true,
  approver: false,
  governance: false,
  leadership: false,
  isSuperUser: false,
  claimable: false,
};

export function useNavCtx(): NavCtx {
  const { org, membership, roles, isOwner, isLoading } = useOrg();
  const { isSuperUser, claimable } = usePlatform();

  if (isLoading) return BASELINE; // recruiter journey until roles resolve — nothing flash-gates

  const inOrg = Boolean(org && membership);
  return {
    inOrg,
    isOwner,
    recruiterView:
      inOrg &&
      (roles.length === 0 ||
        isOwner ||
        roles.some((r) => r === "recruiter" || r === "hr_head" || r === "president_cbo")),
    approver:
      inOrg &&
      (isOwner ||
        roles.some(
          (r) =>
            r === "hiring_manager" ||
            r === "department_head" ||
            r === "hr_head" ||
            r === "president_cbo",
        )),
    governance:
      inOrg && (isOwner || roles.some((r) => r === "hr_head" || r === "president_cbo")),
    // The Talent Brain is a governance view: CHRO, HR head, owner or the product owner.
    leadership: isSuperUser || isOwner || roles.some((r) => r === "president_cbo" || r === "hr_head"),
    isSuperUser,
    claimable,
  };
}
