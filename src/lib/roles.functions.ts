import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export type AppRole = "recruiter" | "hiring_manager" | "department_head" | "hr_head" | "president_cbo";

export type TeamMember = {
  userId: string;
  email: string;
  roles: AppRole[];
  createdAt: string;
};

const ROLES = ["recruiter", "hiring_manager", "department_head", "hr_head", "president_cbo"] as const;

/**
 * Roles of the signed-in user. Bootstraps the very first signed-in account as
 * president_cbo (CHRO super-admin) so the approval chain is usable on day one.
 */
export const myRoles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AppRole[]> => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: all, error } = await supabaseAdmin.from("user_roles").select("user_id, role");
    if (error) throw new Error(error.message);

    if (!all || all.length === 0) {
      const { error: insErr } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: context.userId, role: "president_cbo" });
      if (insErr) throw new Error(insErr.message);
      return ["president_cbo"];
    }
    return all.filter((r) => r.user_id === context.userId).map((r) => r.role as AppRole);
  });

async function assertAdmin(supabase: { rpc: (n: string, a: Record<string, unknown>) => PromiseLike<{ data: unknown }> }, userId: string) {
  const { data } = await supabase.rpc("has_role", { _user_id: userId, _role: "president_cbo" });
  if (data !== true) throw new Error("Only the CHRO / President-CBO can manage roles");
}

/** Every auth user plus their granted roles — admin only. */
export const listTeam = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<TeamMember[]> => {
    await assertAdmin(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: users, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 200 });
    if (error) throw new Error(error.message);
    const { data: roles } = await supabaseAdmin.from("user_roles").select("user_id, role");
    return users.users.map((u) => ({
      userId: u.id,
      email: u.email ?? "(no email)",
      createdAt: u.created_at,
      roles: (roles ?? []).filter((r) => r.user_id === u.id).map((r) => r.role as AppRole),
    }));
  });

export const setRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) =>
    z.object({ userId: z.string().uuid(), role: z.enum(ROLES), grant: z.boolean() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase as never, context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    if (data.grant) {
      const { error } = await supabaseAdmin
        .from("user_roles")
        .insert({ user_id: data.userId, role: data.role });
      if (error && !/duplicate|unique/i.test(error.message)) throw new Error(error.message);
    } else {
      if (data.userId === context.userId && data.role === "president_cbo")
        throw new Error("You cannot revoke your own CHRO access");
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("role", data.role);
      if (error) throw new Error(error.message);
    }
    return { ok: true };
  });
