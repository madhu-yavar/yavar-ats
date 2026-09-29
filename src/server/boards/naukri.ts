/**
 * Naukri board adapter.
 *
 * Every Naukri enterprise endpoint (Resdex search, job posting, applicant
 * pull) is provisioned by the Info Edge account manager, so all paths and the
 * optional webhook signature header come from source_integrations.config.
 * Until the pack lands, every outbound call is refused with the honest
 * "add it from your onboarding pack" message.
 */
import { safeFetch } from "../safe-fetch";
import { verifyBase64HmacSha256, verifyHexHmacSha256 } from "./hmac";
import { assertBaseUrl, fetchClientToken, requirePath } from "./partner";
import {
  integrationConfig,
  type BoardAdapter,
  type BoardConnection,
  type NormalizedApplication,
  type PublishOutcome,
  type RequisitionSnapshot,
} from "./types";

function accountHeaders(conn: BoardConnection, token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    ...(conn.secrets["account_id"] ? { "X-Account-Id": conn.secrets["account_id"] } : {}),
  };
}

async function verifyDeliveryImpl(ctx: {
  conn: BoardConnection;
  headers: Headers;
  rawBody: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const headerName = integrationConfig(ctx.conn, "webhook_header");
  if (!headerName) return { ok: true }; // token URL alone authenticates the delivery
  const secret = integrationConfig(ctx.conn, "webhook_secret") || ctx.conn.secrets["client_secret"];
  if (!secret) return { ok: false, reason: "no signing secret configured for the webhook header" };
  const value = ctx.headers.get(headerName.toLowerCase());
  if (!value) return { ok: false, reason: `missing ${headerName} header` };
  if (verifyHexHmacSha256(secret, ctx.rawBody, value)) return { ok: true };
  if (verifyBase64HmacSha256(secret, ctx.rawBody, value)) return { ok: true };
  return { ok: false, reason: "signature mismatch" };
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

/** Map a Naukri applicant delivery/poll item into the normalised shape. */
async function mapApplicationImpl(
  payload: unknown,
  _conn: BoardConnection,
): Promise<NormalizedApplication | null> {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  return {
    externalEventId: firstString(body, ["id", "applicationId", "eventId"]) ?? "",
    externalCandidateId: firstString(body, ["candidateId", "profileId", "candidate_id"]),
    fullName: firstString(body, ["name", "full_name", "candidateName"]),
    email: firstString(body, ["email", "emailId", "email_id"]),
    phone: firstString(body, ["phone", "mobile", "contactNumber"]),
    location: firstString(body, ["location", "city", "preferredLocation"]),
    resumeText: firstString(body, ["resume_text", "resumeText", "resume"]),
    resumeUrl: firstString(body, ["resume_url", "resumeUrl"]),
    postingExternalId: firstString(body, ["job_id", "jobId", "jobIdText", "postingId"]),
    appliedAt: null,
    raw: body,
  };
}

async function publishPostingImpl(
  conn: BoardConnection,
  input: { requisition: RequisitionSnapshot; postText: string | null; applyUrl: string },
): Promise<PublishOutcome> {
  const token = await fetchClientToken(conn);
  const path = requirePath(conn, "postings_path", "job posting");
  const payload = {
    title: input.requisition.title,
    description: input.postText?.trim() || input.requisition.responsibilities || "",
    location: input.requisition.location ?? undefined,
    experience: { min: input.requisition.experienceMin, max: input.requisition.experienceMax },
    skills: [...input.requisition.mustHaveSkills, ...input.requisition.goodToHaveSkills],
    openings: input.requisition.openings,
    applyUrl: input.applyUrl,
  };
  const res = await safeFetch(`${assertBaseUrl(conn)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...accountHeaders(conn, token) },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Naukri job posting failed [${res.status}]: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(text) as { id?: string; jobId?: string; url?: string };
  return {
    externalId: parsed.id ?? parsed.jobId ?? null,
    externalUrl: parsed.url ?? null,
  };
}

async function closePostingImpl(
  conn: BoardConnection,
  externalId: string,
  reason: "filled" | "closed" | "withdrawn",
): Promise<void> {
  const token = await fetchClientToken(conn);
  const path = requirePath(conn, "postings_path", "job posting");
  const res = await safeFetch(`${assertBaseUrl(conn)}${path}/${encodeURIComponent(externalId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", ...accountHeaders(conn, token) },
    body: JSON.stringify({ status: reason === "filled" ? "closed_filled" : "closed" }),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Naukri could not close the posting [${res.status}]: ${text.slice(0, 200)}`);
  }
}

async function pollApplicationsImpl(
  conn: BoardConnection,
  opts: { since: Date | null; limit: number },
): Promise<NormalizedApplication[]> {
  const token = await fetchClientToken(conn);
  const path = requirePath(conn, "applications_path", "applications");
  const url = new URL(`${assertBaseUrl(conn)}${path}`);
  url.searchParams.set("limit", String(Math.min(opts.limit, 50)));
  if (opts.since) url.searchParams.set("since", opts.since.toISOString());
  const res = await safeFetch(url.toString(), { headers: accountHeaders(conn, token) });
  const text = await res.text();
  if (!res.ok) throw new Error(`Naukri applications pull failed [${res.status}].`);
  const parsed = JSON.parse(text) as {
    applications?: unknown[];
    candidates?: unknown[];
  } | null;
  const items = parsed?.applications ?? parsed?.candidates ?? [];
  const mapped: NormalizedApplication[] = [];
  for (const item of items) {
    const normalized = await mapApplicationImpl(item, conn);
    if (normalized) mapped.push(normalized);
  }
  return mapped;
}

export const naukriAdapter: BoardAdapter = {
  provider: "naukri",
  capabilities: async (conn) => {
    const hasCredentials = Boolean(conn.secrets["client_id"] && conn.secrets["client_secret"]);
    return {
      posting: hasCredentials ? null : false,
      applications: hasCredentials ? null : false,
      applicationsMode: hasCredentials ? "polling" : "none",
      detail: hasCredentials
        ? "Credentials stored. Posting and applicant pulls stay unavailable until your Naukri account manager provisions the endpoints — add them under Advanced on the Integrations page."
        : "Ask your Naukri account manager for the enterprise pack, then store the client id, client secret and account id.",
    };
  },
  publishPosting: publishPostingImpl,
  closePosting: closePostingImpl,
  pollApplications: pollApplicationsImpl,
  verifyDelivery: verifyDeliveryImpl,
  mapApplication: mapApplicationImpl,
};
