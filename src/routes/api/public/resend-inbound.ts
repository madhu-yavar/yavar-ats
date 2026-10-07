import { createFileRoute } from "@tanstack/react-router";
/**
 * Resend Receiving webhook — the reply leg of candidate communication.
 *
 * Resend receives mail addressed to anything@atsiq.yavar.ai (the MX added with
 * the verified domain) and POSTs an `email.received` event here. Webhooks carry
 * metadata only, so the handler fetches the full message — and attachment bytes
 * via the signed download URLs — with a deployment-level API key, then feeds
 * receiveMail (the same intake the careers inbox uses) so replies and documents
 * file against candidates exactly like the M365 path.
 *
 * Security: Svix signature verification on the raw body (Resend signs each
 * delivery), plus a timestamp window against replay. Set
 * RESEND_INBOUND_WEBHOOK_SECRET (whsec_… from the Resend webhook page) and
 * RESEND_API_KEY (an API key with receiving read access) on the deployment.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNotNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "../../../server/db";
import { organizations } from "@db/schema";

const MAX_ATTACHMENT_BYTES = 10_000_000;
const MAX_TOTAL_ATTACHMENT_BYTES = 25_000_000;
const MAX_ATTACHMENTS = 10;
const SVIX_TOLERANCE_SECONDS = 300;

/** Svix (Resend) signature check over the raw body: v1,HMAC-SHA256(id.ts.body). */
function verifySvix(rawBody: string, headers: Headers, secretEnv: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signatureHeader = headers.get("svix-signature");
  if (!id || !timestamp || !signatureHeader) return false;

  const stamp = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(stamp) || Math.abs(now - stamp) > SVIX_TOLERANCE_SECONDS) return false;

  const key = Buffer.from(secretEnv.replace(/^whsec_/, ""), "base64");
  const expected = createHmac("sha256", key)
    .update(`${id}.${timestamp}.${rawBody}`)
    .digest("base64");
  return signatureHeader
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .some((part) => {
      const given = Buffer.from(part.slice(3));
      const want = Buffer.from(expected);
      return given.length === want.length && timingSafeEqual(given, want);
    });
}

const Event = z.object({
  type: z.string(),
  data: z.object({
    id: z.string().optional(),
    email_id: z.string().optional(),
    to: z.array(z.string()).optional(),
    from: z.string().optional(),
    subject: z.string().nullish(),
  }),
});

interface ReceivedAttachmentMeta {
  id: string;
  filename?: string | null;
  content_type?: string | null;
}

async function fetchJson(url: string, key: string): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Resend receiving API HTTP ${res.status} for ${url}`);
  return res.json();
}

async function run(request: Request): Promise<Response> {
  const secret = process.env["RESEND_INBOUND_WEBHOOK_SECRET"];
  if (!secret) return new Response("Server configuration error", { status: 500 });

  const raw = await request.text();
  if (!verifySvix(raw, request.headers, secret)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let event: z.infer<typeof Event>;
  try {
    event = Event.parse(JSON.parse(raw));
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message.slice(0, 200) : "Invalid event payload." },
      { status: 400 },
    );
  }
  if (event.type !== "email.received") return Response.json({ status: "ignored" });

  const emailId = event.data.email_id ?? event.data.id;
  if (!emailId) return Response.json({ status: "skipped", detail: "No email id on the event." });

  const key = process.env["RESEND_API_KEY"];
  if (!key) {
    return Response.json({
      status: "skipped",
      detail: "RESEND_API_KEY is not set on the deployment — received content cannot be fetched.",
    });
  }

  // Metadata → full message. Attachments are downloaded separately through
  // signed URLs, bounded by the same caps as the careers-inbox intake.
  let full: {
    to?: string[];
    from?: string;
    subject?: string | null;
    text?: string | null;
    message_id?: string | null;
    attachments?: ReceivedAttachmentMeta[];
  };
  try {
    const base = process.env["RESEND_API_BASE"] || "https://api.resend.com";
    full = (await fetchJson(`${base}/emails/receiving/${emailId}`, key)) as typeof full;
  } catch (e) {
    const { logApp } = await import("../../../server/logger");
    try {
      await logApp("error", "email", `resend-inbound fetch failed for ${emailId}`, {
        detail: { error: e instanceof Error ? e.message : String(e) },
      });
    } catch {
      /* logging must never mask the response */
    }
    return Response.json({
      status: "skipped",
      detail: "Received message could not be fetched from Resend.",
    });
  }

  const attachments: { filename: string; content: string; contentType?: string }[] = [];
  let totalBytes = 0;
  for (const att of (full.attachments ?? []).slice(0, MAX_ATTACHMENTS)) {
    try {
      const base = process.env["RESEND_API_BASE"] || "https://api.resend.com";
      const meta = (await fetchJson(
        `${base}/emails/receiving/${emailId}/attachments/${att.id}`,
        key,
      )) as { download_url?: string };
      if (!meta.download_url) continue;
      const bin = await fetch(meta.download_url, { signal: AbortSignal.timeout(30_000) });
      if (!bin.ok) continue;
      const bytes = new Uint8Array(await bin.arrayBuffer());
      if (bytes.byteLength > MAX_ATTACHMENT_BYTES) continue;
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) break;
      attachments.push({
        filename: att.filename ?? "attachment",
        content: Buffer.from(bytes).toString("base64"),
        ...(att.content_type ? { contentType: att.content_type } : {}),
      });
    } catch {
      // one bad attachment must not sink the message
    }
  }

  const { receiveMail } = await import("@/lib/local-inbox.server");
  const mail = {
    to: (full.to ?? event.data.to ?? []).join(", "),
    from: full.from ?? event.data.from ?? "",
    subject: full.subject ?? event.data.subject ?? null,
    text: full.text ?? null,
    messageId: full.message_id ?? emailId,
    attachments,
  };

  let result = await receiveMail(mail);

  // Platform-owned addresses (noreply@, replies@) name no tenant, so
  // receiveMail cannot resolve them. While the platform runs a single active
  // tenant with a registered careers address, fall back to it — reply tokens
  // (next slice) replace this with precise per-application routing.
  if (result.status === "error" && /No organisation owns the address/i.test(result.detail)) {
    const orgs = await db
      .select({ careersEmail: organizations.careersEmail })
      .from(organizations)
      .where(and(eq(organizations.status, "active"), isNotNull(organizations.careersEmail)))
      .limit(2);
    const single = orgs.length === 1 ? orgs[0]!.careersEmail : null;
    if (single) result = await receiveMail({ ...mail, to: single });
  }

  return Response.json(result, { status: result.status === "error" ? 422 : 200 });
}

export const Route = createFileRoute("/api/public/resend-inbound")({
  server: { handlers: { POST: ({ request }) => run(request) } },
});
