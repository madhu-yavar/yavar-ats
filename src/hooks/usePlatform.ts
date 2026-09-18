import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { platformState } from "@/lib/platform.functions";

/** Product-owner (super user) status for the signed-in account. */
export function usePlatform() {
  const fetchState = useServerFn(platformState);
  const q = useQuery({
    queryKey: ["platform_state"],
    queryFn: () => fetchState({}),
    staleTime: 60_000,
    // "Super-user access only." is the expected answer for every non-super-user —
    // it is a settled no, not a transient failure. Retrying it re-fires the
    // throwing RPC forever and keeps OrgGate on "Loading your organisation…".
    retry: false,
  });
  return {
    isSuperUser: Boolean(q.data?.isSuperUser),
    claimable: Boolean(q.data?.claimable),
    email: q.data?.email ?? null,
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
