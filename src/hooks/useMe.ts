import { useQuery } from "@tanstack/react-query";

/** The signed-in identity from the atsiq_session cookie, used to tell "mine" from "the team's". */
export function useMe() {
  const q = useQuery({
    queryKey: ["auth_identity"],
    queryFn: async () => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      const body = (await res.json()) as { email?: string; userId?: string };
      return body.email ? { email: body.email, userId: body.userId ?? null } : null;
    },
    staleTime: 300_000,
  });
  return {
    userId: q.data?.userId ?? null,
    email: q.data?.email ?? null,
    isLoading: q.isLoading,
  };
}
