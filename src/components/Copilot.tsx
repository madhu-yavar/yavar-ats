import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Bot, RotateCcw, Send, X } from "lucide-react";
import { toast } from "sonner";

import { askCopilot, clearCopilot, copilotHistory, type CopilotMessage } from "@/lib/copilot.functions";
import { Button } from "@/components/ui/button";

const PROMPTS = [
  "Which open requisitions are at risk this week?",
  "Where is my pipeline leaking the most?",
  "Which skills are scarce in my talent pool?",
  "What should I fix in my offer stage?",
];

/** Always-available HR copilot: one ongoing conversation, stored in the database. */
export function Copilot() {
  const qc = useQueryClient();
  const fetchHistory = useServerFn(copilotHistory);
  const ask = useServerFn(askCopilot);
  const reset = useServerFn(clearCopilot);

  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const boxRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const history = useQuery({
    queryKey: ["copilot"],
    queryFn: () => fetchHistory({}),
    enabled: open,
    staleTime: 10_000,
  });

  const send = useMutation({
    mutationFn: (message: string) => ask({ data: { message } }),
    onMutate: (message) => {
      qc.setQueryData<CopilotMessage[]>(["copilot"], (prev) => [
        ...(prev ?? []),
        { id: `tmp-${Date.now()}`, role: "user", content: message, createdAt: new Date().toISOString() },
      ]);
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["copilot"] }),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Copilot failed"),
  });

  const messages = history.data ?? [];

  useEffect(() => {
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight });
  }, [messages.length, send.isPending]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open, send.isPending]);

  function submit(text: string) {
    const value = text.trim();
    if (!value || send.isPending) return;
    setDraft("");
    send.mutate(value);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-primary px-4 py-3 text-sm font-medium text-primary-foreground shadow-lg transition-transform hover:scale-[1.03]"
      >
        <Bot className="size-4" /> HR copilot
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[32rem] w-[min(24rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl">
      <header className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Bot className="size-4 text-primary" /> HR copilot
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title="Start a fresh conversation"
            onClick={async () => {
              await reset({});
              qc.setQueryData(["copilot"], []);
            }}
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button variant="ghost" size="icon" onClick={() => setOpen(false)}>
            <X className="size-4" />
          </Button>
        </div>
      </header>

      <div ref={boxRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 ? (
          <div className="space-y-3">
            <p className="text-muted-foreground">
              Ask about your live pipeline, pool health, interviews or offers — answers are grounded in your
              organisation's data.
            </p>
            <div className="space-y-1.5">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => submit(p)}
                  className="w-full rounded-md border border-border px-3 py-2 text-left text-xs hover:bg-accent"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) => (
          <div
            key={m.id}
            className={
              m.role === "user"
                ? "ml-auto max-w-[85%] rounded-lg bg-primary px-3 py-2 text-primary-foreground"
                : "max-w-[92%] whitespace-pre-wrap rounded-lg bg-secondary px-3 py-2"
            }
          >
            {m.content}
          </div>
        ))}

        {send.isPending ? <div className="text-xs text-muted-foreground">Copilot is thinking…</div> : null}
      </div>

      <form
        className="flex items-end gap-2 border-t border-border p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <textarea
          ref={inputRef}
          rows={2}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit(draft);
            }
          }}
          placeholder="Ask your copilot…"
          className="min-h-[2.5rem] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm"
        />
        <Button type="submit" size="icon" disabled={send.isPending || !draft.trim()}>
          <Send className="size-4" />
        </Button>
      </form>
    </div>
  );
}
