import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, Loader2 } from "lucide-react";

import { getAssessment, submitAssessment } from "@/lib/assessment.functions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export const Route = createFileRoute("/assess/$token")({
  head: () => ({
    meta: [
      { title: "Ways-of-working questionnaire | Yavar Hiring" },
      {
        name: "description",
        content:
          "A short set of situational questions about how you work. Answer with real examples from your own experience — there are no trick questions.",
      },
      { property: "og:title", content: "Ways-of-working questionnaire" },
      {
        property: "og:description",
        content: "Six situational questions about ownership, learning and collaboration. Takes about 15 minutes.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AssessmentPage,
});

function AssessmentPage() {
  const { token } = Route.useParams();
  const load = useServerFn(getAssessment);
  const submit = useServerFn(submitAssessment);

  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const q = useQuery({
    queryKey: ["assessment", token],
    queryFn: () => load({ data: { token } }),
    retry: false,
  });

  if (q.isLoading) {
    return (
      <main className="grid min-h-screen place-items-center">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </main>
    );
  }

  if (q.isError) {
    return (
      <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6">
        <p className="text-center text-sm text-muted-foreground">
          {q.error instanceof Error ? q.error.message : "This link is no longer valid."}
        </p>
      </main>
    );
  }

  const data = q.data!;
  const completed = done || data.status === "completed";

  if (completed) {
    return (
      <main className="mx-auto grid min-h-screen max-w-lg place-items-center px-6">
        <div className="panel p-8 text-center">
          <CheckCircle2 className="mx-auto size-8 text-primary" />
          <h1 className="mt-3 text-lg font-semibold">Thank you</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Your answers are with the hiring team. Someone will be in touch about the next step.
          </p>
        </div>
      </main>
    );
  }

  const unanswered = data.questions.filter((qq) => (answers[qq.id] ?? "").trim().length < 40).length;

  async function onSubmit() {
    setSending(true);
    try {
      await submit({
        data: {
          token,
          answers: data.questions.map((qq) => ({ id: qq.id, answer: (answers[qq.id] ?? "").trim() })),
        },
      });
      setDone(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not submit your answers");
    } finally {
      setSending(false);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-12">
      <h1 className="text-2xl font-semibold">How you work</h1>
      <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
        {data.candidateName ? `${data.candidateName}, ` : ""}these are situational questions, not a test of knowledge.
        Answer with something you have actually done: the situation, what you decided, and how it turned out. A few
        sentences each is plenty, and you can only submit once.
      </p>

      <div className="mt-8 space-y-6">
        {data.questions.map((qq, i) => (
          <section key={qq.id} className="panel p-5">
            <Label className="text-xs uppercase tracking-wide text-muted-foreground">{qq.dimension}</Label>
            <p className="mt-1 font-medium">
              {i + 1}. {qq.prompt}
            </p>
            <Textarea
              className="mt-3 min-h-28"
              placeholder="Situation → what you did → outcome"
              value={answers[qq.id] ?? ""}
              onChange={(e) => setAnswers((prev) => ({ ...prev, [qq.id]: e.target.value }))}
            />
          </section>
        ))}
      </div>

      <div className="mt-6 flex items-center justify-between gap-4">
        <p className="text-xs text-muted-foreground">
          {unanswered > 0
            ? `${unanswered} answer${unanswered === 1 ? "" : "s"} still look very short.`
            : "All questions answered."}
        </p>
        <Button onClick={onSubmit} disabled={sending}>
          {sending ? <Loader2 className="size-4 animate-spin" /> : null} Submit answers
        </Button>
      </div>
    </main>
  );
}
