import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { Crown, Mail, Plus, ShieldCheck, UserMinus } from "lucide-react";

import {
  inviteMember,
  listMembers,
  removeMember,
  setMemberRole,
  setMemberStatus,
  type AppRole,
} from "@/lib/org.functions";
import { useOrg } from "@/hooks/useOrg";
import { EmptyState, PageHeader } from "@/components/ats";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/team")({
  head: () => ({
    meta: [
      { title: "Users, invitations & approval roles — Talent Acquisition" },
      {
        name: "description",
        content:
          "Invite HR colleagues by work email and grant recruiter, hiring manager, department head, HR head and President/CBO roles that gate the requisition approval chain.",
      },
      { property: "og:title", content: "Users, invitations & approval roles" },
      {
        property: "og:description",
        content: "Organisation roster, email invitations and role administration for the approval chain.",
      },
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
  const { org, isOwner, isLoading } = useOrg();
  const fetchMembers = useServerFn(listMembers);
  const invite = useServerFn(inviteMember);
  const grant = useServerFn(setMemberRole);
  const status = useServerFn(setMemberStatus);
  const remove = useServerFn(removeMember);

  const [busy, setBusy] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<AppRole>("recruiter");
  const [title, setTitle] = useState("");

  const members = useQuery({ queryKey: ["org_members"], queryFn: () => fetchMembers({}) });

  function refresh() {
    qc.invalidateQueries({ queryKey: ["org_members"] });
    qc.invalidateQueries({ queryKey: ["my_org"] });
  }

  async function run(key: string, fn: () => Promise<unknown>, ok: string) {
    setBusy(key);
    try {
      await fn();
      refresh();
      toast.success(ok);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Action failed");
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Administration"
        title="Users & approval roles"
        description={
          org
            ? `Everyone below belongs to ${org.name}. The approval chain is role-gated: Department Head → HR Head → President/CBO.`
            : "Organisation roster and approval roles."
        }
      />

      {isOwner ? (
        <section className="panel space-y-3 p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Mail className="size-4 text-muted-foreground" /> Invite a colleague
          </h2>
          <p className="text-xs text-muted-foreground">
            They join this organisation with the role you pick, the first time they sign in with this email address.
          </p>
          <form
            className="grid gap-2 sm:grid-cols-[1.5fr_1fr_1fr_auto]"
            onSubmit={(e) => {
              e.preventDefault();
              void run(
                "invite",
                async () => {
                  await invite({ data: { email, role, title, fullName: "" } });
                  setEmail("");
                  setTitle("");
                },
                "Invitation added to the roster",
              );
            }}
          >
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="colleague@company.com"
            />
            <select
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
              value={role}
              onChange={(e) => setRole(e.target.value as AppRole)}
            >
              {ROLE_LABELS.map((r) => (
                <option key={r.role} value={r.role}>
                  {r.label}
                </option>
              ))}
            </select>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title (optional)" />
            <Button type="submit" disabled={busy === "invite"}>
              <Plus className="size-4" /> Invite
            </Button>
          </form>
        </section>
      ) : null}

      {isLoading || members.isLoading ? (
        <p className="text-sm text-muted-foreground">Loading the roster…</p>
      ) : (members.data ?? []).length === 0 ? (
        <EmptyState title="No members yet" hint="Invite your HR colleagues by work email." />
      ) : (
        <div className="space-y-4">
          {(members.data ?? []).map((m) => (
            <section key={m.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  {m.isOwner ? (
                    <Crown className="size-4 text-warning" />
                  ) : (
                    <ShieldCheck className="size-4 text-muted-foreground" />
                  )}
                  <div>
                    <h3 className="font-semibold">{m.fullName || m.email}</h3>
                    <p className="num text-xs text-muted-foreground">
                      {m.fullName ? `${m.email} · ` : ""}
                      {m.title ? `${m.title} · ` : ""}
                      {m.status === "invited"
                        ? "invitation pending"
                        : m.status === "disabled"
                          ? "access paused"
                          : `joined ${m.joinedAt ? new Date(m.joinedAt).toLocaleDateString() : "—"}`}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {m.status === "invited" ? <Badge variant="outline">Invited</Badge> : null}
                  {m.isOwner ? <Badge variant="secondary">Owner</Badge> : null}
                  {isOwner && !m.isOwner ? (
                    <>
                      {m.userId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={busy === `st:${m.id}`}
                          onClick={() =>
                            run(
                              `st:${m.id}`,
                              () =>
                                status({
                                  data: {
                                    memberId: m.id,
                                    status: m.status === "disabled" ? "active" : "disabled",
                                  },
                                }),
                              m.status === "disabled" ? "Access restored" : "Access paused",
                            )
                          }
                        >
                          {m.status === "disabled" ? "Restore" : "Pause"}
                        </Button>
                      ) : null}
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={busy === `rm:${m.id}`}
                        onClick={() => run(`rm:${m.id}`, () => remove({ data: { memberId: m.id } }), "Member removed")}
                      >
                        <UserMinus className="size-4" />
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>

              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                {ROLE_LABELS.map(({ role: r, label, hint }) => {
                  const has = m.userId ? m.roles.includes(r) : m.invitedRole === r;
                  return (
                    <div
                      key={r}
                      className="flex items-center justify-between gap-3 rounded-md border border-border p-3"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{label}</div>
                        <p className="truncate text-xs text-muted-foreground">{hint}</p>
                      </div>
                      <Button
                        size="sm"
                        variant={has ? "secondary" : "outline"}
                        disabled={!isOwner || busy === `${m.id}:${r}`}
                        onClick={() =>
                          run(
                            `${m.id}:${r}`,
                            () => grant({ data: { memberId: m.id, role: r, grant: !has } }),
                            has ? "Role revoked" : "Role granted",
                          )
                        }
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
