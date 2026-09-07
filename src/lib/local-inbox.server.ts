/**
 * Local careers inbox, one per organisation.
 *
 * Each tenant gets its own ATSIQ address (for example acme@careers.atsiq.yavar.ai).
 * Mail sent there — LinkedIn application alerts, board notifications, direct
 * applicants — arrives on the inbound webhook, is stored in inbox_messages and
 * the attached CV is parsed straight into the talent pool. HR configures nothing.
 */
import { ingestCandidate } from "./intake.server";

export const INBOX_DOMAIN = process.env["INBOUND_EMAIL_DOMAIN"] ?? "careers.atsiq.yavar.ai";

export function inboxAddress(slug: string | null | undefined): string | null {
  const clean = (slug ?? "").trim().toLowerCase();
  return clean ? `${clean}@${INBOX_DOMAIN}` : null;
}

/** Local part of any recipient address, lower-cased. */
export function localPart(address: string): string {
  const m = /<([^>]+)>/.exec(address);
  const bare = (m?.[1] ?? address).trim().toLowerCase();
  const at = bare.indexOf("@");
  return (at === -1 ? bare : bare.slice(0, at)).replace(/\+.*$/, "");
}

export function displayName(from: string): { email: string; name: string | null } {
  const m = /^\s*"?([^"<]*)"?\s*<([^>]+)>\s*$/.exec(from);
  if (m) return { email: (m[2] ?? "").trim().toLowerCase(), name: (m[1] ?? "").trim() || null };
  return { email: from.trim().toLowerCase(), name: null };
}

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type InboundAttachment = { filename: string; content: string; contentType?: string | undefined };

export type InboundMail = {
  to: string;
  from: string;
  subject?: string | null | undefined;
  text?: string | null | undefined;
  messageId?: string | null | undefined;
  attachments?: InboundAttachment[] | undefined;
};

export type InboundResult = {
  status: "imported" | "updated" | "stored" | "skipped" | "error";
  detail: string;
  messageId: string | null;
  candidateId?: string | null;
};

