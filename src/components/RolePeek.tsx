import { Link } from "@tanstack/react-router";
import { ArrowUpRight, FileText } from "lucide-react";

import type { Requisition } from "@/lib/data";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { inr, StatusBadge } from "@/components/ats";

/**
 * The role title, clickable everywhere it appears. Opens the job description
 * itself, so nobody has to guess what a captured role actually is.
 */
export function RolePeek({ requisition }: { requisition: Requisition }) {
  const r = requisition;
  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className="group max-w-[220px] text-left"
          title="See the job description"
        >
          <span className="block truncate font-medium underline-offset-2 group-hover:underline">
            {r.title}
          </span>
          <span className="num flex items-center gap-1 text-xs text-muted-foreground">
            {r.code}
            <FileText className="size-3" />
          </span>
        </button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-6">{r.title}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="num">{r.code}</span>
            {r.location ? <span>{r.location}</span> : null}
            <span>
              {r.openings} opening{r.openings === 1 ? "" : "s"}
            </span>
            <StatusBadge status={r.status} />
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-3">
          <Fact label="Experience" value={`${r.experience_min}–${r.experience_max} yrs`} />
          <Fact label="Budget" value={r.budget_ctc ? inr(Number(r.budget_ctc)) : "Not set"} />
          <Fact label="Hiring manager" value={r.hiring_manager || "Not assigned"} />
        </div>

        {(r.must_have_skills ?? []).length ? (
          <Section title="Must have">
            <div className="flex flex-wrap gap-1.5">
              {(r.must_have_skills ?? []).map((s) => (
                <Badge key={s}>{s}</Badge>
              ))}
            </div>
          </Section>
        ) : null}

        {(r.good_to_have_skills ?? []).length ? (
          <Section title="Good to have">
            <div className="flex flex-wrap gap-1.5">
              {(r.good_to_have_skills ?? []).map((s) => (
                <Badge key={s} variant="secondary">
                  {s}
                </Badge>
              ))}
            </div>
          </Section>
        ) : null}

        {r.responsibilities ? (
          <Section title="Job description">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-muted-foreground">
              {r.responsibilities}
            </p>
          </Section>
        ) : (
          <Section title="Job description">
            <p className="text-sm text-muted-foreground">
              No description saved on this role yet — open it to write or generate one.
            </p>
          </Section>
        )}

        {r.education_requirement ? (
          <Section title="Qualification">
            <p className="text-sm text-muted-foreground">{r.education_requirement}</p>
          </Section>
        ) : null}

        <div className="flex justify-end pt-2">
          <Button asChild variant="outline" size="sm">
            <Link to="/requisitions/$id" params={{ id: r.id }}>
              Open the role <ArrowUpRight />
            </Link>
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        {title}
      </h3>
      {children}
    </section>
  );
}
