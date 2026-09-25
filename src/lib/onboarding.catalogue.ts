/**
 * Browser-safe copy of the pre-onboarding document catalogue. The server keeps
 * the authoritative list (src/lib/onboarding.server.ts); this one only supplies
 * labels and hints to the UI, so no server module is pulled into the bundle.
 */
import { nameTokens } from "./name";

export type DocTypeOption = { key: string; label: string; required: boolean; hint: string };

export const DOC_TYPES: DocTypeOption[] = [
  {
    key: "id_proof",
    label: "Government photo ID",
    required: true,
    hint: "Aadhaar, passport, driving licence or PAN — name and date of birth must match the offer.",
  },
  {
    key: "experience_letter",
    label: "Experience / relieving letter",
    required: true,
    hint: "One per employer claimed on the CV, on company letterhead.",
  },
  {
    key: "payslip",
    label: "Recent payslips",
    required: true,
    hint: "Last three months — this is what proves the last drawn CTC.",
  },
  {
    key: "education_certificate",
    label: "Education certificate",
    required: true,
    hint: "Highest qualification — degree certificate or final marksheet.",
  },
  {
    key: "salary_revision",
    label: "Salary revision / appraisal letter",
    required: false,
    hint: "Confirms the current fixed and variable split.",
  },
  {
    key: "bank_details",
    label: "Bank account proof",
    required: false,
    hint: "Cancelled cheque or bank statement header for payroll setup.",
  },
  {
    key: "address_proof",
    label: "Address proof",
    required: false,
    hint: "Current residential address for the background check.",
  },
  {
    key: "background_form",
    label: "Background verification form",
    required: false,
    hint: "Signed consent and declaration.",
  },
  { key: "other", label: "Other document", required: false, hint: "Anything else HR asked for." },
];

export function docTypeLabel(key: string): string {
  return DOC_TYPES.find((d) => d.key === key)?.label ?? key;
}

/* ------------------------------------------------------- extraction cross-checks */

/**
 * What the agent's free-text `document_kind` reading actually is, category-wise.
 * Ordered — first confident match wins. Anything ambiguous ("letter",
 * "certificate", "offer letter", very short strings) maps to null: no claim,
 * no warning. The table is data on purpose — tune it as readings evolve.
 */
const KIND_RULES: [RegExp, string][] = [
  [/aadhaar|aadhar|uidai/, "id_proof"],
  [/passport/, "id_proof"],
  [/\bpan\b|pan card/, "id_proof"],
  [/driving licen[cs]e|voter id|election card/, "id_proof"],
  [/id card|identity card|id proof|photo id/, "id_proof"],
  [/pay ?slip|salary slip|pay ?stub|wage slip/, "payslip"],
  [
    /experience letter|relieving (letter|certificate)|service (letter|certificate)|resignation (acceptance )?letter|employment (letter|certificate)|\bnoc\b/,
    "experience_letter",
  ],
  [
    /appraisal letter|increment letter|salary revision|revision letter|promotion letter/,
    "salary_revision",
  ],
  [
    /degree|mark ?sheet|provisional certificate|convocation|diploma|transcript|b\.?tech|\bb\.?e\b|bachelor|master of|\bmba\b|\bmca\b|\bbsc\b|\bmsc\b/,
    "education_certificate",
  ],
  [/cancelled cheque|cheque leaf|bank statement|passbook/, "bank_details"],
  [/rent agreement|utility bill|electricity bill|address proof/, "address_proof"],
  [/background verification|bgv form|self declaration|consent form/, "background_form"],
];

/** The category a `document_kind` reading points at, or null when it is too vague to claim. */
export function detectDocKind(kind: string | null | undefined): string | null {
  const k = (kind ?? "").trim().toLowerCase();
  if (k.length < 3) return null;
  return KIND_RULES.find(([re]) => re.test(k))?.[1] ?? null;
}

/**
 * The category this row should be re-filed as when the reading clearly
 * contradicts the category it was filed under, else null.
 */
export function docKindMismatch(
  rowDocType: string,
  kind: string | null | undefined,
): string | null {
  const hit = detectDocKind(kind);
  return hit && hit !== rowDocType ? hit : null;
}

/**
 * Identity check between the candidate's name and the name on the document.
 * Tokens match on equality or single-letter initial ("p sharma" ≈ "priya
 * sharma"). "mismatch" means zero shared tokens — the reviewer must justify.
 * Partial names are fine: "priya sharma" covers candidate "priya sharma rao".
 */
export function nameCheck(
  candidateName: string | null | undefined,
  docName: string | null | undefined,
): "match" | "mismatch" | "unknown" {
  const a = nameTokens(candidateName);
  const b = nameTokens(docName);
  if (!a.length || !b.length) return "unknown";
  const same = (x: string, y: string) =>
    x === y || (x.length === 1 && y.startsWith(x)) || (y.length === 1 && x.startsWith(y));
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  const covered = shorter.every((t) => longer.some((o) => same(t, o)));
  if (covered) return "match";
  return shorter.some((t) => longer.some((o) => same(t, o))) ? "match" : "mismatch";
}

/** Normalise a gender reading ("F", "Female", "other") to the profile enum, else null. */
export function genderNorm(v: string | null | undefined): "male" | "female" | "other" | null {
  const k = (v ?? "").trim().toLowerCase();
  if (/^f/.test(k)) return "female";
  if (/^m/.test(k)) return "male";
  if (/^(other|third|x)/.test(k)) return "other";
  return null;
}
