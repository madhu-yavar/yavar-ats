import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Check, Copy, Loader2, Mail, Paperclip, RefreshCw, Star, Trash2 } from "lucide-react";

import {
  getInboxThread,
  orgInbox,
  removeInboxMessage,
  removeInboxMessages,
  retryInboxMessage,
  saveCareersEmail,
  setInboxStar,
  type InboxRow,
} from "@/lib/local-inbox.functions";
import { EmptyState, PageHeader } from "@/components/ats";
import { listMembers } from "@/lib/org.functions";
import { useNavCtx } from "@/hooks/useNavCtx";
import { useOrg } from "@/hooks/useOrg";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/inbox")({
  head: () => ({
    meta: [
      { title: "Careers Inbox — Automatic CV Intake" },
      {
        name: "description",
        content:
          "Your organisation's own careers address: every CV mailed in is read, filed into the talent pool and attached to the matching open role automatically.",
      },
      { property: "og:title", content: "Careers Inbox — Automatic CV Intake" },
      {
        property: "og:description",
        content:
          "One address per organisation. Applicant mail becomes a scored candidate with nothing to download.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: InboxPage,
});

const STATUS_STYLE: Record<string, string> = {
  stored: "bg-violet-50 text-violet-700 border-violet-200",
  imported: "bg-emerald-50 text-emerald-700 border-emerald-200",
  updated: "bg-blue-50 text-blue-700 border-blue-200",
  skipped: "bg-muted text-muted-foreground border-border",
  received: "bg-amber-50 text-amber-700 border-amber-200",
  error: "bg-red-50 text-red-700 border-red-200",
};

const STATUS_LABEL: Record<string, string> = {
  stored: "Reply",
  imported: "Filed",
  updated: "Updated",
  skipped: "No CV",
  received: "Waiting",
  error: "Needs a look",
};

const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString([], { month: "short", day: "numeric" });
};

function InboxPage() {
  const nav = useNavCtx();
  const qc = useQueryClient();
  const fetchInbox = useServerFn(orgInbox);
  const retry = useServerFn(retryInboxMessage);
  const remove = useServerFn(removeInboxMessage);
  const removeBulk = useServerFn(removeInboxMessages);
  const setStar = useServerFn(setInboxStar);
  const fetchThread = useServerFn(getInboxThread);

  const inbox = useQuery({ queryKey: ["org_inbox"], queryFn: () => fetchInbox({}) });
  const [threadKey, setThreadKey] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [memberFilter, setMemberFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [careers, setCareers] = useState("");
  const [savingCareers, setSavingCareers] = useState(false);
  const persistCareers = useServerFn(saveCareersEmail);
  const fetchMembers = useServerFn(listMembers);
  const members = useQuery({
    queryKey: ["org_members_list"],
    queryFn: () => fetchMembers({}),
    enabled: nav.leadership,
  });

  useEffect(() => {
    setCareers(inbox.data?.careersEmail ?? "");
  }, [inbox.data?.careersEmail]);

  const saveCareers = async (value: string) => {
    setSavingCareers(true);
    try {
      await persistCareers({ data: { email: value.trim() || null } });
      toast.success(value.trim() ? "Careers address registered." : "Careers address removed.");
      await qc.invalidateQueries({ queryKey: ["org_inbox"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setSavingCareers(false);
    }
  };

  const address = inbox.data?.address ?? null;
  const counts = inbox.data?.counts;

  const rows = useMemo(() => {
    const all = (inbox.data?.messages ?? []) as InboxRow[];
    const q = search.trim().toLowerCase();
    return all.filter((m) => {
      if (memberFilter !== "all" && (m.owner_id ?? "") !== memberFilter) return false;
      if (status === "starred") {
        if (!m.starred) return false;
      } else if (status !== "all" && m.status !== status) return false;
      if (!q) return true;
      return [m.from_email, m.from_name, m.subject, m.attachment_name, m.detail]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q));
    });
  }, [inbox.data, search, status, memberFilter]);

  // Gmail-style conversations: group by normalised subject (Re:/Fwd: stripped)
  // within the same candidate, so one candidate's back-and-forth reads as one
  // thread while different candidates on a similar subject stay separate.
  const groups = useMemo(() => {
    const norm = (s: string | null) =>
      (s ?? "")
        .replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "")
        .trim()
        .toLowerCase() || "(no subject)";
    const byKey = new Map<
      string,
      { key: string; subject: string; messages: InboxRow[]; last: InboxRow }
    >();
    for (const m of rows) {
      const key = `${norm(m.subject)}|${m.candidate_id ?? ""}`;
      const g = byKey.get(key) ?? {
        key,
        subject: m.subject ?? "(no subject)",
        messages: [],
        last: m,
      };
      g.messages.push(m);
      g.last = m;
      byKey.set(key, g);
    }
    const list = [...byKey.values()];
    for (const g of list) {
      g.messages.sort((a, b) => a.received_at.localeCompare(b.received_at));
      const bare = g.messages.find((m) => !/^(re|fwd?|fw)\s*:/i.test(m.subject ?? ""));
      if (bare?.subject) g.subject = bare.subject;
    }
    return list.sort((a, b) => b.last.received_at.localeCompare(a.last.received_at));
  }, [rows]);

  const openGroup = groups.find((g) => g.key === threadKey) ?? null;
  const thread = useQuery({
    queryKey: ["org_inbox_thread", threadKey],
    queryFn: () => fetchThread({ data: { ids: (openGroup?.messages ?? []).map((m) => m.id) } }),
    enabled: Boolean(openGroup?.messages.length),
  });
  const linkedCandidateId = thread.data?.find((m) => m.candidate_id)?.candidate_id ?? null;

  const act = async (id: string, kind: "retry" | "remove") => {
    setBusy(id);
    try {
      if (kind === "retry") {
        const r = await retry({ data: { messageId: id } });
        toast[r.status === "error" ? "error" : "success"](r.detail);
      } else {
        await remove({ data: { messageId: id } });
        toast.success("Mail removed.");
      }
      await qc.invalidateQueries({ queryKey: ["org_inbox"] });
      await qc.invalidateQueries({ queryKey: ["org_inbox_thread"] });
      await qc.invalidateQueries({ queryKey: ["candidates"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  const toggleSelectGroup = (ids: string[]) =>
    setSelected((prev) => {
      const next = new Set(prev);
      const all = ids.every((id) => prev.has(id));
      ids.forEach((id) => (all ? next.delete(id) : next.add(id)));
      return next;
    });

  const allIds = groups.flatMap((g) => g.messages.map((m) => m.id));
  const allSelected = allIds.length > 0 && allIds.every((id) => selected.has(id));

  const bulkRemove = async () => {
    setBusy("bulk");
    try {
      await removeBulk({ data: { ids: [...selected] } });
      toast.success(`${selected.size} mail(s) removed.`);
      setSelected(new Set());
      await qc.invalidateQueries({ queryKey: ["org_inbox"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    } finally {
      setBusy(null);
    }
  };

  const toggleStar = async (ids: string[], starred: boolean) => {
    try {
      await setStar({ data: { ids, starred } });
      await qc.invalidateQueries({ queryKey: ["org_inbox"] });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "That did not work.");
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Careers inbox"
        description="Your own applications address. Anything mailed here — LinkedIn application alerts, job-board notifications, direct applicants — is read, filed in the talent pool and attached to the matching open role. Nothing to download, nothing to configure."
      />

      <div className="panel p-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-muted-foreground">
              Your applications address
            </p>
            <p className="mt-1 font-mono text-lg font-semibold text-foreground">
              {address ?? "Being prepared…"}
            </p>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
              Put this address on your job adverts, or forward your existing careers mailbox to it.
              Every application that arrives shows up in the list below within moments.
            </p>
          </div>
          {address ? (
            <Button
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(address);
                setCopied(true);
                toast.success("Address copied.");
                setTimeout(() => setCopied(false), 1500);
              }}
            >
              {copied ? <Check className="mr-2 size-4" /> : <Copy className="mr-2 size-4" />}
              Copy address
            </Button>
          ) : null}
        </div>

        {counts ? (
          <div className="mt-5 grid gap-3 sm:grid-cols-5">
            {[
              ["Mails received", counts.total],
              ["Candidates filed", counts.imported],
              ["Records updated", counts.updated],
              ["Without a CV", counts.skipped],
              ["Need a look", counts.errors],
            ].map(([label, value]) => (
              <div
                key={String(label)}
                className="rounded-[10px] border border-border bg-card px-3 py-2"
              >
                <p className="text-xs text-muted-foreground">{label}</p>
                <p className="text-xl font-semibold text-foreground">{value as number}</p>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className="panel p-5">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">
          Your own careers address
        </p>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          If you already advertise an address like{" "}
          <span className="font-mono">careers@yourcompany.com</span>, register it here and set it to
          forward to the address above. Applications keep arriving at your own address and still
          file themselves here — candidates never see a different address.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Input
            value={careers}
            onChange={(e) => setCareers(e.target.value)}
            placeholder="careers@yourcompany.com"
            className="max-w-sm"
          />
          <Button onClick={() => saveCareers(careers)} disabled={savingCareers}>
            {savingCareers ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
            Save address
          </Button>
          {inbox.data?.careersEmail ? (
            <Button variant="ghost" onClick={() => saveCareers("")} disabled={savingCareers}>
              Remove
            </Button>
          ) : null}
        </div>
        {inbox.data?.careersEmail ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Registered: <span className="font-mono text-foreground">{inbox.data.careersEmail}</span>{" "}
            — forward it to {address ?? "your ATSIQ address"}.
          </p>
        ) : null}
      </div>

      <div className="panel p-5">
        <div className="flex flex-wrap items-center gap-3">
          <input
            type="checkbox"
            className="size-4 cursor-pointer accent-primary"
            checked={allSelected}
            onChange={() =>
              setSelected(() => {
                const next = new Set<string>();
                if (!allSelected) allIds.forEach((id) => next.add(id));
                return next;
              })
            }
            aria-label="Select all conversations"
          />
          {selected.size > 0 ? (
            <>
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <Button
                variant="outline"
                size="sm"
                disabled={busy === "bulk"}
                onClick={() => void bulkRemove()}
              >
                <Trash2 className="mr-1 size-4" /> Remove
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setSelected(new Set())}>
                Clear
              </Button>
            </>
          ) : null}
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search sender, subject or file"
            className="max-w-sm"
          />
          {nav.leadership ? (
            <Select value={memberFilter} onValueChange={setMemberFilter}>
              <SelectTrigger className="w-52">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All members</SelectItem>
                {(members.data ?? []).map((mm) => (
                  <SelectItem key={mm.id} value={mm.id}>
                    {mm.fullName || mm.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : null}
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All mail</SelectItem>
              <SelectItem value="imported">Filed</SelectItem>
              <SelectItem value="updated">Updated</SelectItem>
              <SelectItem value="skipped">No CV</SelectItem>
              <SelectItem value="starred">Starred</SelectItem>
              <SelectItem value="stored">Replies</SelectItem>
              <SelectItem value="error">Needs a look</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="ghost" onClick={() => inbox.refetch()} disabled={inbox.isFetching}>
            {inbox.isFetching ? (
              <Loader2 className="mr-2 size-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 size-4" />
            )}
            Refresh
          </Button>
          <span className="ml-auto text-sm text-muted-foreground">
            {groups.length} conversations
          </span>
        </div>

        <div className="mt-4">
          {groups.length === 0 ? (
            <EmptyState
              title="No applications here yet"
              hint="Send a test mail with a CV attached to the address above, or forward your careers mailbox to it."
            />
          ) : (
            <div className="divide-y divide-border overflow-hidden rounded-md border border-border bg-card">
              {groups.map((g) => {
                const ids = g.messages.map((m) => m.id);
                const unread = g.messages.some((m) => !m.read_at);
                const starred = g.messages.some((m) => m.starred);
                const checked = ids.every((id) => selected.has(id));
                return (
                  <div
                    key={g.key}
                    className={`flex items-start gap-2 px-3 py-2.5 transition-colors ${
                      checked ? "bg-primary/5" : "hover:bg-muted/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      className="mt-1.5 size-4 shrink-0 cursor-pointer accent-primary"
                      checked={checked}
                      onChange={() => toggleSelectGroup(ids)}
                      aria-label="Select conversation"
                    />
                    <button
                      type="button"
                      className="mt-1 shrink-0"
                      aria-label={starred ? "Unstar conversation" : "Star conversation"}
                      onClick={() => void toggleStar(ids, !starred)}
                    >
                      <Star
                        className={`size-4 ${
                          starred ? "fill-amber-400 text-amber-400" : "text-muted-foreground"
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      className="flex min-w-0 flex-1 items-baseline gap-3 text-left"
                      onClick={() => setThreadKey(g.key)}
                    >
                      <span
                        className={`w-44 shrink-0 truncate text-sm ${
                          unread ? "font-semibold text-foreground" : "text-foreground/75"
                        }`}
                      >
                        {g.last.from_name ?? g.last.from_email}
                        {g.messages.length > 1 ? (
                          <span className="ml-1 text-xs font-normal text-muted-foreground">
                            {g.messages.length}
                          </span>
                        ) : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate text-sm">
                        <span
                          className={
                            unread ? "font-semibold text-foreground" : "text-foreground/85"
                          }
                        >
                          {g.subject}
                        </span>
                        {g.last.snippet ? (
                          <span className="text-muted-foreground"> — {g.last.snippet}</span>
                        ) : null}
                      </span>
                      {g.last.attachment_name ? (
                        <span className="hidden shrink-0 items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-muted-foreground sm:inline-flex">
                          <Paperclip className="size-3" />
                          {g.last.attachment_name.replace(/\.[^.]+$/, "").slice(0, 18)}
                        </span>
                      ) : null}
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {fmtDate(g.last.received_at)}
                      </span>
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <Dialog open={Boolean(threadKey)} onOpenChange={(o) => !o && setThreadKey(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="size-4 text-muted-foreground" />
                {openGroup?.subject ?? "(no subject)"}
              </DialogTitle>
              <DialogDescription>
                {openGroup ? `${openGroup.messages.length} message(s) in this conversation` : ""}
              </DialogDescription>
            </DialogHeader>
            <div className="max-h-[26rem] space-y-4 overflow-y-auto pr-1">
              {thread.data?.length
                ? thread.data.map((m) => (
                    <div key={m.id} className="rounded-md border border-border p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">
                            {m.from_name ?? m.from_email}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {m.from_email} · {new Date(m.received_at).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <span
                            className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${
                              STATUS_STYLE[m.status] ?? STATUS_STYLE["received"]
                            }`}
                          >
                            {STATUS_LABEL[m.status] ?? m.status}
                          </span>
                          {m.status === "error" || m.status === "received" ? (
                            <Button
                              size="sm"
                              variant="outline"
                              disabled={busy === m.id}
                              onClick={() => act(m.id, "retry")}
                            >
                              <RefreshCw className="size-4" />
                              <span className="ml-1">Retry</span>
                            </Button>
                          ) : null}
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={busy === m.id}
                            onClick={() => act(m.id, "remove")}
                            aria-label="Remove mail"
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                      </div>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                        {m.body || "(no readable body — this mail arrived without plain text)"}
                      </p>
                      {m.attachment_name ? (
                        <p className="mt-2 font-mono text-xs text-muted-foreground">
                          Attachment: {m.attachment_name}
                        </p>
                      ) : null}
                      {m.candidate_id ? (
                        <Link
                          to="/candidates/$id"
                          params={{ id: m.candidate_id }}
                          className="mt-2 inline-block text-xs text-primary underline"
                        >
                          Open candidate
                        </Link>
                      ) : null}
                    </div>
                  ))
                : null}
            </div>
            <DialogFooter className="gap-2">
              {linkedCandidateId ? (
                <Button asChild variant="outline">
                  <Link to="/candidates/$id" params={{ id: linkedCandidateId }}>
                    Open candidate
                  </Link>
                </Button>
              ) : null}
              <Button variant="ghost" onClick={() => setThreadKey(null)}>
                Close
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}
