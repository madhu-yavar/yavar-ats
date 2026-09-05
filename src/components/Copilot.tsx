import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowUp, RotateCcw, Sparkle, X } from "lucide-react";
import { toast } from "sonner";

import { askCopilot, clearCopilot, copilotHistory, type CopilotMessage } from "@/lib/copilot.functions";

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
    boxRef.current?.scrollTo({ top: boxRef.current.scrollHeight, behavior: "smooth" });
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
        aria-label="Open HR copilot"
        className="group fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-full bg-foreground/90 px-4 py-3 text-sm font-medium text-background shadow-[0_10px_30px_-12px_color-mix(in_oklab,var(--foreground)_60%,transparent)] backdrop-blur-xl transition-all hover:bg-foreground hover:shadow-[0_16px_40px_-14px_color-mix(in_oklab,var(--primary)_55%,transparent)]"
      >
        <span className="relative flex size-5 items-center justify-center rounded-full bg-primary/90">
          <Sparkle className="size-3 text-primary-foreground" />
        </span>
        Copilot
      </button>
    );
  }

  return (
    <div className="fixed bottom-5 right-5 z-50 flex h-[34rem] w-[min(25rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 shadow-[0_30px_80px_-30px_color-mix(in_oklab,var(--foreground)_45%,transparent)] backdrop-blur-2xl">
      {/* glossy top sheen */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-primary/10 via-transparent to-transparent"
      />

      <header className="relative flex items-center justify-between border-b border-border/50 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-full bg-primary/90 shadow-[inset_0_1px_0_color-mix(in_oklab,white_45%,transparent)]">
            <Sparkle className="size-3.5 text-primary-foreground" />
          </span>
          <span className="text-sm font-semibold tracking-tight">HR copilot</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            title="Start a fresh conversation"
            aria-label="Start a fresh conversation"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            onClick={async () => {
              await reset({});
              qc.setQueryData(["copilot"], []);
            }}
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            aria-label="Close copilot"
            className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-foreground/5 hover:text-foreground"
            onClick={() => setOpen(false)}
          >
            <X className="size-4" />
          </button>
        </div>
      </header>

      <div ref={boxRef} className="relative flex-1 space-y-4 overflow-y-auto px-4 py-4 text-sm">
        {messages.length === 0 ? (
          <div className="space-y-4">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              Ask about your live pipeline, pool health, interviews or offers — every answer is grounded in your
              organisation's own data.
            </p>
            <div className="space-y-2">
              {PROMPTS.map((p) => (
                <button
                  key={p}
                  onClick={() => submit(p)}
                  className="w-full rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-left text-xs leading-snug transition-all hover:border-primary/40 hover:bg-primary/5"
                >
                  {p}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {messages.map((m) =>
          m.role === "user" ? (
            <div
              key={m.id}
              className="ml-auto max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-primary-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,white_35%,transparent)]"
            >
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="max-w-[94%] whitespace-pre-wrap leading-relaxed text-foreground">
              {m.content}
            </div>
          ),
        )}

        {send.isPending ? (
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.2s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-primary [animation-delay:-0.1s]" />
            <span className="size-1.5 animate-bounce rounded-full bg-primary" />
            <span className="ml-1">Thinking…</span>
          </div>
        ) : null}
      </div>

      <form
        className="relative p-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit(draft);
        }}
      >
        <div className="relative rounded-2xl border border-border/60 bg-background/70 shadow-[inset_0_1px_0_color-mix(in_oklab,white_60%,transparent)] transition-colors focus-within:border-primary/50">
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
            className="min-h-[3rem] w-full resize-none bg-transparent px-3.5 py-2.5 pr-12 text-sm outline-none placeholder:text-muted-foreground"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={send.isPending || !draft.trim()}
            className="absolute bottom-2 right-2 flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[inset_0_1px_0_color-mix(in_oklab,white_40%,transparent)] transition-all hover:brightness-110 disabled:opacity-40"
          >
            <ArrowUp className="size-4" />
          </button>
        </div>
      </form>
    </div>
  );
}
