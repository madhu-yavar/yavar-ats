import { BrandLogo } from "@/components/Brand";

export type LegalSection = { title: string; body: string[] };

/** Shared reading layout for the policy pages. */
export function LegalPage({
  title,
  intro,
  sections,
  effective = "3 September 2026",
}: {
  title: string;
  intro: string;
  sections: LegalSection[];
  effective?: string;
}) {
  return (
    <article className="mx-auto max-w-3xl">
      <BrandLogo className="h-6" />
      <h1 className="mt-6 text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{intro}</p>
      <p className="mt-1 text-xs text-muted-foreground">Effective {effective}</p>

      <div className="mt-8 space-y-7">
        {sections.map((s) => (
          <section key={s.title}>
            <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-primary">{s.title}</h2>
            <div className="mt-2 space-y-2 text-sm leading-relaxed text-muted-foreground">
              {s.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