function base64ToBytes(data: string): Uint8Array {
  const b64 = data.replace(/^data:[^;]+;base64,/, "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The open role whose title appears in the mail, so the CV joins the right pipeline. */
async function matchRequisition(orgId: string, haystack: string): Promise<string | null> {
  const db = await admin();
  const { data } = await db
    .from("requisitions")
    .select("id, title")
    .eq("org_id", orgId)
    .eq("status", "approved");
  const text = haystack.toLowerCase();
  let best: { id: string; len: number } | null = null;
  for (const r of data ?? []) {
    const title = (r.title ?? "").trim().toLowerCase();
    if (title.length > 3 && text.includes(title) && (!best || title.length > best.len)) {
      best = { id: r.id, len: title.length };
    }
  }
  return best?.id ?? null;
}

/**
 * Handle one inbound mail: resolve the tenant from the recipient, record it and
 * import any CV attachment. Never throws — every outcome is stored on the row so
 * HR can see exactly what happened to each mail.
 */
export async function receiveMail(mail: InboundMail): Promise<InboundResult> {
  const db = await admin();
  const slug = localPart(mail.to ?? "");
  if (!slug) return { status: "error", detail: "No recipient address on the mail.", messageId: null };

  const { data: org } = await db
    .from("organizations")
    .select("id, status, inbox_slug")
    .ilike("inbox_slug", slug)
    .maybeSingle();
  if (!org) {
    return { status: "error", detail: `No organisation owns the address ${slug}.`, messageId: null };
  }
  if (org.status && org.status !== "active") {
    return { status: "error", detail: "That organisation is not active.", messageId: null };
  }

  const sender = displayName(mail.from ?? "");
  const { attachmentText, looksLikeCv } = await import("./inbox.server");
  const attachments = (mail.attachments ?? []).filter((a) => looksLikeCv(a.filename ?? ""));
  const cv = attachments[0] ?? null;

  const row = {
    org_id: org.id,
    to_address: mail.to,
    from_email: sender.email || null,
    from_name: sender.name,
    subject: mail.subject ?? null,
    body: (mail.text ?? "").slice(0, 20000) || null,
    attachment_name: cv?.filename ?? null,
    provider_message_id: mail.messageId ?? null,
    status: "received",
    received_at: new Date().toISOString(),
  };

  const { data: saved, error: saveError } = await db
    .from("inbox_messages")
    .insert(row as never)
    .select("id")
    .single();
  if (saveError || !saved) {
    // A duplicate delivery from the mail provider is not a failure.
    if (saveError?.code === "23505") {
      return { status: "skipped", detail: "Already received.", messageId: null };
    }
    return {
      status: "error",
      detail: saveError?.message ?? "Could not record the mail.",
      messageId: null,
    };
  }

  const finish = async (result: InboundResult) => {
    await db
      .from("inbox_messages")
      .update({
        status: result.status === "stored" ? "received" : result.status,
        detail: result.detail,
        candidate_id: result.candidateId ?? null,
      } as never)
      .eq("id", saved.id);
    return { ...result, messageId: saved.id };
  };

  if (!cv) {
    return finish({
      status: "skipped",
      detail: "No CV attached — nothing to file.",
      messageId: saved.id,
    });
  }

  try {
    const bytes = base64ToBytes(cv.content);
    const text = await attachmentText(cv.filename, bytes);
    if (text.trim().length < 40) {
      return finish({ status: "error", detail: "The attachment could not be read.", messageId: saved.id });
    }
    const requisitionId = await matchRequisition(
      org.id,
      `${mail.subject ?? ""} ${mail.text ?? ""} ${cv.filename}`,
    );
    const ingested = await ingestCandidate({
      resumeText: text,
      fileName: cv.filename,
      requisitionId,
      orgId: org.id,
      source: "careers_inbox",
    });
    await db
      .from("inbox_messages")
      .update({ requisition_id: requisitionId, attachment_bytes: bytes.length } as never)
      .eq("id", saved.id);
    return finish({
      status: ingested.alreadyApplied ? "updated" : "imported",
      detail: `${ingested.name} (${ingested.email})${requisitionId ? " added to the matching role" : " filed in the talent pool"}.`,
      messageId: saved.id,
      candidateId: ingested.candidateId,
    });
  } catch (e) {
    return finish({
      status: "error",
      detail: e instanceof Error ? e.message : "The CV could not be imported.",
      messageId: saved.id,
    });
  }
}

/** Retry a stored mail whose import failed, using the attachment text we kept. */
export async function retryMessage(orgId: string, messageId: string): Promise<InboundResult> {
  const db = await admin();
  const { data: msg } = await db
    .from("inbox_messages")
    .select("id, org_id, subject, body, attachment_name")
    .eq("id", messageId)
    .eq("org_id", orgId)
    .maybeSingle();
  if (!msg) return { status: "error", detail: "That mail is no longer here.", messageId };

  const text = (msg.body ?? "").trim();
  if (text.length < 40) {
    return { status: "error", detail: "There is no readable CV text on this mail to retry.", messageId };
  }
  try {
    const requisitionId = await matchRequisition(orgId, `${msg.subject ?? ""} ${text}`);
    const ingested = await ingestCandidate({
      resumeText: text,
      fileName: msg.attachment_name ?? "mail-body.txt",
      requisitionId,
      orgId,
      source: "careers_inbox",
    });
    await db
      .from("inbox_messages")
      .update({
        status: ingested.alreadyApplied ? "updated" : "imported",
        detail: `${ingested.name} (${ingested.email}) filed from the mail body.`,
        candidate_id: ingested.candidateId,
        requisition_id: requisitionId,
      } as never)
      .eq("id", msg.id);
    return {
      status: ingested.alreadyApplied ? "updated" : "imported",
      detail: `${ingested.name} filed.`,
      messageId,
      candidateId: ingested.candidateId,
    };
  } catch (e) {
    const detail = e instanceof Error ? e.message : "Retry failed.";
    await db.from("inbox_messages").update({ status: "error", detail } as never).eq("id", msg.id);
    return { status: "error", detail, messageId };
  }
}

/**
 * Work through the mail that arrived at this organisation's own careers address
 * but has not yet produced a candidate — anything still "received", "stored" or
 * in error. Nothing to configure: the address is created with the organisation.
 */
export async function processPendingMail(
  orgId: string,
  max = 25,
): Promise<{ scanned: number; imported: number; updated: number; skipped: number; errors: number }> {
  const db = await admin();
  const { data: rows } = await db
    .from("inbox_messages")
    .select("id")
    .eq("org_id", orgId)
    .in("status", ["received", "stored", "error"])
    .order("received_at", { ascending: false })
    .limit(max);

  const out = { scanned: 0, imported: 0, updated: 0, skipped: 0, errors: 0 };
  for (const row of rows ?? []) {
    out.scanned++;
    const result = await retryMessage(orgId, row.id);
    if (result.status === "imported") out.imported++;
    else if (result.status === "updated") out.updated++;
    else if (result.status === "error") out.skipped++;
    else out.skipped++;
  }
  return out;
}
