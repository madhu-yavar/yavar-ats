/**
 * Per-organisation integration row seeding.
 *
 * The Integrations page reads this tenant's own source_integrations rows, so a
 * freshly registered organisation must get the provider catalog at creation
 * time. The same catalog is backfilled for pre-existing orgs by
 * drizzle/pg-migrations/0018_board_connections.sql — keep the two in sync.
 */
import { db } from "./db";
import { sourceIntegrations } from "@db/schema";

export type SeedIntegration = {
  provider: string;
  label: string;
  category: "sourcing" | "meeting";
  config: Record<string, string>;
  credentialFields: string[];
};

export const INTEGRATION_CATALOG: SeedIntegration[] = [
  {
    provider: "linkedin",
    label: "LinkedIn (company account)",
    category: "sourcing",
    config: {
      docs: "https://developer.linkedin.com/",
      notes:
        "Connects the company's own LinkedIn account. Job posts publish from it and applicants come back through your apply link. Structured Jobs-board listings and applicant sync need the paid Job Posting / Talent Solutions products on your LinkedIn contract.",
    },
    credentialFields: ["client_id", "client_secret"],
  },
  {
    provider: "naukri",
    label: "Naukri Resdex / Recruiter API",
    category: "sourcing",
    config: {
      docs: "https://www.naukri.com/recruiter",
      notes: "Enterprise Resdex subscription required for resume search and applicant pulls.",
    },
    credentialFields: ["client_id", "client_secret", "account_id"],
  },
  {
    provider: "indeed",
    label: "Indeed Apply + Job Feed",
    category: "sourcing",
    config: {
      docs: "https://docs.indeed.com/",
      notes: "Job feed plus the Indeed Apply webhook for applicants.",
    },
    credentialFields: ["client_id", "client_secret", "employer_id"],
  },
  {
    provider: "github",
    label: "GitHub Public API",
    category: "sourcing",
    config: {
      notes: "Token optional; it raises the rate limit from 60 to 5000 requests/hour.",
    },
    credentialFields: ["token"],
  },
  {
    provider: "careers",
    label: "Careers page / email applies",
    category: "sourcing",
    config: {
      notes: "Always available. Candidates added manually or by resume paste.",
    },
    credentialFields: [],
  },
  {
    provider: "zoom",
    label: "Zoom (meeting links)",
    category: "meeting",
    config: {},
    credentialFields: ["account_id", "client_id", "client_secret"],
  },
  {
    provider: "google_meet",
    label: "Google Calendar / Meet",
    category: "meeting",
    config: {},
    credentialFields: ["client_id", "client_secret", "refresh_token"],
  },
  {
    provider: "teams",
    label: "Microsoft Teams",
    category: "meeting",
    config: {},
    credentialFields: ["tenant_id", "client_id", "client_secret", "organizer_email"],
  },
];

/**
 * Create the catalog rows for one organisation. Idempotent and best-effort:
 * a seeding failure must never break organisation creation, so the caller can
 * fire-and-forget this.
 */
export async function seedSourceIntegrations(orgId: string): Promise<void> {
  try {
    await db
      .insert(sourceIntegrations)
      .values(
        INTEGRATION_CATALOG.map((p) => ({
          orgId,
          provider: p.provider,
          label: p.label,
          enabled: false,
          category: p.category,
          config: p.config,
          credentialFields: p.credentialFields,
        })),
      )
      .onConflictDoNothing();
  } catch (e) {
    console.error("[integrations] could not seed integration rows for org", orgId, e);
  }
}
