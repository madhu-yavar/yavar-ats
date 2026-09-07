/**
 * Careers-inbox reading through the Lovable connector gateway (Gmail).
 *
 * LinkedIn (and every other board) emails each applicant and their CV to the
 * company's careers address. Rather than asking HR to download attachments,
 * ATSIQ reads that mailbox itself, pulls the CV out of the mail, and files the
 * candidate. The mailbox is authorised once, centrally — HR configures nothing.
 */

const GATEWAY_URL = "https://connector-gateway.lovable.dev/google_mail";

export type InboxAttachment = { filename: string; attachmentId: string; size: number };
export type InboxMessage = {
  id: string;
  threadId: string;
  subject: string;
  from: string;
  snippet: string;
  body: string;
  attachments: InboxAttachment[];
};

export function inboxConfigured(): boolean {
  return Boolean(process.env["LOVABLE_API_KEY"] && process.env["GOOGLE_MAIL_API_KEY"]);
}

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env["LOVABLE_API_KEY"] ?? ""}`,
    "X-Connection-Api-Key": process.env["GOOGLE_MAIL_API_KEY"] ?? "",
  };
}

async function gmail<T>(path: string): Promise<T> {
  const res = await fetch(`${GATEWAY_URL}${path}`, { headers: headers() });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Careers inbox request failed [${res.status}]: ${text.slice(0, 300)}`);
  }
  return JSON.parse(text) as T;
}

/** Mailbox address the connector is authorised against. */
export async function inboxProfile(): Promise<{ email: string; total: number }> {
  const p = await gmail<{ emailAddress: string; messagesTotal: number }>("/gmail/v1/users/me/profile");
  return { email: p.emailAddress, total: p.messagesTotal };
}

function base64UrlToBytes(data: string): Uint8Array {
  const b64 = data.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64.padEnd(Math.ceil(b64.length / 4) * 4, "="));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type GmailPart = {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
  headers?: { name: string; value: string }[];
};

function walk(part: GmailPart, out: { text: string[]; attachments: InboxAttachment[] }) {
  if (part.filename && part.body?.attachmentId) {
    out.attachments.push({
      filename: part.filename,
      attachmentId: part.body.attachmentId,
      size: part.body.size ?? 0,
    });
  } else if (part.mimeType === "text/plain" && part.body?.data) {
    out.text.push(new TextDecoder().decode(base64UrlToBytes(part.body.data)));
  }
  for (const child of part.parts ?? []) walk(child, out);
}

