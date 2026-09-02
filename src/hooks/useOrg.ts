import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { myOrg } from "@/lib/org.functions";

/** The signed-in user's organisation, membership and granted roles. */
export function useOrg() {
  const fetchOrg = useServerFn(myOrg);
  const q = useQuery({ queryKey: ["my_org"], queryFn: () => fetchOrg({}), staleTime: 30_000 });
  return {
    org: q.data?.org ?? null,
    membership: q.data?.membership ?? null,
    roles: q.data?.roles ?? [],
    isOwner: Boolean(q.data?.membership?.isOwner),
    isLoading: q.isLoading,
    refetch: q.refetch,
  };
}
