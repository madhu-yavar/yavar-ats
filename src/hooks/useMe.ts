import { useQuery } from "@tanstack/react-query";

import { supabase } from "@/integrations/supabase/client";

/** The signed-in identity, used to tell "mine" from "the team's". */
export function useMe() {
  const q = useQuery({
    queryKey: ["auth_identity"],
    queryFn: async () => (await supabase.auth.getUser()).data.user,
    staleTime: 300_000,
  });
  return {
    userId: q.data?.id ?? null,
    email: q.data?.email ?? null,
    isLoading: q.isLoading,
  };
}