/** Message ids matching a Gmail search, newest first. */
export async function searchInbox(query: string, max = 25): Promise<string[]> {
  const res = await gmail<{ messages?: { id: string }[] }>(
    `/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
  );
  return (res.messages ?? []).map((m) => m.id);
}

export async function readMessage(id: string): Promise<InboxMessage> {
  const m = await gmail<{ id: string; threadId: string; snippet: string; payload: GmailPart }>(
    `/gmail/v1/users/me/messages/${id}?format=full`,
  );
  const acc = { text: [] as string[], attachments: [] as InboxAttachment[] };
  walk(m.payload, acc);
  const head = (name: string) =>
    m.payload.headers?.find((h) => h.name.toLowerCase() === name)?.value ?? "";
  return {
    id: m.id,
    threadId: m.threadId,
    subject: head("subject"),
    from: head("from"),
    snippet: m.snippet ?? "",
    body: acc.text.join("\n").slice(0, 40000),
    attachments: acc.attachments,
  };
}

export async function readAttachment(messageId: string, attachmentId: string): Promise<Uint8Array> {
  const a = await gmail<{ data: string }>(
    `/gmail/v1/users/me/messages/${messageId}/attachments/${attachmentId}`,
  );
  return base64UrlToBytes(a.data);
}

/** Mark a message as processed so the next sync skips it. */
export async function markProcessed(messageId: string): Promise<void> {
  await fetch(`${GATEWAY_URL}/gmail/v1/users/me/messages/${messageId}/modify`, {
    method: "POST",
    headers: { ...headers(), "Content-Type": "application/json" },
    body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
  });
}

/* -------------------------------------------------------- attachment → text */

const CV_EXT = /\.(pdf|docx|txt|rtf)$/i;

export function looksLikeCv(filename: string): boolean {
  return CV_EXT.test(filename);
}

/** Server-side CV text extraction (worker-safe: no pdf.js worker, no mammoth). */
export async function attachmentText(filename: string, bytes: Uint8Array): Promise<string> {
  const name = filename.toLowerCase();

  if (name.endsWith(".pdf")) {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const doc = await getDocumentProxy(bytes);
    const { text } = await extractText(doc, { mergePages: true });
    return String(text).replace(/\s+/g, " ").trim();
  }

  if (name.endsWith(".docx")) {
    const { unzipSync, strFromU8 } = await import("fflate");
    const files = unzipSync(bytes);
    const xml = files["word/document.xml"];
    if (!xml) return "";
    return strFromU8(xml)
      .replace(/<\/w:p>/g, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/[ \t]+/g, " ")
      .trim();
  }

  return new TextDecoder().decode(bytes).trim();
}

/* -------------------------------------------------------------- sync engine */

export type SyncOutcome = {
  message: string;
  from: string;
  file: string | null;
  status: "imported" | "updated" | "skipped" | "error";
  detail: string;
  requisition: string | null;
};

/** Default Gmail search: unread mail from the last month that carries a file. */
export const DEFAULT_INBOX_QUERY = "has:attachment is:unread newer_than:30d";

function matchRequisition(
  text: string,
  reqs: { id: string; title: string; org_id: string | null }[],
): { id: string; title: string; org_id: string | null } | null {
  const hay = text.toLowerCase();
  let best: { id: string; title: string; org_id: string | null } | null = null;
  for (const r of reqs) {
    const t = r.title.trim().toLowerCase();
    if (t.length >= 3 && hay.includes(t) && (!best || t.length > best.title.length)) best = r;
  }
  return best;
}

/**
 * Read the careers mailbox and file every CV it finds. Safe to run repeatedly:
 * processed mail is marked read, and re-applying enriches the same candidate.
 */
export async function syncCareersInbox(opts?: {
  query?: string;
  max?: number;
  requisitionId?: string | null;
}): Promise<{ scanned: number; imported: number; updated: number; skipped: number; errors: number; outcomes: SyncOutcome[] }> {
  if (!inboxConfigured()) throw new Error("The careers inbox is not connected yet.");
  const { ingestCandidate, parseCv } = await import("./intake.server");
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

  const { data: reqRows } = await supabaseAdmin
    .from("requisitions")
    .select("id, title, org_id")
    .eq("status", "approved");
  const reqs = (reqRows ?? []) as { id: string; title: string; org_id: string | null }[];

  const ids = await searchInbox(opts?.query ?? DEFAULT_INBOX_QUERY, opts?.max ?? 20);
  const outcomes: SyncOutcome[] = [];

  for (const id of ids) {
    let msg: InboxMessage | null = null;
    try {
      msg = await readMessage(id);
      const cvs = msg.attachments.filter((a) => looksLikeCv(a.filename));
      if (!cvs.length) {
        outcomes.push({
          message: msg.subject,
          from: msg.from,
          file: null,
          status: "skipped",
          detail: "No CV attached",
          requisition: null,
        });
        await markProcessed(id);
        continue;
      }

      const target = opts?.requisitionId
        ? reqs.find((r) => r.id === opts.requisitionId) ?? null
        : matchRequisition(`${msg.subject}\n${msg.body}`, reqs);

      for (const att of cvs) {
        const bytes = await readAttachment(id, att.attachmentId);
        const text = await attachmentText(att.filename, bytes);
        if (text.length < 80) {
          outcomes.push({
            message: msg.subject,
            from: msg.from,
            file: att.filename,
            status: "skipped",
            detail: "No readable text in the file (scan or image)",
            requisition: target?.title ?? null,
          });
          continue;
        }

        const parsed = await parseCv(text);
        // Boards hide the applicant address; fall back to the sender address.
        const fromEmail = /<([^>]+)>/.exec(msg.from)?.[1] ?? msg.from.trim();
        const result = await ingestCandidate({
          resumeText: text,
          fileName: att.filename,
          requisitionId: target?.id ?? null,
          orgId: target?.org_id ?? null,
          source: "careers_inbox",
          parsed,
          email: parsed?.email ?? (fromEmail.includes("@") ? fromEmail : null),
        });

        outcomes.push({
          message: msg.subject,
          from: msg.from,
          file: att.filename,
          status: result.merged ? "updated" : "imported",
          detail: `${result.name} · ${result.email}`,
          requisition: target?.title ?? null,
        });
      }

      await markProcessed(id);
    } catch (e) {
      outcomes.push({
        message: msg?.subject ?? id,
        from: msg?.from ?? "",
        file: null,
        status: "error",
        detail: e instanceof Error ? e.message : "Failed",
        requisition: null,
      });
    }
  }

  return {
    scanned: ids.length,
    imported: outcomes.filter((o) => o.status === "imported").length,
    updated: outcomes.filter((o) => o.status === "updated").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    errors: outcomes.filter((o) => o.status === "error").length,
    outcomes,
  };
}
