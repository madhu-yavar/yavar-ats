/**
 * Shared types for the partner job-board adapter layer (LinkedIn / Indeed /
 * Naukri). Adapters are capability-gated: every board's enterprise API is
 * contract-gated, so an adapter must honestly report what the connection can
 * do instead of pretending the happy path exists.
 */

export type BoardProviderId = "linkedin" | "indeed" | "naukri";

export const BOARD_PROVIDERS: BoardProviderId[] = ["linkedin", "indeed", "naukri"];

/** Decrypted connection material for one org + board. Never leaves the server. */
export type BoardConnection = {
  orgId: string;
  provider: BoardProviderId;
  integrationId: string;
  /** False when the integration row is switched off on the Integrations page. */
  enabled: boolean;
  /** source_integrations.config — non-secret setup (base_url, paths, URNs). */
  config: Record<string, string | number | boolean | null>;
  /** Decrypted integration_credentials.secrets. */
  secrets: Record<string, string>;
  /** LinkedIn only: the org's live OAuth token and member id. */
  accessToken?: string;
  memberSub?: string;
};

/** What the connection is actually allowed to do, as far as we can tell. */
export type BoardCapabilities = {
  /** Structured job listings can be filed on the board's Jobs surface. */
  posting: boolean | null;
  /** Applications can be pulled/synced from the board. */
  applications: boolean | null;
  applicationsMode: "webhook" | "polling" | "none";
  /** Shown verbatim in the UI — vendor-neutral, honest about contract gaps. */
  detail: string;
};

/** The requisition fields a board posting is built from. */
export type RequisitionSnapshot = {
  id: string;
  title: string;
  location: string | null;
  openings: number;
  experienceMin: number;
  experienceMax: number;
  mustHaveSkills: string[];
  goodToHaveSkills: string[];
  responsibilities: string | null;
};

export type PublishOutcome = {
  externalId: string | null;
  externalUrl: string | null;
};

/** An application delivered by a board, normalised before intake. */
export type NormalizedApplication = {
  /** Board's id for this application/event — the webhook dedupe key. */
  externalEventId: string;
  externalCandidateId: string | null;
  fullName: string | null;
  email: string | null;
  phone: string | null;
  location: string | null;
  resumeText: string | null;
  resumeUrl: string | null;
  /** The vendor's job/posting id — resolved to a requisition server-side. */
  postingExternalId: string | null;
  appliedAt: Date | null;
  raw: unknown;
};

/**
 * One adapter per board. All outbound HTTP goes through safeFetch /
 * safeFetchText; every vendor payload is treated as untrusted input.
 * Webhook org resolution (delivery token → integration) is provider-generic
 * and lives in the ingestion core — adapters only verify delivery signatures.
 */
export interface BoardAdapter {
  provider: BoardProviderId;
  capabilities(conn: BoardConnection): Promise<BoardCapabilities>;
  publishPosting(
    conn: BoardConnection,
    input: { requisition: RequisitionSnapshot; postText: string | null; applyUrl: string },
  ): Promise<PublishOutcome>;
  closePosting(
    conn: BoardConnection,
    externalId: string,
    reason: "filled" | "closed" | "withdrawn",
  ): Promise<void>;
  pollApplications(
    conn: BoardConnection,
    opts: { since: Date | null; limit: number },
  ): Promise<NormalizedApplication[]>;
  /** Signature/auth check on an inbound delivery. Failure reason is logged, never echoed to the caller. */
  verifyDelivery(ctx: {
    conn: BoardConnection;
    headers: Headers;
    rawBody: string;
  }): Promise<{ ok: boolean; reason?: string }>;
  mapApplication(payload: unknown, conn: BoardConnection): Promise<NormalizedApplication | null>;
}

export function integrationConfig(conn: BoardConnection, key: string): string {
  const value = conn.config[key];
  return typeof value === "string" ? value.trim() : "";
}

/** Base URL of the board's partner API, or "" when not provisioned yet. */
export function boardBaseUrl(conn: BoardConnection): string {
  return integrationConfig(conn, "base_url").replace(/\/$/, "");
}
