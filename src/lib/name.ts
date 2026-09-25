/**
 * Shared, browser-safe name normalisation for identity comparison: candidate
 * records vs the name the extraction agent read off a document. Deterministic
 * and explainable — no AI call decides whether two names are the same person.
 */

const HONORIFICS = /\b(mr|mrs|ms|dr|prof)\.?\b/g;

/** Lowercased, punctuation-stripped name tokens, sorted so order never matters. */
export function nameTokens(v: string | null | undefined): string[] {
  return (v ?? "")
    .toLowerCase()
    .replace(HONORIFICS, "")
    .replace(/[^a-z\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .sort();
}

/** Canonical string form (sorted tokens) — usable as a map key. */
export const normName = (v: string | null | undefined) => nameTokens(v).join(" ");
