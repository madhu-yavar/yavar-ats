import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { AtSign, Send, UserRoundCheck } from "lucide-react";

import { useMe } from "@/hooks/useMe";
import {
  candidateNotesQuery,
  ownershipEventsQuery,
  referralsQuery,
  requisitionsQuery,
} from "@/lib/data";
import { addCandidateNote, poolTeam, referCandidate, setCandidateOwner } from "@/lib/collaboration.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";

/**
 * Recruiter-to-recruiter workspace for one candidate: who owns them, hand-over,
 * referral to a colleague's role, and a shared note trail with mentions.
 */
export function CandidateCollab({
  candidateId,
  ownerId,
  onChanged,
}: {
  candidateId: string;
  ownerId: string | null;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const me = useMe();
  const fetchTeam = useServerFn(poolTeam);
  const team = useQuery({ queryKey: ["pool_team"], queryFn: () => fetchTeam({}), staleTime: 300_000 });
  const notes = useQuery(candidateNotesQuery(candidateId));
  const history = useQuery(ownershipEventsQuery(candidateId));
  const refs = useQuery(referralsQuery);
  const reqs = useQuery(requisitionsQuery);

  const assign = useServerFn(setCandidateOwner);
  const refer = useServerFn(referCandidate);
  const note = useServerFn(addCandidateNote);

  const [busy, setBusy] = useState(false);
  const [referTo, setReferTo] = useState("");
  const [referReq, setReferReq] = useState("");
  const [referNote, setReferNote] = useState("");
  const [noteText, setNoteText] = useState("");
  const [mentions, setMentions] = useState<string[]>([]);

  const members = team.data ?? [];
  const nameOf = (id: string | null) =>
    (id && members.find((m) => m.userId === id)?.name) || (id ? "A colleague" : "Unassigned");
  const mine = ownerId && me.userId === ownerId;
  const candidateRefs = (refs.data ?? []).filter((r) => r.candidate_id === candidateId);

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      await fn();
      toast.success(label);
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["candidate", candidateId] }),
        qc.invalidateQueries({ queryKey: ["candidates"] }),
        qc.invalidateQueries({ queryKey: ["candidate_notes", candidateId] }),
        qc.invalidateQueries({ queryKey: ["candidate_ownership_events", candidateId] }),
        qc.invalidateQueries({ queryKey: ["candidate_referrals"] }),
      ]);
      onChanged?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel p-5" id="collaboration">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold">Ownership & team</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Everyone in your organisation can see this candidate. Ownership says who is
            responsible for them.
          </p>
        </div>
        <Badge variant={ownerId ? "secondary" : "outline"}>
          <UserRoundCheck className="mr-1 size-3" />
          {mine ? "Owned by you" : `Owner: ${nameOf(ownerId)}`}
        </Badge>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <Label>Owner</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={ownerId ?? ""}
            disabled={busy}
            onChange={(e) =>
              run("Ownership updated", () =>
                assign({
                  data: {
                    candidateIds: [candidateId],
                    ownerId: e.target.value || null,
                    reason: "Changed from the candidate page",
                  },
                }),
              )
            }
          >
            <option value="">Unassigned — shared pool</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>
                {m.name}
                {m.userId === me.userId ? " (you)" : ""}
              </option>
            ))}
          </select>
          {!mine && ownerId ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run("You now own this candidate", () =>
                  assign({
                    data: { candidateIds: [candidateId], ownerId: me.userId, reason: "Taken over" },
                  }),
                )
              }
            >
              Take ownership
            </Button>
          ) : null}
          {(history.data ?? []).length ? (
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {(history.data ?? []).slice(0, 4).map((h) => (
                <li key={h.id}>
                  {nameOf(h.from_owner)} → {nameOf(h.to_owner)} ·{" "}
                  {new Date(h.created_at).toLocaleDateString()}
                  {h.reason ? ` · ${h.reason}` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>

        <div className="space-y-2">
          <Label>Refer to a colleague</Label>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={referTo}
            onChange={(e) => setReferTo(e.target.value)}
          >
            <option value="">Choose a recruiter…</option>
            {members
              .filter((m) => m.userId !== me.userId)
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </select>
          <select
            className="h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
            value={referReq}
            onChange={(e) => setReferReq(e.target.value)}
          >
            <option value="">For any role (no requisition)</option>
            {(reqs.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} · {r.title}
              </option>
            ))}
          </select>
          <Textarea
            rows={2}
            placeholder="Why is this person right for them?"
            value={referNote}
            onChange={(e) => setReferNote(e.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !referTo}
            onClick={() =>
              run("Referral sent", async () => {
                await refer({
                  data: {
                    candidateId,
                    toUser: referTo,
                    requisitionId: referReq || null,
                    note: referNote || undefined,
                  },
                });
                setReferTo("");
                setReferReq("");
                setReferNote("");
              })
            }
          >
            <Send className="mr-1 size-3" /> Send referral
          </Button>
          {candidateRefs.length ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {candidateRefs.slice(0, 4).map((r) => (
                <li key={r.id}>
                  {nameOf(r.from_user)} → {nameOf(r.to_user)} · {r.status}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>

      <div className="mt-6 border-t border-border pt-4">
        <Label>Team notes</Label>
        <Textarea
          className="mt-2"
          rows={2}
          placeholder="Share what you learned about this candidate…"
          value={noteText}
          onChange={(e) => setNoteText(e.target.value)}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <AtSign className="size-3" /> Notify
          </span>
          {members
            .filter((m) => m.userId !== me.userId)
            .map((m) => {
              const on = mentions.includes(m.userId);
              return (
                <button
                  key={m.userId}
                  type="button"
                  className={`rounded-full border px-2 py-0.5 text-xs ${
                    on ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground"
                  }`}
                  onClick={() =>
                    setMentions((prev) =>
                      prev.includes(m.userId) ? prev.filter((x) => x !== m.userId) : [...prev, m.userId],
                    )
                  }
                >
                  {m.name}
                </button>
              );
            })}
          <Button
            size="sm"
            className="ml-auto"
            disabled={busy || noteText.trim().length === 0}
            onClick={() =>
              run("Note added", async () => {
                await note({ data: { candidateId, body: noteText.trim(), mentions } });
                setNoteText("");
                setMentions([]);
              })
            }
          >
            Post note
          </Button>
        </div>

        <ul className="mt-4 space-y-3">
          {(notes.data ?? []).map((n) => (
            <li key={n.id} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">{n.author_name ?? nameOf(n.author_id)}</span>
                <span>{new Date(n.created_at).toLocaleString()}</span>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{n.body}</p>
              {n.mentions.length ? (
                <p className="mt-1 text-xs text-primary">
                  Notified: {n.mentions.map((m) => nameOf(m)).join(", ")}
                </p>
              ) : null}
            </li>
          ))}
          {(notes.data ?? []).length === 0 ? (
            <li className="text-sm text-muted-foreground">No notes yet.</li>
          ) : null}
        </ul>
      </div>
    </section>
  );
}
