/**
 * Browser-safe copy of the pre-onboarding document catalogue. The server keeps
 * the authoritative list (src/lib/onboarding.server.ts); this one only supplies
 * labels and hints to the UI, so no server module is pulled into the bundle.
 */
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
