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
    retry: 3,
    retryDelay: (attempt) => Math.min(400 * 2 ** attempt, 2000),
  });
  return {
    isSuperUser: Boolean(q.data?.isSuperUser),
    claimable: Boolean(q.data?.claimable),
    email: q.data?.email ?? null,
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
