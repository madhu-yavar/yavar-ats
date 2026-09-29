/**
 * HRMS sync — shared provider catalog and normalised shapes.
 *
 * Safe to import from client code: no server modules here. The adapters and
 * sync engine live in hrms.server.ts; the page-facing server functions in
 * hrms.functions.ts.
 */

export type HrmsProviderId = "keka" | "greythr";

export type HrmsCapabilities = {
  readEmployees: boolean;
  /** Native push events — false means the sync engine polls instead. */
  webhooks: boolean;
};

export type HrmsProviderMeta = {
  provider: HrmsProviderId;
  label: string;
  /** Secret field names collected on the Integrations page. */
  credentialFields: string[];
  /** Whether the card asks for a partner API base URL. */
  needsBaseUrl: boolean;
  /** Shown pre-configured as the API base URL. */
  defaultBaseUrl: string | null;
  /** Allow-listed API hosts (exact or dot-suffix match). */
  allowedHosts: string[];
  capabilities: HrmsCapabilities;
  blurb: string;
};

export const HRMS_PROVIDERS: HrmsProviderMeta[] = [
  {
    provider: "keka",
    label: "Keka HRMS",
    credentialFields: ["client_id", "client_secret", "api_key"],
    needsBaseUrl: false,
    defaultBaseUrl: "https://api.keka.com",
    allowedHosts: ["api.keka.com"],
    capabilities: { readEmployees: true, webhooks: true },
    blurb:
      "Sync your employee master — departments, titles, locations — so interviewers, hiring managers and internal candidates come straight from Keka.",
  },
  {
    provider: "greythr",
    label: "greytHR",
    credentialFields: ["api_key"],
    needsBaseUrl: true,
    defaultBaseUrl: null,
    allowedHosts: ["greythr.com"],
    capabilities: { readEmployees: true, webhooks: false },
    blurb:
      "Sync your employee master from greytHR — departments, titles and employment status stay current without re-keying them into ATSIQ.",
  },
];

export function hrmsProviderMeta(provider: string): HrmsProviderMeta | undefined {
  return HRMS_PROVIDERS.find((p) => p.provider === provider);
}

/** Normalised employee row every adapter maps its vendor payload into. */
export type NormalEmployee = {
  externalId: string;
  fullName: string;
  email: string | null;
  employeeCode: string | null;
  department: string | null;
  jobTitle: string | null;
  location: string | null;
  managerExternalId: string | null;
  employmentStatus: string;
  joinedOn: string | null;
  raw: Record<string, unknown>;
};

export type EmployeePage = {
  employees: NormalEmployee[];
  /** Pass back verbatim to fetch the next page; null/absent means done. */
  cursor: Record<string, unknown> | null;
};
