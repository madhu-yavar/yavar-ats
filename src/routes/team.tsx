import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { ShieldCheck } from "lucide-react";

import { listTeam, setRole, type AppRole } from "@/lib/roles.functions";
import { useRoles } from "@/hooks/useRoles";
import { EmptyState, PageHeader } from "@/components/ats";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Users & approval roles — Talent Acquisition" },
      {
        name: "description",
        content:
          "Grant recruiter, hiring manager, department head, HR head and President/CBO roles that gate the requisition approval chain.",
      },
      { property: "og:title", content: "Users & approval roles" },
      { property: "og:description", content: "Role administration for the requisition and offer approval chain." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Team,
});

const ROLE_LABELS: { role: AppRole; label: string; hint: string }[] = [
  { role: "recruiter", label: "Recruiter", hint: "Raises requisitions, sources and scores candidates" },
  { role: "hiring_manager", label: "Hiring manager", hint: "Runs interviews and evaluations" },
  { role: "department_head", label: "Department head", hint: "First approval hop on a requisition" },
  { role: "hr_head", label: "HR head", hint: "Second approval hop; offer approval" },
  { role: "president_cbo", label: "President / CBO (CHRO admin)", hint: "Final approval; manages roles" },
];

function Team() {
  const qc = useQueryClient();
  const { isAdmin, isLoading } = useRoles();
  const fetchTeam = useServerFn(listTeam);
  const mutate = useServerFn(setRole);
  const [busy, setBusy] = useState<string | null>(null);

  const team = useQuery({
    queryKey: ["team"],
    queryFn: () => fetchTeam({}),
    enabled: isAdmin,
  });

  async function toggle(userId: string, role: AppRole, grant: boolean) {
    setBusy(`${userId}:${role}`);
    try {
      await mutate({ data: { userId, role, grant } });
      qc.invalidateQueries({ queryKey: ["team"] });
      qc.invalidateQueries({ queryKey: ["my_roles"] });
      toast.success(grant ? "Role granted" : "Role revoked");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not update role");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Users & approval roles"
        description="The approval chain is role-gated: Department Head → HR Head → President/CBO. The first account to sign in becomes the CHRO super-admin."
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Checking your access…</p>
      ) : !isAdmin ? (
        <EmptyState
          title="CHRO access required"
          hint="Only the President / CBO (CHRO admin) can view and assign roles. Ask them to grant you a role."
        />
      ) : team.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading users…</p>
      ) : (
        <div className="space-y-4">
          {(team.data ?? []).map((m) => (
            <section key={m.userId} className="panel p-5">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-muted-foreground" />
                <div>
                  <h3 className="font-semibold">{m.email}</h3>
                  <p className="num text-xs text-muted-foreground">
                    joined {new Date(m.createdAt).toLocaleDateString()} ·{" "}
                    {m.roles.length ? m.roles.join(", ") : "no roles yet"}
                  </p>
                </div>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {ROLE_LABELS.map(({ role, label, hint }) => {
                  const has = m.roles.includes(role);
                  return (
                    <div
                      key={role}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{label}</div>
                        <p className="truncate text-xs text-muted-foreground">{hint}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={has ? "secondary" : "outline"}
                        disabled={busy === `${m.userId}:${role}`}
                        onClick={() => toggle(m.userId, role, !has)}
                      >
                        {has ? "Revoke" : "Grant"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </>
  );
}
