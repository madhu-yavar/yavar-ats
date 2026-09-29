/**
 * Indeed board adapter.
 *
 * Inbound: Indeed Apply delivers applications server-to-server to the
 * per-connection webhook URL; authenticity is the `X-Indeed-Signature` header —
 * HMAC-SHA256 hex over the raw, unmodified body keyed with the shared client
 * secret (docs.indeed.com, "message signature generation").
 * Outbound: posting and application polling are partner-provisioned paths in
 * source_integrations.config — refused honestly until the pack lands.
 */
import { safeFetch } from "../safe-fetch";
import { verifyHexHmacSha256 } from "./hmac";
import { assertBaseUrl, fetchClientToken, requirePath } from "./partner";
import {
  integrationConfig,
  type BoardAdapter,
  type BoardConnection,
  type NormalizedApplication,
  type PublishOutcome,
  type RequisitionSnapshot,
} from "./types";

/** The secret Indeed signs with: the stored client secret unless overridden. */
function webhookSecret(conn: BoardConnection): string {
  return integrationConfig(conn, "webhook_secret") || conn.secrets["client_secret"] || "";
}

async function verifyDeliveryImpl(ctx: {
  conn: BoardConnection;
  headers: Headers;
  rawBody: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const secret = webhookSecret(ctx.conn);
  if (!secret) {
    return { ok: false, reason: "no client secret stored — cannot verify the delivery signature" };
  }
  const signature = ctx.headers.get("x-indeed-signature");
  if (!signature) {
    return { ok: false, reason: "missing X-Indeed-Signature header" };
  }
  if (!verifyHexHmacSha256(secret, ctx.rawBody, signature)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

function firstString(source: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function nested(
  source: Record<string, unknown>,
  keys: string[],
): Record<string, unknown> | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  }
  return undefined;
}

/** Map an Indeed Apply delivery into the normalised shape. */
async function mapApplicationImpl(
  payload: unknown,
  _conn: BoardConnection,
): Promise<NormalizedApplication | null> {
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const applicant = nested(body, ["applicant", "candidate", "jobApplicant"]) ?? {};
  const job = nested(body, ["job", "jobPosting"]) ?? {};

  let resumeText: string | null = null;
  const inlineResume = firstString(body, ["resume", "resumeText"]);
  if (inlineResume && !/^https?:\/\//i.test(inlineResume)) {
    // Indeed may deliver base64 file bytes — keep them only when they decode
    // to readable text; a hosted document stays in resumeUrl for the intake
    // step to fetch.
    try {
      const decoded = Buffer.from(inlineResume, "base64").toString("utf8");
      let printable = 0;
      const sample = decoded.slice(0, 512);
      for (const ch of sample) {
        const code = ch.codePointAt(0) ?? 0;
        // tab/newline/CR or any normal printable incl. non-latin scripts
        if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127))
          printable += 1;
      }
      resumeText = sample.length > 0 && printable / sample.length > 0.9 ? decoded : null;
    } catch {
      resumeText = null;
    }
  }

  return {
    externalEventId: firstString(body, ["id", "applicationId", "applicationUUID"]) ?? "",
    externalCandidateId: firstString(applicant, ["id", "candidateId"]),
    fullName: firstString(applicant, ["fullName", "full_name", "name"]),
    email: firstString(applicant, ["email", "emailAddress"]),
    phone: firstString(applicant, ["phoneNumber", "phone"]),
    location: firstString(nested(applicant, ["location"]) ?? {}, ["city", "country", "name"]),
    resumeText,
    resumeUrl: firstString(body, ["resumeUrl", "resumeDownloadUrl"]),
    postingExternalId: firstString(job, ["jobId", "id", "jobIdText"]),
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
    applyUrl: input.applyUrl,
  };
  const res = await safeFetch(`${assertBaseUrl(conn)}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Indeed job posting failed [${res.status}]: ${text.slice(0, 200)}`);
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
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status: reason === "filled" ? "closed_filled" : "closed" }),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Indeed could not close the posting [${res.status}]: ${text.slice(0, 200)}`);
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
  const res = await safeFetch(url.toString(), {
    headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Indeed applications pull failed [${res.status}].`);
  const parsed = JSON.parse(text) as {
    applications?: unknown[];
    elements?: unknown[];
  } | null;
  const items = parsed?.applications ?? parsed?.elements ?? [];
  const mapped: NormalizedApplication[] = [];
  for (const item of items) {
    const normalized = await mapApplicationImpl(item, conn);
    if (normalized) mapped.push(normalized);
  }
  return mapped;
}

export const indeedAdapter: BoardAdapter = {
  provider: "indeed",
  capabilities: async (conn) => {
    const hasCredentials = Boolean(conn.secrets["client_id"] && conn.secrets["client_secret"]);
    return {
      posting: hasCredentials ? null : false,
      applications: hasCredentials ? null : false,
      applicationsMode: "webhook",
      detail: hasCredentials
        ? "Applications arrive at your ATSIQ webhook once Indeed registers it against your employer account. Structured posting and application pulls stay unavailable until your partner pack lists the endpoints."
        : "Store the Indeed client id, client secret and employer id, then register the ATSIQ webhook URL with your Indeed account.",
    };
  },
  publishPosting: publishPostingImpl,
  closePosting: closePostingImpl,
  pollApplications: pollApplicationsImpl,
  verifyDelivery: verifyDeliveryImpl,
  mapApplication: mapApplicationImpl,
};
