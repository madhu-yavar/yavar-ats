import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
      <div className="space-y-1">
        {eyebrow ? (
          <div className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">{eyebrow}</div>
        ) : null}
        <h1 className="text-2xl font-semibold">{title}</h1>
        {description ? <p className="max-w-2xl text-sm text-muted-foreground">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </header>
  );
}

export function StatCard({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "default" | "success" | "warning" | "destructive";
}) {
  const toneClass = {
    default: "text-foreground",
    success: "text-success",
    warning: "text-warning",
    destructive: "text-destructive",
  }[tone];
  return (
    <div className="panel p-5">
      <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={cn("num mt-2 text-3xl font-semibold", toneClass)}>{value}</div>
      {hint ? <div className="mt-1 text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  );
}

export function scoreTone(score: number) {
  if (score >= 75) return "success" as const;
  if (score >= 60) return "warning" as const;
  return "destructive" as const;
}

export function ScoreBar({
  label,
  score,
  weight,
  weighted,
}: {
  label: string;
  score: number;
  weight?: number;
  weighted?: number;
}) {
  const tone = scoreTone(score);
  const barClass = {
    success: "bg-success",
    warning: "bg-warning",
    destructive: "bg-destructive",
  }[tone];
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="font-medium">
          {label}
          {weight !== undefined ? (
            <span className="num ml-2 text-xs text-muted-foreground">weight {weight}%</span>
          ) : null}
        </span>
        <span className="num text-sm font-semibold">
          {score}
          {weighted !== undefined ? (
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              → +{weighted} pts
            </span>
          ) : null}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={cn("h-full rounded-full transition-all", barClass)} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

export function ScoreChip({ score, size = "md" }: { score: number; size?: "sm" | "md" | "lg" }) {
  const tone = scoreTone(score);
  const toneClass = {
    success: "bg-success/12 text-success border-success/30",
    warning: "bg-warning/15 text-warning border-warning/35",
    destructive: "bg-destructive/10 text-destructive border-destructive/30",
  }[tone];
  const sizeClass = {
    sm: "h-7 min-w-11 text-xs",
    md: "h-9 min-w-14 text-sm",
    lg: "h-14 min-w-20 text-2xl",
  }[size];
  return (
    <div
      className={cn(
        "num inline-flex items-center justify-center rounded-md border font-semibold",
        toneClass,
        sizeClass,
      )}
    >
      {score}
    </div>
  );
}

const STAGE_LABEL: Record<string, string> = {
  applied: "Applied",
  ai_screened: "AI screened",
  shortlisted: "Shortlisted",
  l1: "L1 — Technical",
  l2: "L2 — Dept Head",
  l3: "L3 — HR / CBO",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

export function StageBadge({ stage }: { stage: string }) {
  return (
    <Badge variant={stage === "rejected" ? "destructive" : stage === "hired" ? "default" : "secondary"}>
      {STAGE_LABEL[stage] ?? stage}
    </Badge>
  );
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  pending_dh: "Pending Dept Head",
  pending_hr: "Pending HR Head",
  pending_cbo: "Pending President & CBO",
  approved: "Approved",
  rejected: "Rejected",
  on_hold: "On hold",
  closed: "Closed",
  changes_requested: "Changes requested",
  released: "Released",
  accepted: "Accepted",
  declined: "Declined",
  revoked: "Revoked",
};

export function StatusBadge({ status }: { status: string }) {
  const variant =
    status === "approved" || status === "accepted"
      ? "default"
      : status === "rejected" || status === "declined" || status === "revoked"
        ? "destructive"
        : "outline";
  return <Badge variant={variant}>{STATUS_LABEL[status] ?? status}</Badge>;
}

export function SkillPills({
  skills,
  tone = "neutral",
}: {
  skills: string[];
  tone?: "match" | "miss" | "neutral";
}) {
  if (!skills.length) return <span className="text-sm text-muted-foreground">—</span>;
  const toneClass = {
    match: "border-success/30 bg-success/10 text-success",
    miss: "border-destructive/30 bg-destructive/10 text-destructive",
    neutral: "border-border bg-secondary text-secondary-foreground",
  }[tone];
  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((s) => (
        <span key={s} className={cn("rounded-md border px-2 py-0.5 text-xs font-medium", toneClass)}>
          {s}
        </span>
      ))}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="panel flex flex-col items-center gap-1 p-10 text-center">
      <p className="font-medium">{title}</p>
      {hint ? <p className="text-sm text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export const inr = (value: number | null | undefined) =>
  value == null
    ? "—"
    : new Intl.NumberFormat("en-IN", {
        style: "currency",
        currency: "INR",
        maximumFractionDigits: 0,
        notation: value >= 10_000_000 ? "compact" : "standard",
      }).format(value);
