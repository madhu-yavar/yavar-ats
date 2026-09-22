import { useQuery } from "@tanstack/react-query";

import { fetchMe } from "@/lib/auth-client";

/** The signed-in identity, used to tell "mine" from "the team's". */
export function useMe() {
  const q = useQuery({
    queryKey: ["auth_identity"],
    queryFn: fetchMe,
    staleTime: 300_000,
  });
  return {
    userId: q.data?.id ?? null,
    email: q.data?.email ?? null,
    isLoading: q.isLoading,
  };
}
