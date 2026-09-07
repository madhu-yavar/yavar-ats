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
